import { sha256Hex } from './sha256';

export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

/** The pull request a URL points at, or null when it is not a PR page. */
export function parsePullUrl(url: string | URL): PullRef | null {
  const { hostname, pathname } = typeof url === 'string' ? new URL(url) : url;
  if (hostname !== 'github.com') return null;
  const match = PULL_PATH.exec(pathname);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export const pullKey = (pull: PullRef) => `${pull.owner}/${pull.repo}#${pull.number}`;

/**
 * The tab lives in the URL hash: `#openspec`, or `#openspec/<item id>` for a
 * deep link to a change, section or requirement.
 *
 * A hash is never sent to GitHub, so reload, back/forward and shared links
 * work without GitHub knowing the tab exists, and GitHub's own routers (Turbo
 * and React Router) treat a hash-only change as staying on the same page.
 */
export const HASH_PREFIX = '#openspec';

export interface TabRoute {
  active: boolean;
  /** Item id the link points at, e.g. `c/bks-142-group-rides/spec/ride-unlock/unlock-by-qr-code`. */
  target: string | null;
}

export function parseHash(hash: string): TabRoute {
  if (hash !== HASH_PREFIX && !hash.startsWith(`${HASH_PREFIX}/`)) {
    return { active: false, target: null };
  }
  const rest = hash.slice(HASH_PREFIX.length + 1);
  let target: string | null = null;
  try {
    target = rest ? decodeURIComponent(rest) : null;
  } catch {
    target = rest || null;
  }
  return { active: true, target };
}

export function hashFor(target: string | null): string {
  if (!target) return HASH_PREFIX;
  return `${HASH_PREFIX}/${target.split('/').map(encodeURIComponent).join('/')}`;
}

const repoUrl = (pull: PullRef) => `https://github.com/${pull.owner}/${pull.repo}`;
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** A shareable link to the tab, or to one item in it. */
export function deepLink(pull: PullRef, target: string | null): string {
  return `${repoUrl(pull)}/pull/${pull.number}${hashFor(target)}`;
}

/**
 * A line in the PR's "Files changed" view. GitHub anchors a diffed file as
 * `diff-<sha256 of its path>` and a line as that plus `R<n>` (new side) or
 * `L<n>` (old side).
 */
export function diffLineUrl(pull: PullRef, path: string, line: number, side: 'L' | 'R'): string {
  return `${repoUrl(pull)}/pull/${pull.number}/files#diff-${sha256Hex(path)}${side}${line}`;
}

export function diffFileUrl(pull: PullRef, path: string): string {
  return `${repoUrl(pull)}/pull/${pull.number}/files#diff-${sha256Hex(path)}`;
}

/** A branch of a repository (`owner/name`), as its file tree. */
export function treeUrl(repo: string, ref: string): string {
  return `https://github.com/${repo}/tree/${encodePath(ref)}`;
}

export const userUrl = (login: string) => `https://github.com/${encodeURIComponent(login)}`;

export function blobUrl(pull: PullRef, commit: string, path: string, line?: number): string {
  return `${repoUrl(pull)}/blob/${commit}/${encodePath(path)}${line ? `?plain=1#L${line}` : ''}`;
}

export function rawUrl(pull: PullRef, commit: string, path: string): string {
  return `${repoUrl(pull)}/raw/${commit}/${encodePath(path)}`;
}

export function searchPathUrl(pull: PullRef, commit: string, path: string): string {
  // `blob` redirects to `tree` for directories, so one form covers both.
  return blobUrl(pull, commit, path.replace(/\/+$/, ''));
}
