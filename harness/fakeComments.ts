/**
 * Review comments for the dev harness and the tests: made-up threads from a
 * fixture's `comments.json`, and a comment service that keeps what is written
 * in memory, the way GitHub would answer.
 */
import type { CommentsSnapshot, ReviewThread } from '@/github/comments';
import type { CommentServices } from '@/ui/context';

export interface FixtureComments {
  /** Login of the person the token belongs to. */
  viewer: string;
  threads: Array<{
    path: string;
    line?: number;
    /** A comment on the file as a whole. */
    file?: boolean;
    resolved?: boolean;
    outdated?: boolean;
    comments: Array<{ author: string; at: string; body: string; pending?: boolean }>;
  }>;
}

const URL = 'https://github.com/pedalway/pedalway/pull/128#discussion_r';

/** `writable: false` is what a reader without a token gets: threads, and nothing to write with. */
export function snapshotFromFixture(
  fixture: FixtureComments | null,
  writable = true,
): CommentsSnapshot {
  const viewer = fixture?.viewer ?? 'sam';
  let count = 0;
  const threads = (fixture?.threads ?? []).map((thread, index): ReviewThread => {
    const onFile = Boolean(thread.file);
    return {
      id: `thread-${index + 1}`,
      path: thread.path,
      line: onFile || thread.outdated ? null : (thread.line ?? null),
      side: 'RIGHT',
      subject: onFile ? 'file' : 'line',
      resolved: writable ? Boolean(thread.resolved) : null,
      outdated: Boolean(thread.outdated),
      canReply: writable,
      canResolve: writable,
      comments: thread.comments.map((comment) => {
        count++;
        return {
          id: `comment-${count}`,
          author: { login: comment.author, avatarUrl: null },
          body: comment.body,
          createdAt: comment.at,
          url: `${URL}${count}`,
          pending: Boolean(comment.pending),
          mine: comment.author === viewer,
        };
      }),
    };
  });
  return {
    threads,
    viewer: writable ? { login: viewer, avatarUrl: null } : null,
    pullRequestId: writable ? 'pull-request' : null,
    pendingReviewId: threads.some((thread) => thread.comments.some((comment) => comment.pending))
      ? 'review'
      : null,
  };
}

/** A comment service over a snapshot held in memory. `now` stamps what is written. */
export function fakeCommentServices(
  initial: CommentsSnapshot,
  now: () => string = () => new Date().toISOString(),
): CommentServices {
  let state: CommentsSnapshot = structuredClone(initial);
  let serial = 1000;
  const comment = (body: string, pending: boolean) => {
    serial++;
    return {
      id: `comment-${serial}`,
      author: state.viewer ?? { login: 'sam', avatarUrl: null },
      body,
      createdAt: now(),
      url: `${URL}${serial}`,
      pending,
      mine: true,
    };
  };
  /** A comment stays private when it joins a review: one asked for, or one already going. */
  const joins = (mode: string) => {
    const pending = mode === 'review' || state.pendingReviewId !== null;
    if (pending) state.pendingReviewId ??= 'review';
    return pending;
  };
  return {
    initial,
    load: async () => structuredClone(state),
    async addThread(_snapshot, target, body, mode) {
      serial++;
      state.threads.push({
        id: `thread-${serial}`,
        path: target.path,
        line: target.line,
        side: target.side,
        subject: target.line === null ? 'file' : 'line',
        resolved: false,
        outdated: false,
        canReply: true,
        canResolve: true,
        comments: [comment(body, joins(mode))],
      });
      return { movedToFile: false };
    },
    async reply(_snapshot, threadId, body, mode) {
      const thread = state.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error('That thread is gone.');
      thread.comments.push(comment(body, joins(mode)));
    },
    async setResolved(threadId, resolved) {
      const thread = state.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error('That thread is gone.');
      thread.resolved = resolved;
    },
    async submitReview() {
      state = {
        ...state,
        pendingReviewId: null,
        threads: state.threads.map((thread) => ({
          ...thread,
          comments: thread.comments.map((entry) => ({ ...entry, pending: false })),
        })),
      };
    },
  };
}
