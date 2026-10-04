/**
 * Where each review thread belongs in the tab. A thread is on a file and a
 * line; the tab shows requirements, scenarios, sections and tasks. Each of
 * those occupies a range of lines, a region, and a thread goes to the
 * smallest region that holds its line.
 */
import type { CapabilityView, ChangeView, PrModel } from '@/openspec';
import type { ReviewThread } from './comments';

export interface Region {
  /** Where the region's threads are shown. */
  key: string;
  /** The outline item its threads count towards. */
  item: string;
  path: string;
  /** Inclusive lines on the new side of the diff. Null: the file as a whole. */
  lines: { start: number; end: number } | null;
  /** Named places inside, such as scenarios, for saying what a thread is on. */
  parts: Array<{ label: string; line: number }>;
}

export interface PlacedThread {
  thread: ReviewThread;
  /** What inside the region the thread is on, when that is known. */
  on: string | null;
}

export interface Placement {
  byRegion: Map<string, PlacedThread[]>;
  /** Threads that still want an answer, per outline item. */
  openByItem: Map<string, number>;
}

export const regionKey = {
  requirement: (changeId: string) => `req:${changeId}`,
  file: (viewId: string) => `file:${viewId}`,
  doc: (docId: string) => `doc:${docId}`,
  block: (docId: string, line: number) => `doc:${docId}:${line}`,
};

const whole = (key: string, item: string, path: string): Region => ({
  key,
  item,
  path,
  lines: null,
  parts: [],
});

/** Regions for headings that follow one another: each runs to the line before the next. */
function runs<T extends { line: number }>(
  entries: readonly T[],
  end: number,
): Array<{ entry: T; start: number; end: number }> {
  const known = entries.filter((entry) => entry.line > 0);
  return known.map((entry, index) => ({
    entry,
    start: entry.line,
    end: (known[index + 1]?.line ?? end + 1) - 1,
  }));
}

function capabilityRegions(view: CapabilityView): Region[] {
  if (view.historical) return [];
  const regions: Region[] = [];
  const key = regionKey.file(view.id);
  for (const path of new Set([view.deltaPath ?? view.specPath, view.specPath])) {
    regions.push(whole(key, view.id, path));
  }
  for (const change of view.changes) {
    for (const range of change.ranges) {
      regions.push({
        key: regionKey.requirement(change.id),
        item: change.id,
        path: range.path,
        lines: { start: range.start, end: range.end },
        parts: range.scenarios.map((scenario) => ({
          label: `Scenario: ${scenario.name}`,
          line: scenario.line,
        })),
      });
    }
  }
  return regions;
}

function changeRegions(change: ChangeView): Region[] {
  const regions: Region[] = [];
  const END = Number.MAX_SAFE_INTEGER;
  const block = (docId: string, path: string, start: number, end: number): Region => ({
    key: regionKey.block(docId, start),
    item: docId,
    path,
    lines: { start, end },
    parts: [],
  });
  if (change.proposal) {
    const doc = change.proposal;
    regions.push(whole(regionKey.doc(doc.id), doc.id, doc.path));
    for (const { start, end } of runs(doc.doc.sections, END)) {
      regions.push(block(doc.id, doc.path, start, end));
    }
  }
  if (change.design) {
    const doc = change.design;
    regions.push(whole(regionKey.doc(doc.id), doc.id, doc.path));
    for (const { entry, start, end } of runs(doc.doc.sections, END)) {
      regions.push(block(doc.id, doc.path, start, end));
      if (entry.kind !== 'decisions') continue;
      for (const decision of runs(entry.decisions, end)) {
        regions.push(block(doc.id, doc.path, decision.start, decision.end));
      }
    }
  }
  if (change.tasks) {
    const doc = change.tasks;
    regions.push(whole(regionKey.doc(doc.id), doc.id, doc.path));
    for (const { entry, start, end } of runs(doc.doc.groups, END)) {
      regions.push({
        key: regionKey.block(doc.id, entry.line),
        item: doc.id,
        path: doc.path,
        lines: { start, end },
        parts: entry.tasks.map((task) => ({
          label: task.number ? `Task ${task.number}` : 'Task',
          line: task.line,
        })),
      });
    }
  }
  for (const capability of change.capabilities) regions.push(...capabilityRegions(capability));
  return regions;
}

/** Every place of the tab a review thread can belong to. */
export function regionsOf(model: PrModel): Region[] {
  return [...model.changes.flatMap(changeRegions), ...model.directEdits.flatMap(capabilityRegions)];
}

const size = (region: Region) =>
  region.lines ? region.lines.end - region.lines.start : Number.POSITIVE_INFINITY;

/** A thread that still wants an answer: not resolved, and not left behind by a later commit. */
export const isOpen = (thread: ReviewThread) => thread.resolved !== true && !thread.outdated;

/**
 * Put each thread in the smallest region holding its line. A thread on the
 * file as a whole, on the old side of the diff, or on a line that is gone goes
 * to the file's own region. Threads on files the tab does not show are left out.
 */
export function placeThreads(
  regions: readonly Region[],
  threads: readonly ReviewThread[],
): Placement {
  const byPath = new Map<string, Region[]>();
  for (const region of regions) {
    const list = byPath.get(region.path) ?? [];
    list.push(region);
    byPath.set(region.path, list);
  }
  const placement: Placement = { byRegion: new Map(), openByItem: new Map() };
  for (const thread of threads) {
    const candidates = byPath.get(thread.path);
    if (!candidates) continue;
    const line = thread.side === 'RIGHT' ? thread.line : null;
    let best: Region | undefined;
    for (const region of candidates) {
      const holds = region.lines
        ? line !== null && line >= region.lines.start && line <= region.lines.end
        : true;
      if (holds && (!best || size(region) < size(best))) best = region;
    }
    if (!best) continue;
    const on =
      line === null
        ? null
        : ([...best.parts].reverse().find((part) => part.line <= line)?.label ?? null);
    const list = placement.byRegion.get(best.key) ?? [];
    list.push({ thread, on });
    placement.byRegion.set(best.key, list);
    if (isOpen(thread)) {
      placement.openByItem.set(best.item, (placement.openByItem.get(best.item) ?? 0) + 1);
    }
  }
  for (const list of placement.byRegion.values()) {
    list.sort(
      (a, b) =>
        (a.thread.line ?? 0) - (b.thread.line ?? 0) ||
        (a.thread.comments[0]?.createdAt ?? '').localeCompare(
          b.thread.comments[0]?.createdAt ?? '',
        ),
    );
  }
  return placement;
}
