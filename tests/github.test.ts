import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Backend, extensionBackend } from '../src/github/backend';
import { clearLoadCaches, LoadError, loadPull } from '../src/github/load';
import { type ApiResult, isAllowedApiPath } from '../src/github/messages';
import {
  blobUrl,
  deepLink,
  diffLineUrl,
  hashFor,
  parseHash,
  parsePullUrl,
} from '../src/github/route';
import { sha256Hex } from '../src/github/sha256';
import { FIXTURES, modelOf, readTree } from './helpers/fixtures';

const pull = { owner: 'pedalway', repo: 'pedalway', number: 128 };

describe('routes', () => {
  it('recognises pull request pages only', () => {
    expect(parsePullUrl('https://github.com/pedalway/pedalway/pull/128')).toEqual(pull);
    expect(
      parsePullUrl('https://github.com/pedalway/pedalway/pull/128/files?w=1#diff-abc'),
    ).toEqual(pull);
    expect(parsePullUrl('https://github.com/pedalway/pedalway/pulls')).toBeNull();
    expect(parsePullUrl('https://github.com/pedalway/pedalway/issues/128')).toBeNull();
    expect(parsePullUrl('https://example.com/pedalway/pedalway/pull/128')).toBeNull();
  });

  it('keeps the tab and its target in the URL hash', () => {
    expect(parseHash('')).toEqual({ active: false, target: null });
    expect(parseHash('#diff-abc')).toEqual({ active: false, target: null });
    expect(parseHash('#openspecial')).toEqual({ active: false, target: null });
    expect(parseHash('#openspec')).toEqual({ active: true, target: null });
    const target = 'c/bks-142-group-rides/spec/ride-unlock/unlock-by-qr-code';
    expect(hashFor(target)).toBe(`#openspec/${target}`);
    expect(parseHash(hashFor(target))).toEqual({ active: true, target });
    expect(parseHash(hashFor('specs/a b/ü'))).toEqual({ active: true, target: 'specs/a b/ü' });
    expect(deepLink(pull, target)).toBe(
      `https://github.com/pedalway/pedalway/pull/128#openspec/${target}`,
    );
  });

  it('anchors a line in Files changed the way GitHub does: sha256 of the path, then R or L and the line', () => {
    // Anchor of this file as it appears on a real pull request page.
    expect(sha256Hex('.changeset/view-current-work-only.md')).toBe(
      'ba68f805e3ca80ff9038889b724233c052dc2c08364c9f526c0e979a322b8cf1',
    );
    expect(diffLineUrl(pull, 'openspec/specs/ride-unlock/spec.md', 12, 'R')).toBe(
      `https://github.com/pedalway/pedalway/pull/128/files#diff-${sha256Hex('openspec/specs/ride-unlock/spec.md')}R12`,
    );
    expect(diffLineUrl(pull, 'a.md', 3, 'L')).toMatch(/L3$/);
    expect(blobUrl(pull, 'abc', 'docs/a b.md', 7)).toBe(
      'https://github.com/pedalway/pedalway/blob/abc/docs/a%20b.md?plain=1#L7',
    );
  });

  it('computes SHA-256 like the platform', () => {
    for (const text of [
      '',
      'abc',
      'ü/путь/файл.md',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(64),
      'x'.repeat(999),
    ]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });
});

describe('API allowlist', () => {
  const sha = 'a'.repeat(40);
  it('lets through only the four requests the loader makes', () => {
    expect(isAllowedApiPath('/repos/o/r/pulls/12')).toBe(true);
    expect(isAllowedApiPath(`/repos/o/r/compare/${sha}...${sha}?per_page=1&page=2`)).toBe(true);
    expect(isAllowedApiPath(`/repos/o/r/git/trees/${sha}:openspec?recursive=1`)).toBe(true);
    expect(isAllowedApiPath(`/repos/o/r/git/blobs/${sha}`)).toBe(true);
    expect(isAllowedApiPath('/repos/o/r/pulls/12/comments?per_page=100&page=1')).toBe(true);
  });

  it('refuses everything else, including dot segments', () => {
    for (const path of [
      '/user',
      '/repos/o/r',
      '/repos/o/r/pulls/12/files',
      '/repos/o/r/pulls/12/comments',
      '/repos/o/r/pulls/12/comments/3/replies',
      '/repos/o/r/issues/12/comments?per_page=100&page=1',
      '/repos/o/r/contents/secret',
      `/repos/o/r/git/trees/${sha}:../../x?recursive=1`,
      '/repos/../r/pulls/1',
      '/repos/o/r/pulls/1?x=https://evil.example',
      'https://evil.example/repos/o/r/pulls/1',
    ]) {
      expect(isAllowedApiPath(path), path).toBe(false);
    }
  });
});

/** These tests load pull requests; none of them reads comments. */
const noGraphql: Backend['graphql'] = async () => ({
  ok: false,
  failure: 'no-token',
  data: null,
  message: null,
});

const BASE_TIP = '1'.repeat(40);
const MERGE_BASE = '2'.repeat(40);
const HEAD = '3'.repeat(40);
const gitSha = (content: string) => createHash('sha1').update(content).digest('hex');
const ok = (data: unknown): ApiResult => ({
  ok: true,
  status: 200,
  data,
  message: null,
  rateLimit: null,
  authenticated: false,
  etag: null,
});
const failed = (status: number, extra: Partial<ApiResult> = {}): ApiResult => ({
  ...ok(null),
  ok: false,
  status,
  ...extra,
});

/** A stand-in for GitHub serving one fixture as a pull request. */
function fakeGitHub(fixture: string, options: { sessionWorks?: boolean } = {}) {
  const files = {
    base: readTree(`${FIXTURES}/${fixture}/base`),
    head: readTree(`${FIXTURES}/${fixture}/head`),
  };
  const sideOf = (commit: string) =>
    commit === HEAD ? files.head : commit === MERGE_BASE ? files.base : null;
  const blobs = new Map<string, string>();
  for (const side of [files.base, files.head]) {
    for (const content of Object.values(side)) blobs.set(gitSha(content), content);
  }
  const calls: string[] = [];
  const rawCalls: string[] = [];
  const backend: Backend = {
    graphql: noGraphql,
    async api(path) {
      calls.push(path);
      if (/\/pulls\/\d+$/.test(path)) {
        // A draft from a fork, with the fields of GitHub's answer that the loader reads.
        return ok({
          state: 'open',
          merged: false,
          title: 'Group rides: unlock and bill several bikes together',
          draft: true,
          commits: 9,
          user: { login: 'mira' },
          merged_by: null,
          base: {
            sha: BASE_TIP,
            ref: 'main',
            label: 'pedalway:main',
            repo: { full_name: 'pedalway/pedalway' },
          },
          head: {
            sha: HEAD,
            ref: 'bks-142-group-rides',
            label: 'mira:bks-142-group-rides',
            repo: { full_name: 'mira/pedalway' },
          },
        });
      }
      if (path.includes('/compare/'))
        return ok({ merge_base_commit: { sha: MERGE_BASE }, commits: [], files: [] });
      const tree = /\/git\/trees\/([0-9a-f]{40}):openspec\?recursive=1$/.exec(path);
      if (tree?.[1]) {
        const side = sideOf(tree[1]);
        const entries = Object.entries(side ?? {})
          .filter(([file]) => file.startsWith('openspec/'))
          .map(([file, content]) => ({
            path: file.slice('openspec/'.length),
            type: 'blob',
            sha: gitSha(content),
          }));
        if (entries.length === 0) return failed(404);
        return ok({
          truncated: false,
          tree: [{ path: 'changes', type: 'tree', sha: 'f'.repeat(40) }, ...entries],
        });
      }
      const blob = /\/git\/blobs\/([0-9a-f]{40})$/.exec(path);
      if (blob?.[1]) {
        return ok({
          encoding: 'base64',
          content: Buffer.from(blobs.get(blob[1]) ?? '', 'utf8').toString('base64'),
        });
      }
      return failed(404);
    },
    async raw(_pull, commit, path) {
      rawCalls.push(`${commit}:${path}`);
      if (options.sessionWorks === false) throw new Error('blocked');
      return sideOf(commit)?.[path] ?? null;
    },
    probe: async () => true,
  };
  return { backend, calls, rawCalls };
}

describe('loadPull', () => {
  beforeEach(clearLoadCaches);

  it('needs four API calls, whatever the size of the pull request, and compares against the merge base', async () => {
    const { backend, calls, rawCalls } = fakeGitHub('showcase');
    const loaded = await loadPull(pull, backend);
    expect(calls).toEqual([
      '/repos/pedalway/pedalway/pulls/128',
      `/repos/pedalway/pedalway/git/trees/${HEAD}:openspec?recursive=1`,
      `/repos/pedalway/pedalway/compare/${BASE_TIP}...${HEAD}?per_page=1&page=2`,
      `/repos/pedalway/pedalway/git/trees/${MERGE_BASE}:openspec?recursive=1`,
    ]);
    expect(loaded.facts).toEqual({
      baseSha: MERGE_BASE,
      headSha: HEAD,
      state: 'open',
      title: 'Group rides: unlock and bill several bikes together',
      draft: true,
      author: 'mira',
      mergedBy: null,
      commits: 9,
      base: { label: 'pedalway:main', ref: 'main', repo: 'pedalway/pedalway' },
      head: {
        label: 'mira:bks-142-group-rides',
        ref: 'bks-142-group-rides',
        repo: 'mira/pedalway',
      },
    });
    // Same result as building the model straight from the fixture files.
    const direct = modelOf('showcase').model;
    expect(loaded.model.requirementChanges).toBe(direct.requirementChanges);
    expect(loaded.model.counts).toEqual(direct.counts);
    expect(loaded.model.directEdits.map((e) => e.capability)).toEqual(['rider-notifications']);
    expect(loaded.glossary.map((t) => t.term)).toContain('Group ride');
    // Files are read with the session; the untouched archive is never fetched.
    expect(rawCalls.length).toBe(loaded.plan.loads.length + 1);
    expect(rawCalls.some((call) => call.includes('bks-101'))).toBe(false);
    expect(
      await loaded.readFile(
        'head',
        'openspec/changes/bks-142-group-rides/group-unlock-flow.excalidraw.svg',
      ),
    ).toContain('<svg');
  });

  it('falls back to the API for file contents when the session cannot read them', async () => {
    const { backend, calls } = fakeGitHub('showcase', { sessionWorks: false });
    const loaded = await loadPull(pull, backend);
    expect(loaded.model.requirementChanges).toBe(14);
    expect(calls.filter((path) => path.includes('/git/blobs/')).length).toBe(
      loaded.plan.loads.length,
    );
    expect(loaded.glossary).toEqual([]);
  });

  it('shows an empty model when the pull request has no openspec directory', async () => {
    const { backend } = fakeGitHub('empty');
    const loaded = await loadPull(pull, backend);
    expect(loaded.model.isEmpty).toBe(true);
    expect(loaded.plan.loads).toEqual([]);
  });

  it('turns API failures into errors the UI can explain', async () => {
    const kindFor = async (result: ApiResult) => {
      clearLoadCaches();
      const backend: Backend = {
        api: async () => result,
        raw: async () => null,
        probe: async () => null,
        graphql: noGraphql,
      };
      return loadPull(pull, backend).then(
        () => 'loaded',
        (error: unknown) => (error instanceof LoadError ? error.kind : 'other'),
      );
    };
    expect(await kindFor(failed(404))).toBe('needs-token');
    expect(await kindFor(failed(404, { authenticated: true }))).toBe('no-access');
    expect(await kindFor(failed(401, { authenticated: true }))).toBe('bad-token');
    expect(await kindFor(failed(403, { rateLimit: { limit: 60, remaining: 0, reset: 1 } }))).toBe(
      'rate-limited',
    );
    expect(
      await kindFor(failed(429, { message: 'You have exceeded a secondary rate limit' })),
    ).toBe('rate-limited');
    expect(
      await kindFor(
        failed(403, { message: 'Resource protected by organization SAML enforcement' }),
      ),
    ).toBe('forbidden');
    expect(await kindFor(failed(0, { message: 'offline' }))).toBe('network');
    expect(await kindFor(failed(500))).toBe('unknown');
  });
});

/**
 * What a content script has to fetch with. Chromium: its own `fetch`, which acts as the page.
 * Gecko: its own `fetch`, which fails where the answer is a redirect to another host, and
 * `content.fetch`, the page's.
 */
describe('extensionBackend', () => {
  afterEach(() => vi.unstubAllGlobals());

  const refused = async (): Promise<Response> => {
    throw new TypeError('NetworkError when attempting to fetch resource.');
  };
  const rawFile = `https://github.com/pedalway/pedalway/raw/${HEAD}/openspec/specs/ride%20unlock/spec.md`;

  it('reads files with the fetch of the page where content scripts are given one', async () => {
    const own = vi.fn(refused);
    const page = vi.fn(async () => new Response('# Ride unlock'));
    vi.stubGlobal('fetch', own);
    vi.stubGlobal('content', { fetch: page });
    expect(await extensionBackend.raw(pull, HEAD, 'openspec/specs/ride unlock/spec.md')).toBe(
      '# Ride unlock',
    );
    expect(page).toHaveBeenCalledWith(rawFile, { credentials: 'same-origin' });
    expect(await extensionBackend.probe(pull, 'openspec')).toBe(true);
    expect(page).toHaveBeenLastCalledWith(
      'https://github.com/pedalway/pedalway/tree/HEAD/openspec',
      {
        method: 'HEAD',
        credentials: 'same-origin',
      },
    );
    expect(own).not.toHaveBeenCalled();
  });

  it('reads files with its own fetch elsewhere, whatever the page calls content', async () => {
    const own = vi.fn(async () => new Response('# Ride unlock'));
    vi.stubGlobal('fetch', own);
    expect(await extensionBackend.raw(pull, HEAD, 'openspec/specs/ride unlock/spec.md')).toBe(
      '# Ride unlock',
    );
    // What `content` is in a page with such an element: the element, which has no `fetch`.
    vi.stubGlobal('content', { id: 'content', tagName: 'DIV' });
    expect(await extensionBackend.raw(pull, HEAD, 'openspec/specs/ride unlock/spec.md')).toBe(
      '# Ride unlock',
    );
    expect(own.mock.calls).toEqual([
      [rawFile, { credentials: 'same-origin' }],
      [rawFile, { credentials: 'same-origin' }],
    ]);
  });

  it('tells a file the session cannot see from a request that failed', async () => {
    vi.stubGlobal('fetch', async () => new Response('Not Found', { status: 404 }));
    expect(await extensionBackend.raw(pull, HEAD, 'openspec/project.md')).toBeNull();
    expect(await extensionBackend.probe(pull, 'openspec')).toBe(false);
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    await expect(extensionBackend.raw(pull, HEAD, 'openspec/project.md')).rejects.toThrow('503');
    expect(await extensionBackend.probe(pull, 'openspec')).toBeNull();
    vi.stubGlobal('fetch', refused);
    await expect(extensionBackend.raw(pull, HEAD, 'openspec/project.md')).rejects.toThrow();
    expect(await extensionBackend.probe(pull, 'openspec')).toBeNull();
  });

  it('spends no API calls on files where only the fetch of the page follows the redirect', async () => {
    clearLoadCaches();
    const { backend, calls, rawCalls } = fakeGitHub('showcase');
    // GitHub as the page sees it: `/raw/<commit>/<path>` answers with the file.
    const page = vi.fn(async (url: string) => {
      const [, commit = '', path = ''] = /\/raw\/([0-9a-f]{40})\/(.+)$/.exec(url) ?? [];
      const text = await backend.raw(pull, commit, decodeURIComponent(path));
      return text === null ? new Response('Not Found', { status: 404 }) : new Response(text);
    });
    vi.stubGlobal('fetch', vi.fn(refused));
    vi.stubGlobal('content', { fetch: page });
    const loaded = await loadPull(pull, { ...backend, raw: extensionBackend.raw });
    expect(loaded.model.requirementChanges).toBe(14);
    expect(rawCalls.length).toBe(loaded.plan.loads.length + 1);
    expect(calls.filter((path) => path.includes('/git/blobs/'))).toEqual([]);
    expect(calls.length).toBe(4);
  });
});
