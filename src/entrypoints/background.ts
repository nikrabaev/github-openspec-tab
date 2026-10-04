import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { checkedVariables, OPERATIONS, type OperationName } from '@/github/graphql';
import {
  type ApiResult,
  DEFAULT_PREFERENCES,
  type GraphqlResult,
  isAllowedApiPath,
  type Message,
  type Preferences,
  type RateLimit,
  type ReviewState,
  TOKEN_KEY,
} from '@/github/messages';

const API = 'https://api.github.com';
const REPO_FLAG_TTL = 24 * 60 * 60 * 1000;
const REVIEW_TTL = 180 * 24 * 60 * 60 * 1000;

async function readToken(): Promise<string | null> {
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function rateLimitOf(headers: Headers): RateLimit | null {
  const remaining = headers.get('x-ratelimit-remaining');
  if (remaining === null) return null;
  return {
    limit: Number(headers.get('x-ratelimit-limit') ?? 0),
    remaining: Number(remaining),
    reset: Number(headers.get('x-ratelimit-reset') ?? 0),
  };
}

/**
 * Call the GitHub REST API. The token is read here and attached here, so it
 * never reaches a web page: content scripts only see the response.
 */
async function callApi(path: string, etag?: string): Promise<ApiResult> {
  const token = await readToken();
  const failed = (status: number, message: string): ApiResult => ({
    ok: false,
    status,
    data: null,
    message,
    rateLimit: null,
    authenticated: token !== null,
    etag: null,
  });
  if (!isAllowedApiPath(path))
    return failed(0, 'Request refused: not an endpoint this extension uses.');

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    return failed(0, 'Could not reach api.github.com.');
  }

  let data: unknown = null;
  if (response.status !== 304 && response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }
  const message =
    !response.ok && data && typeof data === 'object' && 'message' in data
      ? String((data as { message: unknown }).message)
      : null;
  return {
    ok: response.ok || response.status === 304,
    status: response.status,
    data: response.ok ? data : null,
    message,
    rateLimit: rateLimitOf(response.headers),
    authenticated: token !== null,
    etag: response.headers.get('etag'),
  };
}

/**
 * Run one of the tab's GraphQL operations, for review comments. GraphQL always
 * needs a token, and writing needs one that may write pull requests. As with
 * REST, the token is attached here and never leaves this worker.
 */
async function callGraphql(operation: string, variables: unknown): Promise<GraphqlResult> {
  const failed = (failure: GraphqlResult['failure'], message: string | null): GraphqlResult => ({
    ok: false,
    failure,
    data: null,
    message,
  });
  const checked = checkedVariables(operation, variables);
  if (!checked) return failed('refused', 'Request refused: not an operation this extension runs.');
  const token = await readToken();
  if (!token) return failed('no-token', null);

  let response: Response;
  try {
    response = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: OPERATIONS[operation as OperationName].document,
        variables: checked,
      }),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    return failed('network', 'Could not reach api.github.com.');
  }

  let body: {
    data?: unknown;
    errors?: Array<{ type?: string; message?: string }>;
    message?: string;
  };
  try {
    body = await response.json();
  } catch {
    return failed('failed', `GitHub answered with status ${response.status}.`);
  }
  if (response.status === 401 || response.status === 403) {
    return failed('forbidden', body.message ?? null);
  }
  const error = body.errors?.[0];
  if (error) {
    const message = error.message ?? null;
    const forbidden =
      error.type === 'FORBIDDEN' || /not accessible|must have|permission/i.test(message ?? '');
    return failed(forbidden ? 'forbidden' : 'invalid', message);
  }
  if (!response.ok) return failed('failed', body.message ?? null);
  return { ok: true, failure: null, data: body.data ?? null, message: null };
}

type RepoFlags = Record<string, { hasOpenSpec: boolean; at: number }>;

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'api':
      return callApi(message.path, message.etag);
    case 'graphql':
      return callGraphql(message.operation, message.variables);
    case 'token-status':
      return { hasToken: (await readToken()) !== null };
    case 'open-options':
      await browser.runtime.openOptionsPage();
      return null;
    case 'review-get': {
      const key = `review:${message.key}`;
      return ((await browser.storage.local.get(key))[key] as ReviewState | undefined) ?? null;
    }
    case 'review-set':
      await browser.storage.local.set({ [`review:${message.key}`]: message.state });
      return null;
    case 'prefs-get': {
      const stored = (await browser.storage.local.get('prefs')).prefs as
        | Partial<Preferences>
        | undefined;
      return { ...DEFAULT_PREFERENCES, ...stored };
    }
    case 'prefs-set':
      await browser.storage.local.set({ prefs: message.prefs });
      return null;
    case 'repo-flag-get': {
      const flags =
        ((await browser.storage.local.get('repos')).repos as RepoFlags | undefined) ?? {};
      const flag = flags[message.repo.toLowerCase()];
      return flag && Date.now() - flag.at < REPO_FLAG_TTL
        ? { hasOpenSpec: flag.hasOpenSpec }
        : null;
    }
    case 'repo-flag-set': {
      const flags =
        ((await browser.storage.local.get('repos')).repos as RepoFlags | undefined) ?? {};
      const now = Date.now();
      for (const [repo, flag] of Object.entries(flags)) {
        if (now - flag.at >= REPO_FLAG_TTL) delete flags[repo];
      }
      flags[message.repo.toLowerCase()] = { hasOpenSpec: message.hasOpenSpec, at: now };
      await browser.storage.local.set({ repos: flags });
      return null;
    }
  }
}

/** Forget review progress of pull requests nobody has looked at for half a year. */
async function pruneReviewState(): Promise<void> {
  const all = await browser.storage.local.get(null);
  const stale: string[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('review:')) continue;
    const items = Object.values((value as ReviewState | undefined)?.items ?? {});
    const latest = Math.max(0, ...items.map((item) => item.at));
    if (Date.now() - latest > REVIEW_TTL) stale.push(key);
  }
  if (stale.length > 0) await browser.storage.local.remove(stale);
}

export default defineBackground(() => {
  // Extension storage holds the token: keep it readable from extension pages only.
  browser.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
  browser.runtime.onInstalled.addListener(() => {
    void pruneReviewState();
  });

  browser.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return undefined;
    handle(message).then(sendResponse, () => sendResponse(null));
    return true;
  });
});
