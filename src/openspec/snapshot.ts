import type { Tree } from './paths';
import { hashText } from './text';

/** Two file trees and the text of their blobs: everything the model is built from. */
export interface Snapshot {
  base: Tree;
  head: Tree;
  /** Blob text keyed by blob SHA. */
  blobs: Map<string, string>;
}

/**
 * Build a snapshot from plain `path → content` maps, standing in for the
 * GitHub trees and blobs. Used by the dev harness and the tests.
 */
export function snapshotFromFiles(
  baseFiles: Record<string, string>,
  headFiles: Record<string, string>,
): Snapshot {
  const blobs = new Map<string, string>();
  const tree = (files: Record<string, string>) => {
    const entries = new Map<string, string>();
    for (const [path, content] of Object.entries(files)) {
      const sha = `${hashText(content)}-${content.length}`;
      blobs.set(sha, content);
      entries.set(path, sha);
    }
    return entries;
  };
  return { base: tree(baseFiles), head: tree(headFiles), blobs };
}
