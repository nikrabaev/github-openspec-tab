import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  type ApiResult,
  DEFAULT_PREFERENCES,
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

type RepoFlags = Record<string, { hasOpenSpec: boolean; at: number }>;

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'api':
      return callApi(message.path, message.etag);
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
