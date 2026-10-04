import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type FixtureComments, snapshotFromFixture } from '../harness/fakeComments';
import type { Backend } from '../src/github/backend';
import {
  addReply,
  addThread,
  CANNOT_RESOLVE,
  CommentError,
  type CommentsSnapshot,
  loadComments,
  setResolved,
  submitReview,
  threadsFromRest,
} from '../src/github/comments';
import { checkedVariables, MAX_BODY, OPERATIONS } from '../src/github/graphql';
import type { ApiResult, GraphqlResult } from '../src/github/messages';
import { placeThreads, regionKey, regionsOf } from '../src/github/placement';
import { FIXTURES, modelOf } from './helpers/fixtures';

const pull = { owner: 'pedalway', repo: 'pedalway', number: 128 };
const CHANGE = 'openspec/changes/bks-142-group-rides';

const done = (data: unknown): GraphqlResult => ({ ok: true, failure: null, data, message: null });
const refused = (
  failure: GraphqlResult['failure'],
  message: string | null = null,
): GraphqlResult => ({
  ok: false,
  failure,
  data: null,
  message,
});

/** A backend that answers GraphQL from a script and records what it was asked. */
function scripted(
  answer: (operation: string, variables: Record<string, unknown>) => GraphqlResult,
) {
  const calls: Array<{ operation: string; variables: Record<string, unknown> }> = [];
  const rest: string[] = [];
  const backend: Backend = {
    async graphql(operation, variables) {
      calls.push({ operation, variables });
      return answer(operation, variables);
    },
    async api(path): Promise<ApiResult> {
      rest.push(path);
      return {
        ok: true,
        status: 200,
        data: [],
        message: null,
        rateLimit: null,
        authenticated: false,
        etag: null,
      };
    },
    raw: async () => null,
    probe: async () => null,
  };
  return { backend, calls, rest, names: () => calls.map((call) => call.operation) };
}

const reader: CommentsSnapshot = {
  threads: [],
  viewer: { login: 'sam', avatarUrl: null },
  pullRequestId: 'PR',
  pendingReviewId: null,
};
const target = {
  path: `${CHANGE}/specs/ride-unlock/spec.md`,
  line: 37,
  side: 'RIGHT' as const,
  subject: 'Requirement: Group bikes come from one station',
};
const started = done({ addPullRequestReview: { pullRequestReview: { id: 'REVIEW' } } });

describe('GraphQL operations', () => {
  it('accepts the variables an operation takes, and nothing else', () => {
    expect(checkedVariables('threads', { owner: 'o', repo: 'r', number: 12, after: null })).toEqual(
      { owner: 'o', repo: 'r', number: 12, after: null },
    );
    expect(checkedVariables('resolve', { threadId: 'T' })).toEqual({ threadId: 'T' });
    // An optional variable may be left out; it is sent as null.
    expect(checkedVariables('reply', { threadId: 'T', body: 'ok' })).toEqual({
      threadId: 'T',
      reviewId: null,
      body: 'ok',
    });
    for (const [operation, variables] of [
      ['query { viewer { login } }', {}],
      ['threads', { owner: 'o', repo: 'r' }],
      ['threads', { owner: 'o', repo: 'r', number: '12' }],
      ['threads', { owner: 'o', repo: 'r', number: 12, query: 'x' }],
      ['resolve', { threadId: '' }],
      ['resolve', { threadId: { id: 'T' } }],
      ['submitReview', { reviewId: 'R', event: 'DISMISS' }],
      ['singleComment', { pullRequestId: 'P', path: 'a', line: 0, side: 'RIGHT', body: 'x' }],
      ['singleComment', { pullRequestId: 'P', path: 'a', line: 3, side: 'UP', body: 'x' }],
      ['reply', { threadId: 'T', body: 'x'.repeat(MAX_BODY + 1) }],
      ['__proto__', {}],
      ['resolve', null],
    ] as Array<[string, unknown]>) {
      expect(
        checkedVariables(operation, variables),
        `${operation} ${JSON.stringify(variables)?.slice(0, 60)}`,
      ).toBeNull();
    }
  });

  it('declares every variable its document uses', () => {
    for (const [name, operation] of Object.entries(OPERATIONS)) {
      const used = new Set([...operation.document.matchAll(/\$(\w+)/g)].map((match) => match[1]));
      expect([...used].sort(), name).toEqual(Object.keys(operation.variables).sort());
    }
  });
});

describe('reading comments', () => {
  it('groups REST comments into threads, oldest first', () => {
    const comment = (id: number, extra: object) => ({
      id,
      path: 'openspec/x.md',
      line: 4,
      side: 'RIGHT' as const,
      body: `comment ${id}`,
      created_at: `2026-09-2${id}T10:00:00Z`,
      html_url: `https://github.com/o/r/pull/1#discussion_r${id}`,
      user: { login: 'ines', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
      ...extra,
    });
    const threads = threadsFromRest([
      comment(3, { in_reply_to_id: 1 }),
      comment(1, {}),
      comment(2, { line: null }),
      comment(4, { subject_type: 'file', line: null, user: null }),
    ]);
    expect(
      threads.map((thread) => [
        thread.id,
        thread.line,
        thread.subject,
        thread.outdated,
        thread.resolved,
        thread.comments.map((entry) => entry.body),
      ]),
    ).toEqual([
      ['rest:1', 4, 'line', false, null, ['comment 1', 'comment 3']],
      ['rest:2', null, 'line', true, null, ['comment 2']],
      ['rest:4', null, 'file', false, null, ['comment 4']],
    ]);
    expect(threads[2]?.comments[0]?.author.login).toBe('ghost');
    expect(threads.every((thread) => !thread.canReply && !thread.canResolve)).toBe(true);
  });

  it('reads through GraphQL with a token, page by page', async () => {
    const node = (id: string, extra: object = {}) => ({
      id,
      isResolved: false,
      isOutdated: false,
      path: 'openspec/x.md',
      line: 9,
      originalLine: 9,
      diffSide: 'RIGHT',
      subjectType: 'LINE',
      viewerCanReply: true,
      viewerCanResolve: true,
      viewerCanUnresolve: false,
      comments: {
        nodes: [
          {
            id: `${id}-1`,
            body: 'hello',
            createdAt: '2026-09-29T10:00:00Z',
            url: 'https://github.com/o/r/pull/1#discussion_r1',
            state: 'SUBMITTED',
            viewerDidAuthor: false,
            author: { login: 'tomas', avatarUrl: 'https://avatars.githubusercontent.com/u/2' },
          },
        ],
      },
      ...extra,
    });
    const page = (nodes: unknown[], next: string | null) =>
      done({
        viewer: { login: 'sam', avatarUrl: 'https://avatars.githubusercontent.com/u/3' },
        repository: {
          pullRequest: {
            id: 'PR',
            reviews: { nodes: [{ id: 'REVIEW' }] },
            reviewThreads: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes },
          },
        },
      });
    const { backend, calls, rest } = scripted((_operation, variables) =>
      variables.after === null
        ? page([node('A'), node('B', { isResolved: true, viewerCanUnresolve: true })], 'CURSOR')
        : page(
            [node('C', { isOutdated: true }), node('D', { subjectType: 'FILE', line: null })],
            null,
          ),
    );
    const snapshot = await loadComments(backend, pull);
    expect(calls.map((call) => call.variables.after)).toEqual([null, 'CURSOR']);
    expect(rest).toEqual([]);
    expect(snapshot.viewer?.login).toBe('sam');
    expect(snapshot.pullRequestId).toBe('PR');
    expect(snapshot.pendingReviewId).toBe('REVIEW');
    expect(
      snapshot.threads.map((thread) => [
        thread.id,
        thread.line,
        thread.subject,
        thread.resolved,
        thread.outdated,
        thread.canResolve,
      ]),
    ).toEqual([
      ['A', 9, 'line', false, false, true],
      ['B', 9, 'line', true, false, true],
      ['C', null, 'line', false, true, true],
      ['D', null, 'file', false, false, true],
    ]);
  });

  it('falls back to REST without a token, and then nothing can be written', async () => {
    const { backend, rest } = scripted(() => refused('no-token'));
    const snapshot = await loadComments(backend, pull);
    expect(rest).toEqual(['/repos/pedalway/pedalway/pulls/128/comments?per_page=100&page=1']);
    expect(snapshot).toEqual({
      threads: [],
      viewer: null,
      pullRequestId: null,
      pendingReviewId: null,
    });
    await expect(addThread(backend, snapshot, target, 'hi', 'single')).rejects.toMatchObject({
      kind: 'no-token',
    });
  });

  it('says to reload the extension when an older background script answers nothing', async () => {
    const { backend, rest } = scripted(() => refused('stale'));
    const error = await loadComments(backend, pull).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommentError);
    expect((error as CommentError).kind).toBe('stale');
    expect((error as CommentError).message).toContain('Reload the extension');
    // It is not mistaken for "no token": nothing is read through REST instead.
    expect(rest).toEqual([]);
  });

  it('says so when the threads cannot be read', async () => {
    const { backend } = scripted(() => refused('network'));
    await expect(loadComments(backend, pull)).rejects.toBeInstanceOf(CommentError);
  });
});

describe('writing comments', () => {
  it('publishes a lone line comment in one call', async () => {
    const { backend, calls } = scripted(() => started);
    expect(await addThread(backend, reader, target, 'Why one station?', 'single')).toEqual({
      movedToFile: false,
    });
    expect(calls).toEqual([
      {
        operation: 'singleComment',
        variables: {
          pullRequestId: 'PR',
          path: target.path,
          line: 37,
          side: 'RIGHT',
          body: 'Why one station?',
        },
      },
    ]);
  });

  it('leaves the comment on the file, naming its subject, when GitHub will not take the line', async () => {
    const { backend, calls, names } = scripted((operation, variables) => {
      if (operation === 'singleComment') return refused('invalid', 'line must be part of the diff');
      if (operation === 'startReview') return started;
      if (operation === 'addThread') {
        expect(variables.subjectType).toBe('FILE');
        return done({ addPullRequestReviewThread: { thread: { id: 'T' } } });
      }
      return done({});
    });
    expect(await addThread(backend, reader, target, 'Why one station?', 'single')).toEqual({
      movedToFile: true,
    });
    expect(names()).toEqual(['singleComment', 'startReview', 'addThread', 'submitReview']);
    expect(calls[2]?.variables).toMatchObject({
      reviewId: 'REVIEW',
      line: null,
      side: null,
      body: '> Requirement: Group bikes come from one station\n\nWhy one station?',
    });
    expect(calls[3]?.variables).toEqual({ reviewId: 'REVIEW', event: 'COMMENT', body: null });
  });

  it('keeps a comment in the pending review, starting one when asked to', async () => {
    const fresh = scripted((operation) =>
      operation === 'startReview'
        ? started
        : done({ addPullRequestReviewThread: { thread: { id: 'T' } } }),
    );
    await addThread(fresh.backend, reader, target, 'Later', 'review');
    expect(fresh.names()).toEqual(['startReview', 'addThread']);
    expect(fresh.calls[1]?.variables).toMatchObject({
      reviewId: 'REVIEW',
      line: 37,
      subjectType: 'LINE',
    });

    // With a review already going, even a "single" comment joins it: GitHub allows one per person.
    const going = scripted(() => done({ addPullRequestReviewThread: { thread: { id: 'T' } } }));
    await addThread(going.backend, { ...reader, pendingReviewId: 'MINE' }, target, 'Now', 'single');
    expect(going.names()).toEqual(['addThread']);
    expect(going.calls[0]?.variables.reviewId).toBe('MINE');
  });

  it('drops a review it started when nothing could be added to it', async () => {
    const { backend, names } = scripted((operation) => {
      if (operation === 'startReview') return started;
      if (operation === 'addThread') return refused('forbidden');
      return done({});
    });
    await expect(addThread(backend, reader, target, 'x', 'review')).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(names()).toEqual(['startReview', 'addThread', 'deleteReview']);
  });

  it("explains a token that may not write, in GitHub's words too", async () => {
    const { backend } = scripted(() => refused('forbidden', 'Resource not accessible'));
    const error = await addThread(backend, reader, target, 'x', 'single').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommentError);
    expect((error as CommentError).message).toContain('Pull requests: Read and write');
    expect((error as CommentError).message).toContain('"Resource not accessible"');
  });

  it('says what resolving needs when a token that can comment may not resolve', async () => {
    const { backend } = scripted(() => refused('forbidden', 'Resource not accessible'));
    const error = await setResolved(backend, 'T', true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommentError);
    expect((error as CommentError).kind).toBe('cannot-resolve');
    expect((error as CommentError).message).toBe(CANNOT_RESOLVE);
    expect(CANNOT_RESOLVE).toContain('Contents: Read and write');
    // Any other failure keeps its own explanation.
    const offline = scripted(() => refused('network'));
    await expect(setResolved(offline.backend, 'T', true)).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('replies at once, or into the pending review', async () => {
    const single = scripted(() => done({}));
    await addReply(single.backend, reader, 'T', 'Agreed', 'single');
    expect(single.calls).toEqual([
      { operation: 'reply', variables: { threadId: 'T', reviewId: null, body: 'Agreed' } },
    ]);
    const review = scripted((operation) => (operation === 'startReview' ? started : done({})));
    await addReply(review.backend, reader, 'T', 'Agreed', 'review');
    expect(review.names()).toEqual(['startReview', 'reply']);
    expect(review.calls[1]?.variables.reviewId).toBe('REVIEW');
  });

  it('resolves, unresolves and submits', async () => {
    const { backend, calls } = scripted(() => done({}));
    await setResolved(backend, 'T', true);
    await setResolved(backend, 'T', false);
    await submitReview(backend, { ...reader, pendingReviewId: 'MINE' }, 'APPROVE', '  ');
    expect(calls).toEqual([
      { operation: 'resolve', variables: { threadId: 'T' } },
      { operation: 'unresolve', variables: { threadId: 'T' } },
      { operation: 'submitReview', variables: { reviewId: 'MINE', event: 'APPROVE', body: null } },
    ]);
    await expect(submitReview(backend, reader, 'COMMENT', '')).rejects.toMatchObject({
      kind: 'invalid',
    });
  });

  it('only ever sends requests the background worker would accept', async () => {
    const { backend, calls } = scripted((operation) =>
      operation === 'singleComment'
        ? refused('invalid')
        : operation === 'startReview'
          ? started
          : done({}),
    );
    await addThread(backend, reader, target, 'a', 'single');
    await addThread(backend, reader, { ...target, line: null }, 'b', 'review');
    await addReply(backend, reader, 'T', 'c', 'review');
    await setResolved(backend, 'T', true);
    await submitReview(backend, { ...reader, pendingReviewId: 'MINE' }, 'REQUEST_CHANGES', 'd');
    await loadComments(backend, pull).catch(() => null);
    for (const call of calls) {
      expect(checkedVariables(call.operation, call.variables), call.operation).not.toBeNull();
    }
  });
});

describe('placing threads', () => {
  const { model } = modelOf('showcase');
  const fixture = JSON.parse(
    readFileSync(`${FIXTURES}/showcase/comments.json`, 'utf8'),
  ) as FixtureComments;
  const snapshot = snapshotFromFixture(fixture);
  const placement = placeThreads(regionsOf(model), snapshot.threads);
  const change = model.changes.find((entry) => entry.name === 'bks-142-group-rides');
  const requirement = (capability: string, name: string) =>
    change?.capabilities
      .find((entry) => entry.capability === capability)
      ?.changes.find((entry) => entry.name === name);
  const at = (key: string) =>
    (placement.byRegion.get(key) ?? []).map((placed) => [placed.thread.line, placed.on]);

  it('puts a thread on the requirement whose lines hold it, and names the scenario', () => {
    const qr = requirement('ride-unlock', 'Unlock by QR code');
    const feedback = requirement('ride-unlock', 'Unlock failure feedback');
    expect(at(regionKey.requirement(qr?.id ?? ''))).toEqual([
      [4, null],
      [8, 'Scenario: Successful unlock'],
    ]);
    expect(at(regionKey.requirement(feedback?.id ?? ''))).toEqual([
      [33, 'Scenario: Group limit reached'],
    ]);
  });

  it('puts threads on documents in the block, or the decision, they are in', () => {
    const proposal = change?.proposal;
    const design = change?.design;
    expect(at(regionKey.block(proposal?.id ?? '', 9))).toEqual([[12, null]]);
    // Line 31 is inside the second decision, which starts on line 29.
    expect(at(regionKey.block(design?.id ?? '', 29))).toEqual([[31, null]]);
    expect(at(regionKey.block(design?.id ?? '', 19))).toEqual([]);
  });

  it('keeps file comments and outdated threads with their file', () => {
    const groupRides = change?.capabilities.find((entry) => entry.capability === 'group-rides');
    expect(at(regionKey.file(groupRides?.id ?? ''))).toEqual([[null, null]]);
    expect(at(regionKey.doc(change?.tasks?.id ?? ''))).toEqual([[null, null]]);
  });

  it('counts the threads that still want an answer, per outline item', () => {
    const qr = requirement('ride-unlock', 'Unlock by QR code');
    // One of its two threads is resolved; the outdated thread on the tasks does not count.
    expect(placement.openByItem.get(qr?.id ?? '')).toBe(1);
    expect(placement.openByItem.get(change?.tasks?.id ?? '')).toBeUndefined();
    expect([...placement.openByItem.values()].reduce((sum, count) => sum + count, 0)).toBe(5);
  });

  it('leaves out threads on files the tab does not show', () => {
    const elsewhere = placeThreads(regionsOf(model), [
      { ...snapshot.threads[0], id: 'x', path: 'services/unlock/src/unlock-handler.ts' } as never,
    ]);
    expect(elsewhere.byRegion.size).toBe(0);
  });
});
