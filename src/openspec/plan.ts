import { type ChangeFileRole, classifyPath, specPath, type Tree } from './paths';

export type FileStatus = 'added' | 'modified' | 'unchanged' | 'removed';

export type ChangeStatus =
  /** A change directory under `changes/` that this PR adds or edits. */
  | 'in-progress'
  /** Moved to `changes/archive/` by this PR. */
  | 'archived'
  /** Already archived before this PR; the PR edits its files. */
  | 'archive-edited'
  /** Removed by this PR without being archived. */
  | 'deleted';

export interface ChangeFile {
  /** Path at head, or at base for a deleted change. */
  path: string;
  rel: string;
  role: ChangeFileRole;
  capability: string | null;
  /** Blob SHA at head (at base for a deleted change). */
  sha: string;
  basePath: string | null;
  baseSha: string | null;
  status: FileStatus;
}

export interface ChangeRef {
  /** Change name without archive date. */
  name: string;
  dirName: string;
  dir: string;
  status: ChangeStatus;
  date: string | null;
  /** True when the change did not exist at base in any form. */
  isNew: boolean;
  files: ChangeFile[];
}

export interface SpecRef {
  capability: string;
  path: string;
  baseSha: string | null;
  headSha: string | null;
}

export interface OtherFile {
  path: string;
  status: FileStatus;
}

export interface BlobLoad {
  side: 'base' | 'head';
  path: string;
  sha: string;
}

export interface LoadPlan {
  root: string;
  changes: ChangeRef[];
  capabilities: SpecRef[];
  /** Changed files under the OpenSpec root that belong to no change and are not specs. */
  otherFiles: OtherFile[];
  /** Blobs whose text the model needs, de-duplicated by SHA. */
  loads: BlobLoad[];
}

interface DirFiles {
  dir: string;
  dirName: string;
  name: string;
  date: string | null;
  archived: boolean;
  files: Map<
    string,
    { path: string; sha: string; role: ChangeFileRole; capability: string | null }
  >;
}

function groupChangeDirs(tree: Tree, root: string): Map<string, DirFiles> {
  const dirs = new Map<string, DirFiles>();
  for (const [path, sha] of tree) {
    const info = classifyPath(path, root);
    if (info?.kind !== 'change-file') continue;
    let dir = dirs.get(info.dir);
    if (!dir) {
      dir = {
        dir: info.dir,
        dirName: info.dirName,
        name: info.name,
        date: info.date,
        archived: info.archived,
        files: new Map(),
      };
      dirs.set(info.dir, dir);
    }
    dir.files.set(info.rel, { path, sha, role: info.role, capability: info.capability });
  }
  return dirs;
}

const TEXT_ROLES: ReadonlySet<ChangeFileRole> = new Set(['proposal', 'design', 'tasks', 'delta']);

/**
 * Work out, from the two `openspec/` trees alone, which changes and
 * capabilities a pull request touches and which blobs must be read to show
 * them. No file content is needed for this, so it costs nothing on a PR with
 * hundreds of unrelated files.
 */
export function planLoads(base: Tree, head: Tree, root = 'openspec'): LoadPlan {
  const baseDirs = groupChangeDirs(base, root);
  const headDirs = groupChangeDirs(head, root);
  const changes: ChangeRef[] = [];
  const claimedBaseDirs = new Set<string>();

  for (const headDir of headDirs.values()) {
    // Where this change lived at base: the same directory, or (for a change
    // archived by this PR) its active directory.
    let baseDir = baseDirs.get(headDir.dir);
    if (!baseDir && headDir.archived) {
      baseDir = [...baseDirs.values()].find((dir) => !dir.archived && dir.name === headDir.name);
    }
    if (baseDir) claimedBaseDirs.add(baseDir.dir);

    const files: ChangeFile[] = [];
    let changed = false;
    for (const [rel, file] of headDir.files) {
      const before = baseDir?.files.get(rel);
      const status: FileStatus = !before
        ? 'added'
        : before.sha === file.sha
          ? 'unchanged'
          : 'modified';
      if (status !== 'unchanged') changed = true;
      files.push({
        path: file.path,
        rel,
        role: file.role,
        capability: file.capability,
        sha: file.sha,
        basePath: before?.path ?? null,
        baseSha: before?.sha ?? null,
        status,
      });
    }
    const dropped = baseDir
      ? [...baseDir.files.keys()].filter((rel) => !headDir.files.has(rel))
      : [];
    const moved = Boolean(baseDir && baseDir.dir !== headDir.dir);
    if (!changed && dropped.length === 0 && !moved) continue;

    changes.push({
      name: headDir.name,
      dirName: headDir.dirName,
      dir: headDir.dir,
      status: !headDir.archived
        ? 'in-progress'
        : baseDir?.dir === headDir.dir
          ? 'archive-edited'
          : 'archived',
      date: headDir.date,
      isNew: !baseDir,
      files: files.sort((a, b) => a.rel.localeCompare(b.rel)),
    });
  }

  for (const baseDir of baseDirs.values()) {
    if (claimedBaseDirs.has(baseDir.dir) || headDirs.has(baseDir.dir)) continue;
    changes.push({
      name: baseDir.name,
      dirName: baseDir.dirName,
      dir: baseDir.dir,
      status: 'deleted',
      date: baseDir.date,
      isNew: false,
      files: [...baseDir.files]
        .map(([rel, file]) => ({
          path: file.path,
          rel,
          role: file.role,
          capability: file.capability,
          sha: file.sha,
          basePath: file.path,
          baseSha: file.sha,
          status: 'removed' as const,
        }))
        .sort((a, b) => a.rel.localeCompare(b.rel)),
    });
  }

  // Archived changes first, in date order (they were applied in that order), then the rest.
  const rank: Record<ChangeStatus, number> = {
    archived: 0,
    'in-progress': 1,
    'archive-edited': 2,
    deleted: 3,
  };
  changes.sort((a, b) => rank[a.status] - rank[b.status] || a.dirName.localeCompare(b.dirName));

  // Capabilities: every delta of a touched change, plus every main spec the PR changes.
  const capabilityIds = new Set<string>();
  for (const change of changes) {
    for (const file of change.files) {
      if (file.role === 'delta' && file.capability) capabilityIds.add(file.capability);
    }
  }
  const otherFiles: OtherFile[] = [];
  for (const path of new Set([...base.keys(), ...head.keys()])) {
    const baseSha = base.get(path);
    const headSha = head.get(path);
    if (baseSha === headSha) continue;
    const info = classifyPath(path, root);
    if (info?.kind === 'spec') capabilityIds.add(info.capability);
    else if (info?.kind === 'other') {
      otherFiles.push({ path, status: !baseSha ? 'added' : !headSha ? 'removed' : 'modified' });
    }
  }
  const capabilities: SpecRef[] = [...capabilityIds].sort().map((capability) => {
    const path = specPath(capability, root);
    return {
      capability,
      path,
      baseSha: base.get(path) ?? null,
      headSha: head.get(path) ?? null,
    };
  });

  const loads = new Map<string, BlobLoad>();
  const need = (side: 'base' | 'head', path: string | null, sha: string | null) => {
    if (path && sha && !loads.has(sha)) loads.set(sha, { side, path, sha });
  };
  for (const change of changes) {
    const side = change.status === 'deleted' ? 'base' : 'head';
    for (const file of change.files) {
      if (!TEXT_ROLES.has(file.role)) continue;
      need(side, file.path, file.sha);
      // The base copy of an edited tasks or delta file: for progress made in
      // this PR and for which lines can be commented on.
      if (file.status === 'modified' && (file.role === 'tasks' || file.role === 'delta')) {
        need('base', file.basePath, file.baseSha);
      }
    }
  }
  for (const capability of capabilities) {
    need('base', capability.path, capability.baseSha);
    need('head', capability.path, capability.headSha);
  }

  return {
    root,
    changes,
    capabilities,
    otherFiles: otherFiles.sort((a, b) => a.path.localeCompare(b.path)),
    loads: [...loads.values()],
  };
}
