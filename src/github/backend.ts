import type { ApiResult, Message, MessageResult } from './messages';
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
}

export async function send<M extends Message>(message: M): Promise<MessageResult[M['type']]> {
  const { browser } = await import('wxt/browser');
  return (await browser.runtime.sendMessage(message)) as MessageResult[M['type']];
}

/**
 * The real backend. API calls go through the background worker, which holds
 * the token. File contents are read from github.com itself: `/raw/` is
 * same-origin for the content script, so the browser sends the session cookie,
 * and the redirect it answers with points at raw.githubusercontent.com, which
 * allows any origin.
 */
export const extensionBackend: Backend = {
  api: (path, etag) => send({ type: 'api', path, ...(etag ? { etag } : {}) }),

  async raw(pull, commit, path) {
    const response = await fetch(rawUrl(pull, commit, path), { credentials: 'same-origin' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`raw request failed with ${response.status}`);
    return response.text();
  },

  async probe(pull, root) {
    try {
      const response = await fetch(
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
