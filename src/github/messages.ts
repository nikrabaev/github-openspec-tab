/** Messages between the content script and the background worker. */

import type { GraphqlVariables, OperationName } from './graphql';

export interface RateLimit {
  limit: number;
  remaining: number;
  /** Unix seconds when the window resets. */
  reset: number;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  /** Parsed JSON body, when there was one. */
  data: unknown;
  /** GitHub's error message, when the request failed. */
  message: string | null;
  rateLimit: RateLimit | null;
  /** Whether a token was sent with the request. */
  authenticated: boolean;
  etag: string | null;
}

/** The answer to one of the GraphQL operations in `graphql.ts`. */
export interface GraphqlResult {
  ok: boolean;
  /**
   * Why it failed. `no-token`: none is stored. `forbidden`: GitHub will not let
   * this token do it. `invalid`: GitHub turned the request itself down, e.g. a
   * line that is not part of the diff. `refused`: not an operation this
   * extension runs. `network`: the request did not get through. `stale`: the
   * background script is from an older build and does not know the message.
   */
  failure: 'no-token' | 'forbidden' | 'invalid' | 'refused' | 'network' | 'stale' | 'failed' | null;
  data: unknown;
  /** GitHub's own words about the failure, when it gave any. */
  message: string | null;
}

/** Review progress of one pull request: item id → what was read. */
export interface ReviewState {
  items: Record<string, { hash: string; at: number }>;
}

export interface Preferences {
  diffView: 'inline' | 'split' | 'new';
  /** How wide the reader made the outline, in pixels. */
  outlineWidth: number;
  /** The font of the text. `custom`: the one named in `customFont`. */
  font: 'default' | 'lexend' | 'atkinson' | 'serif' | 'custom';
  /** A font installed on the reader's computer, by name. */
  customFont: string;
  /** The size of the text, in percent of the size GitHub's own pages use. */
  textScale: number;
  /** The weight of the body text, 400 being regular. Bolder text is as much heavier as before. */
  textWeight: number;
  /** How wide the text may get. `full`: as wide as the page. */
  contentWidth: 'narrow' | 'medium' | 'wide' | 'full';
}

export const DEFAULT_PREFERENCES: Preferences = {
  diffView: 'inline',
  outlineWidth: 272,
  font: 'default',
  customFont: '',
  textScale: 100,
  textWeight: 400,
  contentWidth: 'full',
};

export type Message =
  | { type: 'api'; path: string; etag?: string }
  | { type: 'graphql'; operation: OperationName; variables: GraphqlVariables }
  | { type: 'token-status' }
  | { type: 'open-options' }
  | { type: 'review-get'; key: string }
  | { type: 'review-set'; key: string; state: ReviewState }
  | { type: 'prefs-get' }
  | { type: 'prefs-set'; prefs: Preferences }
  | { type: 'repo-flag-get'; repo: string }
  | { type: 'repo-flag-set'; repo: string; hasOpenSpec: boolean };

export interface MessageResult {
  api: ApiResult;
  graphql: GraphqlResult;
  'token-status': { hasToken: boolean };
  'open-options': null;
  'review-get': ReviewState | null;
  'review-set': null;
  'prefs-get': Preferences;
  'prefs-set': null;
  'repo-flag-get': { hasOpenSpec: boolean } | null;
  'repo-flag-set': null;
}

/**
 * The only GitHub API calls the tab makes. The background worker refuses
 * anything else, so it cannot be used to send the token to another endpoint.
 */
const REPO = '/repos/[\\w.-]+/[\\w.-]+';
const SHA = '[0-9a-f]{40}';
const ALLOWED_API_PATHS = [
  new RegExp(`^${REPO}/pulls/\\d+$`),
  new RegExp(`^${REPO}/compare/${SHA}\\.\\.\\.${SHA}\\?per_page=1&page=2$`),
  new RegExp(`^${REPO}/git/trees/${SHA}(?::[\\w.\\-/]+)?\\?recursive=1$`),
  new RegExp(`^${REPO}/git/blobs/${SHA}$`),
  // Review comments, read without a token on a public repository.
  new RegExp(`^${REPO}/pulls/\\d+/comments\\?per_page=100&page=\\d{1,3}$`),
];

export function isAllowedApiPath(path: string): boolean {
  const [pathname = ''] = path.split('?');
  // No dot segments: the URL parser would resolve them into a different endpoint.
  if (pathname.split(/[/:]/).some((segment) => segment === '.' || segment === '..')) return false;
  return ALLOWED_API_PATHS.some((pattern) => pattern.test(path));
}

export const TOKEN_KEY = 'token';
