import type { GraphqlVariables, OperationName } from './graphql';
import type { ApiResult, GraphqlResult, Message, MessageResult } from './messages';
import { type PullRef, rawUrl } from './route';

/** Everything the loader needs from the outside world. The dev harness supplies its own. */
export interface Backend {
  api(path: string, etag?: string): Promise<ApiResult>;
  /**
   * Read a file at a commit with the signed-in session. Resolves to null when
   * GitHub answers 404; throws when the request itself fails.
   */
  raw(pull: PullRef, commit: string, path: string): Promise<string | null>;
  /** Whether `openspec/` exists on the default branch. `null` when that could not be found out. */
  probe(pull: PullRef, root: string): Promise<boolean | null>;
  /** Run one of the review-comment operations. Fails with `no-token` when none is stored. */
  graphql(operation: OperationName, variables: GraphqlVariables): Promise<GraphqlResult>;
}

export async function send<M extends Message>(message: M): Promise<MessageResult[M['type']]> {
  const { browser } = await import('wxt/browser');
  return (await browser.runtime.sendMessage(message)) as MessageResult[M['type']];
}

/**
 * Gecko's handle on the page, for a content script: `content.fetch` is the page's own `fetch`.
 * Chromium has no such global (and a page element with the id `content` is not one).
 */
declare const content: { fetch?: typeof fetch } | undefined;

/**
 * Fetch from github.com as the page itself would.
 *
 * In Chromium a content script's `fetch` is already that. In Gecko it is a request of the
 * extension's own kind: it reaches the hosts in `host_permissions` with the page's cookies, but
 * is refused as soon as it needs CORS, because Gecko has no `Origin` header to send for it. The
 * redirect `/raw/` answers with needs CORS, so there every file read failed and cost an API call
 * instead. `content.fetch` makes the request as the page, under GitHub's content security policy,
 * which lets the page connect to raw.githubusercontent.com.
 */
function pageFetch(url: string, init: RequestInit): Promise<Response> {
  if (typeof content !== 'undefined' && typeof content.fetch === 'function') {
    return content.fetch(url, init);
  }
  return fetch(url, init);
}

/**
 * The real backend. API calls go through the background worker, which holds
 * the token. File contents are read from github.com itself: `/raw/` is
 * same-origin for the page, so the browser sends the session cookie, and the
 * redirect it answers with points at raw.githubusercontent.com, which allows
 * any origin.
 */
export const extensionBackend: Backend = {
  api: (path, etag) => send({ type: 'api', path, ...(etag ? { etag } : {}) }),
  async graphql(operation, variables) {
    const result = await send({ type: 'graphql', operation, variables });
    // After a rebuild the browser can run the new content script against the background
    // script it started earlier, which does not know this message and answers nothing.
    return result ?? { ok: false, failure: 'stale', data: null, message: null };
  },

  async raw(pull, commit, path) {
    const response = await pageFetch(rawUrl(pull, commit, path), { credentials: 'same-origin' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`raw request failed with ${response.status}`);
    return response.text();
  },

  async probe(pull, root) {
    try {
      const response = await pageFetch(
        `https://github.com/${pull.owner}/${pull.repo}/tree/HEAD/${root}`,
        { method: 'HEAD', credentials: 'same-origin' },
      );
      if (response.ok) return true;
      return response.status === 404 ? false : null;
    } catch {
      return null;
    }
  },
};
