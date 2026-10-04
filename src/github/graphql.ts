/**
 * The GraphQL operations the tab may run, for review comments. The content
 * script names an operation and sends its variables; the background worker
 * looks the document up here, so a page can never make it send the token with
 * a query of its own. Variables travel as GraphQL variables, never spliced
 * into the document.
 */

const COMMENT_FIELDS = `
  id
  body
  createdAt
  url
  state
  viewerDidAuthor
  author { login avatarUrl(size: 48) }
`;

const THREAD_FIELDS = `
  id
  isResolved
  isOutdated
  path
  line
  originalLine
  diffSide
  subjectType
  viewerCanReply
  viewerCanResolve
  viewerCanUnresolve
  comments(first: 100) { nodes { ${COMMENT_FIELDS} } }
`;

type VariableKind = 'string' | 'int' | 'side' | 'event' | 'subject';

interface Operation {
  document: string;
  /** Every variable the operation takes; a trailing `?` marks it optional. */
  variables: Record<string, VariableKind | `${VariableKind}?`>;
}

export const OPERATIONS = {
  /** The review threads of a pull request, the viewer, and the viewer's pending review. */
  threads: {
    document: `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
      viewer { login avatarUrl(size: 48) }
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          id
          reviews(states: PENDING, first: 1) { nodes { id } }
          reviewThreads(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { ${THREAD_FIELDS} }
          }
        }
      }
    }`,
    variables: { owner: 'string', repo: 'string', number: 'int', after: 'string?' },
  },
  /** One comment on a line, published at once. */
  singleComment: {
    document: `mutation($pullRequestId: ID!, $path: String!, $line: Int!, $side: DiffSide!, $body: String!) {
      addPullRequestReview(input: {
        pullRequestId: $pullRequestId, event: COMMENT,
        threads: [{ path: $path, line: $line, side: $side, body: $body }]
      }) { pullRequestReview { id } }
    }`,
    variables: {
      pullRequestId: 'string',
      path: 'string',
      line: 'int',
      side: 'side',
      body: 'string',
    },
  },
  /** Start a pending review: comments added to it stay private until it is submitted. */
  startReview: {
    document: `mutation($pullRequestId: ID!) {
      addPullRequestReview(input: { pullRequestId: $pullRequestId }) { pullRequestReview { id } }
    }`,
    variables: { pullRequestId: 'string' },
  },
  /** A new thread in a pending review, on a line or on the file as a whole. */
  addThread: {
    document: `mutation($reviewId: ID!, $path: String!, $line: Int, $side: DiffSide, $subjectType: PullRequestReviewThreadSubjectType, $body: String!) {
      addPullRequestReviewThread(input: {
        pullRequestReviewId: $reviewId, path: $path, line: $line, side: $side,
        subjectType: $subjectType, body: $body
      }) { thread { id } }
    }`,
    variables: {
      reviewId: 'string',
      path: 'string',
      line: 'int?',
      side: 'side?',
      subjectType: 'subject?',
      body: 'string',
    },
  },
  /** A reply: published at once, or part of the pending review when one is named. */
  reply: {
    document: `mutation($threadId: ID!, $reviewId: ID, $body: String!) {
      addPullRequestReviewThreadReply(input: {
        pullRequestReviewThreadId: $threadId, pullRequestReviewId: $reviewId, body: $body
      }) { comment { id } }
    }`,
    variables: { threadId: 'string', reviewId: 'string?', body: 'string' },
  },
  resolve: {
    document: `mutation($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
    }`,
    variables: { threadId: 'string' },
  },
  unresolve: {
    document: `mutation($threadId: ID!) {
      unresolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
    }`,
    variables: { threadId: 'string' },
  },
  submitReview: {
    document: `mutation($reviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
      submitPullRequestReview(input: {
        pullRequestReviewId: $reviewId, event: $event, body: $body
      }) { pullRequestReview { id state } }
    }`,
    variables: { reviewId: 'string', event: 'event', body: 'string?' },
  },
  /** Drop a pending review that ended up with nothing in it. */
  deleteReview: {
    document: `mutation($reviewId: ID!) {
      deletePullRequestReview(input: { pullRequestReviewId: $reviewId }) {
        pullRequestReview { id }
      }
    }`,
    variables: { reviewId: 'string' },
  },
} satisfies Record<string, Operation>;

export type OperationName = keyof typeof OPERATIONS;
export type GraphqlVariables = Record<string, string | number | null>;

/** GitHub's own limit on a comment body. */
export const MAX_BODY = 65_536;

const CHECKS: Record<VariableKind, (value: string | number) => boolean> = {
  string: (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_BODY,
  int: (value) => Number.isInteger(value) && (value as number) > 0,
  side: (value) => value === 'LEFT' || value === 'RIGHT',
  event: (value) => value === 'COMMENT' || value === 'APPROVE' || value === 'REQUEST_CHANGES',
  subject: (value) => value === 'LINE' || value === 'FILE',
};

/**
 * The variables of a request, checked against what the operation takes. Null
 * when the operation is unknown, a variable is missing, extra, or of the wrong
 * kind: the background worker refuses such a request.
 */
export function checkedVariables(operation: string, variables: unknown): GraphqlVariables | null {
  if (!Object.hasOwn(OPERATIONS, operation)) return null;
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return null;
  const spec: Operation['variables'] = OPERATIONS[operation as OperationName].variables;
  const given = variables as Record<string, unknown>;
  if (Object.keys(given).some((name) => !Object.hasOwn(spec, name))) return null;
  const checked: GraphqlVariables = {};
  for (const [name, declared] of Object.entries(spec)) {
    const optional = declared.endsWith('?');
    const kind = (optional ? declared.slice(0, -1) : declared) as VariableKind;
    const value = given[name];
    if (value === undefined || value === null) {
      if (!optional) return null;
      checked[name] = null;
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (!CHECKS[kind](value)) return null;
    checked[name] = value;
  }
  return checked;
}
