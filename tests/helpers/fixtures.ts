import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildModel, planLoads, type Snapshot, snapshotFromFiles } from '../../src/openspec';

export const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');

/** Every file under `dir`, as `relative/path → content`. */
export function readTree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(dir, full).split('\\').join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

export function loadFixture(name: string): Snapshot {
  return snapshotFromFiles(
    readTree(join(FIXTURES, name, 'base')),
    readTree(join(FIXTURES, name, 'head')),
  );
}

export function modelOf(name: string) {
  const snapshot = loadFixture(name);
  const plan = planLoads(snapshot.base, snapshot.head);
  return { snapshot, plan, model: buildModel(plan, snapshot.blobs) };
}
