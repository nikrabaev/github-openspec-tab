import { splitArchiveName } from './names';

/** Blob paths (from the repository root) mapped to their blob SHA. */
export type Tree = ReadonlyMap<string, string>;

export type ChangeFileRole =
  | 'proposal'
  | 'design'
  | 'tasks'
  | 'delta'
  | 'diagram'
  | 'meta'
  | 'other';

export type OpenSpecPath =
  | { kind: 'spec'; capability: string }
  | {
      kind: 'change-file';
      /** Directory of the change, from the repository root. */
      dir: string;
      /** Last segment of `dir`: the change name, date-prefixed when archived. */
      dirName: string;
      archived: boolean;
      /** Change name without the archive date. */
      name: string;
      date: string | null;
      /** Path of the file inside the change directory. */
      rel: string;
      role: ChangeFileRole;
      /** Capability id, for a delta spec. */
      capability: string | null;
    }
  | { kind: 'other' };

function roleOf(rel: string): { role: ChangeFileRole; capability: string | null } {
  if (rel === 'proposal.md') return { role: 'proposal', capability: null };
  if (rel === 'design.md') return { role: 'design', capability: null };
  if (rel === 'tasks.md') return { role: 'tasks', capability: null };
  if (rel === '.openspec.yaml') return { role: 'meta', capability: null };
  const delta = /^specs\/(.+)\/spec\.md$/.exec(rel);
  if (delta?.[1] && !delta[1].split('/').some((segment) => segment.startsWith('.'))) {
    return { role: 'delta', capability: delta[1] };
  }
  if (/\.excalidraw\.svg$/i.test(rel)) return { role: 'diagram', capability: null };
  return { role: 'other', capability: null };
}

/** Classify a repository path under the OpenSpec root; `null` when it is outside it. */
export function classifyPath(path: string, root = 'openspec'): OpenSpecPath | null {
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);

  const spec = /^specs\/(.+)\/spec\.md$/.exec(rest);
  if (spec?.[1] && !spec[1].split('/').some((segment) => segment.startsWith('.'))) {
    return { kind: 'spec', capability: spec[1] };
  }

  const archived = /^changes\/archive\/([^/]+)\/(.+)$/.exec(rest);
  if (archived?.[1] && archived[2]) {
    const { date, name } = splitArchiveName(archived[1]);
    return {
      kind: 'change-file',
      dir: `${prefix}changes/archive/${archived[1]}`,
      dirName: archived[1],
      archived: true,
      name,
      date,
      rel: archived[2],
      ...roleOf(archived[2]),
    };
  }

  const active = /^changes\/([^/]+)\/(.+)$/.exec(rest);
  if (active?.[1] && active[2] && active[1] !== 'archive') {
    return {
      kind: 'change-file',
      dir: `${prefix}changes/${active[1]}`,
      dirName: active[1],
      archived: false,
      name: active[1],
      date: null,
      rel: active[2],
      ...roleOf(active[2]),
    };
  }
  return { kind: 'other' };
}

export function specPath(capability: string, root = 'openspec'): string {
  return `${root}/specs/${capability}/spec.md`;
}
