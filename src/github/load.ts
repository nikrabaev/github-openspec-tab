import {
  buildModel,
  type GlossaryTerm,
  type LoadPlan,
  type PrModel,
  parseGlossary,
  planLoads,
} from '@/openspec';
import type { Backend } from './backend';
import type { ApiResult } from './messages';
import type { PullRef } from './route';

export type LoadErrorKind =
  /** 404 without a token: a private repository, or no such pull request. */
  | 'needs-token'
  /** 404 with a token: the token cannot see this repository. */
  | 'no-access'
  /** 401: the token is wrong, expired or revoked. */
  | 'bad-token'
  | 'rate-limited'
  /** 403 for another reason, e.g. the organisation requires SSO or token approval. */
  | 'forbidden'
  | 'network'
  | 'unknown';

export class LoadError extends Error {
  constructor(
    readonly kind: LoadErrorKind,
    message: string,
    readonly detail: { authenticated: boolean; resetAt: number | null; status: number },
  ) {
    super(message);
    this.name = 'LoadError';
  }
}

function toLoadError(result: ApiResult): LoadError {
  const detail = {
    authenticated: result.authenticated,
    resetAt: result.rateLimit?.reset ?? null,
    status: result.status,
  };
  const limited =
    (result.status === 403 || result.status === 429) &&
    (result.rateLimit?.remaining === 0 || /rate limit/i.test(result.message ?? ''));
  if (result.status === 0)
    return new LoadError('network', result.message ?? 'Network error', detail);
  if (limited) return new LoadError('rate-limited', 'GitHub API rate limit reached', detail);
  if (result.status === 401) return new LoadError('bad-token', 'The token was rejected', detail);
  if (result.status === 404) {
    return new LoadError(result.authenticated ? 'no-access' : 'needs-token', 'Not found', detail);
  }
  if (result.status === 403) {
    return new LoadError('forbidden', result.message ?? 'Access denied', detail);
  }
  return new LoadError('unknown', result.message ?? `GitHub answered ${result.status}`, detail);
}

export interface PullFacts {
  /** Merge base of the base branch and the head: what "before" means, as in Files changed. */
  baseSha: string;
  headSha: string;
  baseRef: string;
  state: 'open' | 'closed' | 'merged';
}

export interface LoadedPull {
  pull: PullRef;
  facts: PullFacts;
  plan: LoadPlan;
  model: PrModel;
  glossary: GlossaryTerm[];
  /** Things that went wrong without stopping the load. */
  warnings: string[];
  /** Read any file of the PR, for diagrams and other lazily shown content. */
  readFile(side: 'base' | 'head', path: string): Promise<string | null>;
}

interface PullResponse {
  state: string;
  merged: boolean;
  base: { sha: string; ref: string };
  head: { sha: string };
}

interface TreeResponse {
  truncated?: boolean;
  tree: Array<{ path: string; type: string; sha: string }>;
}

// Immutable by construction (keyed by commit or blob SHA), so they live as long as the page.
const blobCache = new Map<string, string>();
const treeCache = new Map<string, { tree: Map<string, string>; truncated: boolean }>();
const mergeBaseCache = new Map<string, string>();
const pullCache = new Map<string, { etag: string; data: PullResponse }>();

/** Forget everything fetched so far. The caches are keyed by SHA, so this is only needed in tests. */
export function clearLoadCaches(): void {
  blobCache.clear();
  treeCache.clear();
  mergeBaseCache.clear();
  pullCache.clear();
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item !== undefined) results[index] = await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function decodeBase64(content: string): string {
  const binary = atob(content.replace(/\s+/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/**
 * Load everything the tab shows for one pull request.
 *
 * Four small API calls give the facts and the two `openspec/` trees: the pull
 * request, its merge base, and one recursive tree per side. Changed files are
 * found by comparing blob SHAs between the trees, so the cost does not grow
 * with the number of files the PR touches. File contents then come from
 * github.com with the signed-in session, falling back to the API.
 */
export async function loadPull(
  pull: PullRef,
  backend: Backend,
  root = 'openspec',
): Promise<LoadedPull> {
  const repo = `/repos/${pull.owner}/${pull.repo}`;
  const key = `${pull.owner}/${pull.repo}#${pull.number}`;
  const warnings: string[] = [];

  const cached = pullCache.get(key);
  const pullResult = await backend.api(`${repo}/pulls/${pull.number}`, cached?.etag);
  if (!pullResult.ok) throw toLoadError(pullResult);
  const info =
    pullResult.status === 304 && cached ? cached.data : (pullResult.data as PullResponse);
  if (pullResult.status !== 304 && pullResult.etag) {
    pullCache.set(key, { etag: pullResult.etag, data: info });
  }

  const fetchTree = async (commit: string) => {
    const hit = treeCache.get(`${repo}@${commit}`);
    if (hit) return hit;
    const result = await backend.api(`${repo}/git/trees/${commit}:${root}?recursive=1`);
    // No openspec/ directory at this commit.
    if (result.status === 404) return { tree: new Map<string, string>(), truncated: false };
    if (!result.ok) throw toLoadError(result);
    const body = result.data as TreeResponse;
    const tree = new Map<string, string>();
    for (const entry of body.tree) {
      if (entry.type === 'blob') tree.set(`${root}/${entry.path}`, entry.sha);
    }
    const value = { tree, truncated: Boolean(body.truncated) };
    treeCache.set(`${repo}@${commit}`, value);
    return value;
  };

  const fetchMergeBase = async () => {
    const range = `${info.base.sha}...${info.head.sha}`;
    const hit = mergeBaseCache.get(`${repo}:${range}`);
    if (hit) return hit;
    // Page 2 of one commit per page: the merge base without the (large) file list.
    const result = await backend.api(`${repo}/compare/${range}?per_page=1&page=2`);
    if (!result.ok) throw toLoadError(result);
    const sha = (result.data as { merge_base_commit?: { sha?: string } }).merge_base_commit?.sha;
    if (!sha) return info.base.sha;
    mergeBaseCache.set(`${repo}:${range}`, sha);
    return sha;
  };

  const [head, baseSha] = await Promise.all([fetchTree(info.head.sha), fetchMergeBase()]);
  const base = await fetchTree(baseSha);
  if (head.truncated || base.truncated) {
    warnings.push(
      'The openspec/ directory is too large for GitHub to list in full; some files may be missing.',
    );
  }

  const facts: PullFacts = {
    baseSha,
    headSha: info.head.sha,
    baseRef: info.base.ref,
    state: info.merged ? 'merged' : info.state === 'open' ? 'open' : 'closed',
  };
  const commitOf = (side: 'base' | 'head') => (side === 'base' ? facts.baseSha : facts.headSha);

  let sessionWorks = true;
  const readBlob = async (
    side: 'base' | 'head',
    path: string,
    sha: string,
  ): Promise<string | null> => {
    const hit = blobCache.get(sha);
    if (hit !== undefined) return hit;
    let text: string | null = null;
    if (sessionWorks) {
      try {
        text = await backend.raw(pull, commitOf(side), path);
      } catch {
        text = null;
      }
      // The tree says the file exists, so a miss means the session cannot read this repository.
      if (text === null) sessionWorks = false;
    }
    if (text === null) {
      const result = await backend.api(`${repo}/git/blobs/${sha}`);
      if (!result.ok) throw toLoadError(result);
      const blob = result.data as { content?: string; encoding?: string };
      text = blob.encoding === 'base64' ? decodeBase64(blob.content ?? '') : (blob.content ?? '');
    }
    blobCache.set(sha, text);
    return text;
  };

  const plan = planLoads(base.tree, head.tree, root);
  await mapLimit(plan.loads, 6, (load) => readBlob(load.side, load.path, load.sha));

  // The glossary is optional and lives outside openspec/: read it quietly, from the base.
  let glossary: GlossaryTerm[] = [];
  if (plan.loads.length > 0) {
    for (const path of ['docs/CONTEXT.md', 'CONTEXT.md']) {
      try {
        const text = await backend.raw(pull, facts.baseSha, path);
        if (text) {
          glossary = parseGlossary(text);
          break;
        }
      } catch {
        break;
      }
    }
  }

  return {
    pull,
    facts,
    plan,
    model: buildModel(plan, blobCache),
    glossary,
    warnings,
    async readFile(side, path) {
      const sha = (side === 'base' ? base.tree : head.tree).get(path);
      if (!sha) return null;
      try {
        return await readBlob(side, path, sha);
      } catch {
        return null;
      }
    },
  };
}
