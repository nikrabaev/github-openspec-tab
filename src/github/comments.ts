/**
 * Review comments of a pull request: reading the threads, and writing to them.
 *
 * With a token everything goes through GraphQL, which alone knows whether a
 * thread is resolved and can add to a review in progress. Without one, a
 * public repository's comments are still read through REST, and nothing can
 * be written.
 */
import type { Backend } from './backend';
import type { GraphqlResult } from './messages';
import type { PullRef } from './route';

export interface CommentAuthor {
  login: string;
  avatarUrl: string | null;
}

export interface ReviewComment {
  id: string;
  author: CommentAuthor;
  /** Markdown. */
  body: string;
  /** ISO date. */
  createdAt: string;
  url: string;
  /** Part of the reader's own review that is not submitted yet: nobody else sees it. */
  pending: boolean;
  mine: boolean;
}

export interface ReviewThread {
  id: string;
  path: string;
  /**
   * 1-based line the thread is on. Null for a comment on the file as a whole,
   * and for a thread whose line is gone from the diff.
   */
  line: number | null;
  side: 'LEFT' | 'RIGHT';
  subject: 'line' | 'file';
  /** Null when it cannot be known: the threads were read without a token. */
  resolved: boolean | null;
  /** The file changed under the thread; the line it was left on is no longer in the diff. */
  outdated: boolean;
  canReply: boolean;
  canResolve: boolean;
  comments: ReviewComment[];
}

export interface CommentsSnapshot {
  threads: ReviewThread[];
  /** Whose token it is. Null when the threads were read without one, so nothing can be written. */
  viewer: CommentAuthor | null;
  pullRequestId: string | null;
  /** The reader's review in progress, when there is one. */
  pendingReviewId: string | null;
}

/** What a new comment is about. */
export interface CommentTarget {
  path: string;
  /** Null to comment on the file as a whole. */
  line: number | null;
  side: 'LEFT' | 'RIGHT';
  /**
   * The subject in words, e.g. `Requirement: Daily fare cap`. Quoted at the
   * top of the comment when it has to be left on the file as a whole.
   */
  subject: string;
}

/** `single`: published at once. `review`: kept in the reader's pending review. */
export type CommentMode = 'single' | 'review';
export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export type CommentErrorKind =
  | 'no-token'
  | 'forbidden'
  | 'invalid'
  | 'network'
  | 'stale'
  | 'cannot-resolve'
  | 'failed';

export class CommentError extends Error {
  constructor(
    readonly kind: CommentErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CommentError';
  }
}

function toError(result: GraphqlResult): CommentError {
  switch (result.failure) {
    case 'no-token':
      return new CommentError('no-token', 'Add a token in the settings to comment from here.');
    case 'forbidden':
      return new CommentError(
        'forbidden',
        `GitHub did not allow this with your token${
          result.message ? ` ("${result.message}")` : ''
        }. Commenting needs "Pull requests: Read and write" on the token. If it has that, check that this repository is in the token's repository access and that the organisation has approved the token.`,
      );
    case 'network':
      return new CommentError('network', 'Could not reach api.github.com. Nothing was posted.');
    case 'stale':
      return new CommentError(
        'stale',
        'The extension was rebuilt, but its background script is still the old one. Reload the extension (Firefox: about:debugging, This Firefox, Reload; Chrome: chrome://extensions, the reload button), then refresh this page.',
      );
    case 'invalid':
      return new CommentError('invalid', result.message ?? 'GitHub turned the request down.');
    default:
      return new CommentError('failed', result.message ?? 'The request failed.');
  }
}

// ---------- Reading ----------

interface GraphqlComment {
  id: string;
  body: string;
  createdAt: string;
  url: string;
  state: string;
  viewerDidAuthor: boolean;
  author: { login: string; avatarUrl: string } | null;
}

interface GraphqlThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  diffSide: 'LEFT' | 'RIGHT';
  subjectType: 'LINE' | 'FILE';
  viewerCanReply: boolean;
  viewerCanResolve: boolean;
  viewerCanUnresolve: boolean;
  comments: { nodes: Array<GraphqlComment | null> };
}

interface ThreadsData {
  viewer: { login: string; avatarUrl: string };
  repository: {
    pullRequest: {
      id: string;
      reviews: { nodes: Array<{ id: string } | null> };
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<GraphqlThread | null>;
      };
    } | null;
  } | null;
}

/** A deleted account has no author; GitHub shows it as "ghost". */
const GHOST: CommentAuthor = { login: 'ghost', avatarUrl: null };

export function threadFromGraphql(node: GraphqlThread): ReviewThread {
  return {
    id: node.id,
    path: node.path,
    line: node.subjectType === 'FILE' || node.isOutdated ? null : node.line,
    side: node.diffSide,
    subject: node.subjectType === 'FILE' ? 'file' : 'line',
    resolved: node.isResolved,
    outdated: node.isOutdated,
    canReply: node.viewerCanReply,
    canResolve: node.isResolved ? node.viewerCanUnresolve : node.viewerCanResolve,
    comments: node.comments.nodes
      .filter((comment): comment is GraphqlComment => comment !== null)
      .map((comment) => ({
        id: comment.id,
        author: comment.author
          ? { login: comment.author.login, avatarUrl: comment.author.avatarUrl }
          : GHOST,
        body: comment.body,
        createdAt: comment.createdAt,
        url: comment.url,
        pending: comment.state === 'PENDING',
        mine: comment.viewerDidAuthor,
      })),
  };
}

interface RestComment {
  id: number;
  in_reply_to_id?: number;
  path: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT' | null;
  subject_type?: 'line' | 'file';
  body: string;
  created_at: string;
  html_url: string;
  user: { login: string; avatar_url: string } | null;
}

/** REST lists comments one by one; a thread is a comment and the replies to it. */
export function threadsFromRest(comments: RestComment[]): ReviewThread[] {
  const threads = new Map<number, ReviewThread>();
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const comment of sorted) {
    const entry: ReviewComment = {
      id: `rest:${comment.id}`,
      author: comment.user
        ? { login: comment.user.login, avatarUrl: comment.user.avatar_url }
        : GHOST,
      body: comment.body,
      createdAt: comment.created_at,
      url: comment.html_url,
      pending: false,
      mine: false,
    };
    const root = comment.in_reply_to_id ? threads.get(comment.in_reply_to_id) : undefined;
    if (root) {
      root.comments.push(entry);
      continue;
    }
    const onFile = comment.subject_type === 'file';
    threads.set(comment.id, {
      id: `rest:${comment.id}`,
      path: comment.path,
      line: onFile ? null : comment.line,
      side: comment.side ?? 'RIGHT',
      subject: onFile ? 'file' : 'line',
      resolved: null,
      outdated: !onFile && comment.line === null,
      canReply: false,
      canResolve: false,
      comments: [entry],
    });
  }
  return [...threads.values()];
}

const MAX_PAGES = 10;

async function loadWithoutToken(backend: Backend, pull: PullRef): Promise<CommentsSnapshot> {
  const comments: RestComment[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await backend.api(
      `/repos/${pull.owner}/${pull.repo}/pulls/${pull.number}/comments?per_page=100&page=${page}`,
    );
    if (!result.ok) {
      throw new CommentError(
        result.status === 0 ? 'network' : 'failed',
        result.message ?? 'The comments could not be read.',
      );
    }
    const batch = (result.data as RestComment[] | null) ?? [];
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return {
    threads: threadsFromRest(comments),
    viewer: null,
    pullRequestId: null,
    pendingReviewId: null,
  };
}

/** The review threads of a pull request, and whether the reader can write to them. */
export async function loadComments(backend: Backend, pull: PullRef): Promise<CommentsSnapshot> {
  const threads: ReviewThread[] = [];
  let snapshot: Omit<CommentsSnapshot, 'threads'> | null = null;
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await backend.graphql('threads', {
      owner: pull.owner,
      repo: pull.repo,
      number: pull.number,
      after,
    });
    if (!result.ok) {
      // No token, or one that GraphQL will not serve here: read what REST gives instead.
      if (page === 0 && (result.failure === 'no-token' || result.failure === 'forbidden')) {
        return loadWithoutToken(backend, pull);
      }
      throw toError(result);
    }
    const data = result.data as ThreadsData;
    const pullRequest = data.repository?.pullRequest;
    if (!pullRequest) throw new CommentError('failed', 'GitHub did not return the pull request.');
    snapshot ??= {
      viewer: { login: data.viewer.login, avatarUrl: data.viewer.avatarUrl },
      pullRequestId: pullRequest.id,
      pendingReviewId: pullRequest.reviews.nodes[0]?.id ?? null,
    };
    for (const node of pullRequest.reviewThreads.nodes) {
      if (node) threads.push(threadFromGraphql(node));
    }
    after = pullRequest.reviewThreads.pageInfo.endCursor;
    if (!pullRequest.reviewThreads.pageInfo.hasNextPage || !after) break;
  }
  if (!snapshot) throw new CommentError('failed', 'The comments could not be read.');
  return { threads, ...snapshot };
}

// ---------- Writing ----------

async function run(
  backend: Backend,
  ...request: Parameters<Backend['graphql']>
): Promise<GraphqlResult> {
  const result = await backend.graphql(...request);
  if (!result.ok) throw toError(result);
  return result;
}

function writable(snapshot: CommentsSnapshot): string {
  if (!snapshot.viewer || !snapshot.pullRequestId)
    throw toError({ ...FAILED, failure: 'no-token' });
  return snapshot.pullRequestId;
}

const FAILED: GraphqlResult = { ok: false, failure: 'failed', data: null, message: null };

async function startReview(backend: Backend, pullRequestId: string): Promise<string> {
  const result = await run(backend, 'startReview', { pullRequestId });
  const id = (result.data as { addPullRequestReview?: { pullRequestReview?: { id?: string } } })
    ?.addPullRequestReview?.pullRequestReview?.id;
  if (!id) throw new CommentError('failed', 'GitHub did not start a review.');
  return id;
}

/** A review this call started is dropped again when nothing could be added to it. */
async function dropReview(backend: Backend, reviewId: string): Promise<void> {
  await backend.graphql('deleteReview', { reviewId }).catch(() => null);
}

/**
 * Start a thread on `target`. While the reader has a review in progress, the
 * comment joins it whatever `mode` says: GitHub allows one pending review per
 * person, and nothing can be published around it.
 *
 * GitHub accepts a line comment only on a line of the diff. When it turns the
 * line down, the comment is left on the file as a whole, opening with what it
 * is about; `movedToFile` reports that.
 */
export async function addThread(
  backend: Backend,
  snapshot: CommentsSnapshot,
  target: CommentTarget,
  body: string,
  mode: CommentMode,
): Promise<{ movedToFile: boolean }> {
  const pullRequestId = writable(snapshot);
  const pending = snapshot.pendingReviewId;
  const joins = mode === 'review' || pending !== null;
  const { path, line, side } = target;

  // On its own and on a line: one call that creates and publishes together.
  if (!joins && line !== null) {
    const result = await backend.graphql('singleComment', {
      pullRequestId,
      path,
      line,
      side,
      body,
    });
    if (result.ok) return { movedToFile: false };
    if (result.failure !== 'invalid') throw toError(result);
  }

  const reviewId = pending ?? (await startReview(backend, pullRequestId));
  const started = pending === null;
  try {
    if (joins && line !== null) {
      const result = await backend.graphql('addThread', {
        reviewId,
        path,
        line,
        side,
        subjectType: 'LINE',
        body,
      });
      if (result.ok) return { movedToFile: false };
      if (result.failure !== 'invalid') throw toError(result);
    }
    await run(backend, 'addThread', {
      reviewId,
      path,
      line: null,
      side: null,
      subjectType: 'FILE',
      body: line === null ? body : `> ${target.subject}\n\n${body}`,
    });
  } catch (error) {
    if (started) await dropReview(backend, reviewId);
    throw error;
  }
  if (!joins) {
    try {
      await run(backend, 'submitReview', { reviewId, event: 'COMMENT', body: null });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      throw new CommentError(
        'failed',
        `The comment was saved in a pending review but could not be published. ${reason}`.trim(),
      );
    }
  }
  return { movedToFile: line !== null };
}

/** Reply in a thread: published at once, or kept in the pending review. */
export async function addReply(
  backend: Backend,
  snapshot: CommentsSnapshot,
  threadId: string,
  body: string,
  mode: CommentMode,
): Promise<void> {
  const pullRequestId = writable(snapshot);
  const pending = snapshot.pendingReviewId;
  const joins = mode === 'review' || pending !== null;
  if (!joins) {
    await run(backend, 'reply', { threadId, reviewId: null, body });
    return;
  }
  const reviewId = pending ?? (await startReview(backend, pullRequestId));
  try {
    await run(backend, 'reply', { threadId, reviewId, body });
  } catch (error) {
    if (pending === null) await dropReview(backend, reviewId);
    throw error;
  }
}

/**
 * What GitHub asks of a fine-grained token before it may resolve a thread. Its
 * rule is that a conversation is resolved by someone with write access to the
 * repository, and for a token that is "Contents", not "Pull requests".
 */
export const CANNOT_RESOLVE =
  'GitHub lets a fine-grained token resolve or unresolve a thread only if it has "Contents: Read and write", which would also let it push code. "Pull requests: Read and write" covers commenting, but not this. Resolve the thread on GitHub, or widen the token if you accept that.';

export async function setResolved(
  backend: Backend,
  threadId: string,
  resolved: boolean,
): Promise<void> {
  const result = await backend.graphql(resolved ? 'resolve' : 'unresolve', { threadId });
  if (result.ok) return;
  if (result.failure === 'forbidden') throw new CommentError('cannot-resolve', CANNOT_RESOLVE);
  throw toError(result);
}

/** Publish the reader's pending review, with a verdict and an optional summary. */
export async function submitReview(
  backend: Backend,
  snapshot: CommentsSnapshot,
  event: ReviewEvent,
  body: string,
): Promise<void> {
  writable(snapshot);
  if (!snapshot.pendingReviewId) throw new CommentError('invalid', 'There is no review to submit.');
  await run(backend, 'submitReview', {
    reviewId: snapshot.pendingReviewId,
    event,
    body: body.trim() || null,
  });
}
