import { diffLines } from 'diff';
import { type AppliedOperation, applyDelta, isPlaceholderPurpose } from './apply';
import { countOperations, hasDeltaSections, parseDeltaSpec } from './delta';
import { type DesignDoc, parseDesign } from './design';
import { humanizeCapability, humanizeChangeName, type ReadableName, slugify } from './names';
import type { ChangeFile, ChangeRef, ChangeStatus, FileStatus, LoadPlan, OtherFile } from './plan';
import { type ProposalDoc, parseProposal } from './proposal';
import { parseRequirement, requirementProblems } from './requirement';
import { parseSpec, type SpecDoc } from './spec';
import { parseTasks, type TasksDoc } from './tasks';
import { hashText, normalizeBlock, wordSimilarity } from './text';
import type { Operation, Problem, Requirement } from './types';

/** Where a requirement's text lives in the PR, for the "comment on this" link. */
export interface SourceRef {
  path: string;
  /** 1-based line: the first changed line of the requirement when it is in the diff. */
  line: number;
  /** `R` for the new side of the diff, `L` for the old side. */
  side: 'L' | 'R';
  /** False when the line is not part of the PR's diff, so it cannot take a review comment. */
  inDiff: boolean;
}

/**
 * The lines a requirement's text occupies on the new side of a file in the PR.
 * A review comment left on one of them belongs to that requirement.
 */
export interface SourceRange {
  path: string;
  /** 1-based, inclusive. */
  start: number;
  end: number;
  /** Where each scenario's header is, so a line can be traced to its scenario. */
  scenarios: Array<{ name: string; line: number }>;
}

export interface RequirementChange {
  /** Stable id: DOM anchor, deep link and review-progress key. */
  id: string;
  op: Operation;
  name: string;
  /** The old name, for a rename (also set on a requirement renamed and modified). */
  previousName: string | null;
  before: Requirement | null;
  after: Requirement | null;
  reason: string | null;
  migration: string | null;
  source: SourceRef | null;
  /** Empty when none of the requirement's text is on the new side of the diff. */
  ranges: SourceRange[];
  problems: Problem[];
  /** The base spec already reflects this entry. */
  alreadySynced: boolean;
  /** Hash of everything a reviewer reads on the card. */
  hash: string;
}

export interface Counts {
  added: number;
  modified: number;
  removed: number;
  renamed: number;
}

export interface CapabilityView {
  id: string;
  capability: string;
  label: string;
  /** No spec for this capability exists at base. */
  isNew: boolean;
  specPath: string;
  /** The delta file, or null for a spec edited directly. */
  deltaPath: string | null;
  purpose: string | null;
  /** Set when the spec's Purpose was edited directly. */
  purposeBefore: string | null;
  changes: RequirementChange[];
  /** Requirements of the resulting spec this change leaves alone. */
  unchanged: Requirement[];
  problems: Problem[];
  /** The file as written, when it could not be read as a delta. */
  fallbackMarkdown: string | null;
  /** The change was archived before this PR: there is no "before" to compare with. */
  historical: boolean;
  counts: Counts;
  hash: string;
}

export interface DocView<T> {
  id: string;
  path: string;
  status: FileStatus;
  doc: T;
  raw: string;
  hash: string;
}

export interface Diagram {
  path: string;
  name: string;
  sha: string;
}

export interface ChangeView {
  id: string;
  name: string;
  dirName: string;
  dir: string;
  label: ReadableName;
  status: ChangeStatus;
  isNew: boolean;
  date: string | null;
  proposal: DocView<ProposalDoc> | null;
  design: DocView<DesignDoc> | null;
  tasks: (DocView<TasksDoc> & { doneAtBase: number | null }) | null;
  capabilities: CapabilityView[];
  diagrams: Diagram[];
  otherFiles: ChangeFile[];
  counts: Counts;
  problemCount: number;
}

export interface PrModel {
  root: string;
  changes: ChangeView[];
  /** Specs edited directly, with no change folder accounting for the edit. */
  directEdits: CapabilityView[];
  otherFiles: OtherFile[];
  counts: Counts;
  /** Number of requirement cards across live changes and direct edits: the tab counter. */
  requirementChanges: number;
  capabilitiesTouched: number;
  isEmpty: boolean;
}

const zeroCounts = (): Counts => ({ added: 0, modified: 0, removed: 0, renamed: 0 });

function addCounts(target: Counts, source: Counts): void {
  target.added += source.added;
  target.modified += source.modified;
  target.removed += source.removed;
  target.renamed += source.renamed;
}

/** Head-side and base-side line numbers that a diff between two texts touches. */
function changedLines(
  base: string | null,
  head: string | null,
): { added: Set<number>; removed: Set<number> } {
  const added = new Set<number>();
  const removed = new Set<number>();
  let headLine = 1;
  let baseLine = 1;
  for (const part of diffLines(base ?? '', head ?? '')) {
    const count = part.count ?? 0;
    if (part.added) {
      for (let i = 0; i < count; i++) added.add(headLine + i);
      headLine += count;
    } else if (part.removed) {
      for (let i = 0; i < count; i++) removed.add(baseLine + i);
      baseLine += count;
    } else {
      headLine += count;
      baseLine += count;
    }
  }
  return { added, removed };
}

function firstLineIn(lines: Set<number>, start: number, length: number): number | null {
  for (let line = start; line < start + length; line++) {
    if (lines.has(line)) return line;
  }
  return null;
}

const lineCount = (raw: string) => raw.split('\n').length;

/** The lines `requirement` occupies in `path`, with its scenarios' header lines. */
const rangeOf = (path: string, requirement: Requirement): SourceRange => ({
  path,
  start: requirement.line,
  end: requirement.line + lineCount(requirement.raw) - 1,
  scenarios: requirement.scenarios.map((scenario) => ({
    name: scenario.name,
    line: requirement.line + scenario.offset,
  })),
});

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function requirementHash(change: Omit<RequirementChange, 'hash' | 'id'>): string {
  return hashText(
    [
      change.op,
      change.name,
      change.previousName ?? '',
      normalizeBlock(change.before?.raw ?? ''),
      normalizeBlock(change.after?.raw ?? ''),
      change.reason ?? '',
      change.migration ?? '',
    ].join('\u0000'),
  );
}

function countChanges(changes: RequirementChange[]): Counts {
  const counts = zeroCounts();
  for (const change of changes) {
    counts[change.op]++;
    if (change.op === 'modified' && change.previousName) counts.renamed++;
  }
  return counts;
}

/**
 * Requirement-level difference between two versions of a main spec, for specs
 * edited directly. A removed and an added requirement with the same (or nearly
 * the same) body are read as a rename.
 */
export function diffSpecs(
  before: SpecDoc | null,
  after: SpecDoc | null,
): Array<{
  op: Operation;
  before: Requirement | null;
  after: Requirement | null;
}> {
  const beforeByName = new Map((before?.requirements ?? []).map((r) => [r.name, r]));
  const afterByName = new Map((after?.requirements ?? []).map((r) => [r.name, r]));
  const removed = (before?.requirements ?? []).filter((r) => !afterByName.has(r.name));
  const bodyOf = (r: Requirement) => normalizeBlock(r.raw.split('\n').slice(1).join('\n'));

  const out: Array<{ op: Operation; before: Requirement | null; after: Requirement | null }> = [];
  for (const requirement of after?.requirements ?? []) {
    const previous = beforeByName.get(requirement.name);
    if (previous) {
      if (normalizeBlock(previous.raw) !== normalizeBlock(requirement.raw)) {
        out.push({ op: 'modified', before: previous, after: requirement });
      }
      continue;
    }
    // A requirement that disappeared and one that appeared with (nearly) the same body is a rename.
    const body = bodyOf(requirement);
    let match = removed.findIndex((r) => bodyOf(r) === body);
    const exact = match !== -1;
    if (!exact) {
      let best = 0.7;
      removed.forEach((r, index) => {
        const score = wordSimilarity(bodyOf(r), body);
        if (score >= best) {
          best = score;
          match = index;
        }
      });
    }
    if (match !== -1) {
      const [old] = removed.splice(match, 1);
      out.push({ op: exact ? 'renamed' : 'modified', before: old ?? null, after: requirement });
      continue;
    }
    out.push({ op: 'added', before: null, after: requirement });
  }
  for (const requirement of removed) out.push({ op: 'removed', before: requirement, after: null });
  return out;
}

/**
 * Build everything the tab shows from a load plan and the text of the blobs it
 * asked for (keyed by blob SHA). Pure and synchronous; never throws on bad
 * OpenSpec content, which is reported as problems instead.
 */
export function buildModel(plan: LoadPlan, blobs: ReadonlyMap<string, string>): PrModel {
  const text = (sha: string | null | undefined) => (sha ? (blobs.get(sha) ?? null) : null);
  const lineSets = new Map<string, ReturnType<typeof changedLines>>();
  const linesFor = (baseSha: string | null, headSha: string | null) => {
    const key = `${baseSha ?? ''}:${headSha ?? ''}`;
    let set = lineSets.get(key);
    if (!set) {
      set = changedLines(text(baseSha), text(headSha));
      lineSets.set(key, set);
    }
    return set;
  };

  const capabilityRefs = new Map(plan.capabilities.map((ref) => [ref.capability, ref]));
  /** The spec of each capability after the changes archived by this PR, in order. */
  const state = new Map<string, string | null>();
  const currentSpec = (capability: string): string | null =>
    state.has(capability)
      ? (state.get(capability) ?? null)
      : text(capabilityRefs.get(capability)?.baseSha);

  const headDocs = new Map<string, SpecDoc | null>();
  const headDoc = (capability: string) => {
    if (!headDocs.has(capability)) {
      const content = text(capabilityRefs.get(capability)?.headSha);
      headDocs.set(capability, content === null ? null : parseSpec(content));
    }
    return headDocs.get(capability) ?? null;
  };

  /** Entries of in-progress changes, to recognise spec edits that merely sync them early. */
  const liveEntries: Array<{ capability: string; change: RequirementChange }> = [];

  const buildCapability = (
    change: ChangeRef,
    file: ChangeFile,
    changeId: string,
  ): CapabilityView => {
    const capability = file.capability ?? '';
    const ref = capabilityRefs.get(capability);
    const specFilePath = ref?.path ?? `${plan.root}/specs/${capability}/spec.md`;
    const content = text(file.sha) ?? '';
    const historical = change.status === 'archive-edited' || change.status === 'deleted';
    const view: CapabilityView = {
      id: `${changeId}/spec/${capability.replaceAll('/', '.')}`,
      capability,
      label: humanizeCapability(capability),
      isNew: false,
      specPath: specFilePath,
      deltaPath: file.path,
      purpose: null,
      purposeBefore: null,
      changes: [],
      unchanged: [],
      problems: [],
      fallbackMarkdown: null,
      historical,
      counts: zeroCounts(),
      hash: hashText(content),
    };

    const delta = parseDeltaSpec(content);
    if (!hasDeltaSections(delta) && countOperations(delta) === 0) {
      view.fallbackMarkdown = content;
      view.problems.push({
        severity: 'warning',
        code: 'delta-unreadable',
        message:
          'This file has no ADDED, MODIFIED, REMOVED or RENAMED section, so it is shown as written.',
      });
      return view;
    }

    const base = historical ? null : currentSpec(capability);
    view.isNew = !historical && base === null;
    const result = applyDelta(base, delta, {
      specName: capability,
      changeName: change.name,
      deltaContent: content,
    });
    if (change.status === 'archived') state.set(capability, result.rebuilt);
    if (!historical) view.problems.push(...result.problems);

    const rebuilt = parseSpec(result.rebuilt);
    view.purpose = view.isNew ? rebuilt.purpose : null;
    if (view.isNew && isPlaceholderPurpose(rebuilt.purpose)) view.purpose = null;

    // A requirement renamed and modified in one delta is one card.
    const renames = result.operations.filter((op) => op.op === 'renamed');
    const merged = new Set<AppliedOperation>();
    const taken = new Set<string>();
    const deltaLines = linesFor(file.baseSha, file.sha);
    const deltaInDiff = file.status === 'added' || file.status === 'modified';
    const useMainSpec = change.status === 'archived' && ref?.headSha && ref.headSha !== ref.baseSha;
    const mainLines = ref ? linesFor(ref.baseSha, ref.headSha) : null;

    const sourceFor = (op: AppliedOperation, before: Requirement | null): SourceRef | null => {
      if (historical) return { path: file.path, line: op.line, side: 'R', inDiff: false };
      if (useMainSpec && mainLines) {
        if (op.op === 'removed' && before) {
          const line = firstLineIn(mainLines.removed, before.line, lineCount(before.raw));
          return {
            path: specFilePath,
            line: line ?? before.line,
            side: 'L',
            inDiff: line !== null,
          };
        }
        const landed = headDoc(capability)?.requirements.find((r) => r.name === op.name);
        if (landed) {
          const line = firstLineIn(mainLines.added, landed.line, lineCount(landed.raw));
          return {
            path: specFilePath,
            line: line ?? landed.line,
            side: 'R',
            inDiff: line !== null,
          };
        }
      }
      const length = op.block ? lineCount(op.block.raw) : 1;
      const line = deltaInDiff ? firstLineIn(deltaLines.added, op.line, length) : null;
      return { path: file.path, line: line ?? op.line, side: 'R', inDiff: line !== null };
    };

    const rangesFor = (op: AppliedOperation, after: Requirement | null): SourceRange[] => {
      if (historical) return [];
      const ranges: SourceRange[] = [];
      if (deltaInDiff) {
        ranges.push(
          after && after.line === op.line
            ? rangeOf(file.path, after)
            : {
                path: file.path,
                start: op.line,
                end: op.line + (op.block ? lineCount(op.block.raw) : 1) - 1,
                scenarios: [],
              },
        );
      }
      if (useMainSpec) {
        const landed = headDoc(capability)?.requirements.find((r) => r.name === op.name);
        if (landed) ranges.push(rangeOf(specFilePath, landed));
      }
      return ranges;
    };

    for (const op of [...result.operations].sort((a, b) => a.line - b.line)) {
      if (merged.has(op)) continue;
      let previousName: string | null = null;
      // The base block as the base spec spells it: under its old name when renamed.
      let beforeBlock = op.before;
      const problems = historical ? [] : [...op.problems];
      if (op.op === 'modified') {
        const rename = renames.find((r) => r.name === op.name);
        if (rename) {
          merged.add(rename);
          previousName = rename.from;
          beforeBlock = rename.before ?? op.before;
          if (!historical) problems.unshift(...rename.problems);
        }
      }
      if (op.op === 'renamed') {
        if (result.operations.some((other) => other.op === 'modified' && other.name === op.name)) {
          continue; // shown on the modified card
        }
        previousName = op.from;
      }

      const before = beforeBlock ? parseRequirement(beforeBlock) : null;
      const note = op.op === 'removed' && op.block ? parseRequirement(op.block) : null;
      let after: Requirement | null = null;
      if (op.op === 'added' || op.op === 'modified') {
        after = op.block ? parseRequirement(op.block) : null;
        if (after && !historical) problems.push(...requirementProblems(after));
      } else if (op.op === 'renamed' && before) {
        after = { ...before, name: op.name, headerLine: `### Requirement: ${op.name}` };
      }

      const entry: Omit<RequirementChange, 'hash' | 'id'> = {
        op: op.op,
        name: op.name,
        previousName,
        // A removal whose target is gone still shows what the delta says was there.
        before: op.op === 'added' ? null : (before ?? (note?.statement ? note : null)),
        after,
        reason: note?.reason ?? null,
        migration: note?.migration ?? null,
        source: sourceFor(op, before),
        ranges: rangesFor(op, after),
        problems,
        alreadySynced: op.alreadySynced,
      };
      if (op.op === 'removed' && !historical && !entry.reason) {
        entry.problems.push({
          severity: 'info',
          code: 'removed-no-reason',
          message: 'This removal gives no **Reason**. Removals should say why, and how to migrate.',
          line: op.line,
        });
      }
      const requirementChange: RequirementChange = {
        ...entry,
        id: `${view.id}/${uniqueId(slugify(op.name), taken)}`,
        hash: requirementHash(entry),
      };
      view.changes.push(requirementChange);
      if (change.status === 'in-progress')
        liveEntries.push({ capability, change: requirementChange });
    }

    const touched = new Set(view.changes.map((entry) => entry.name));
    view.unchanged = historical ? [] : rebuilt.requirements.filter((r) => !touched.has(r.name));
    view.counts = countChanges(view.changes);
    return view;
  };

  const changes: ChangeView[] = plan.changes.map((change) => {
    const id = `c/${slugify(change.dirName)}`;
    const fileOf = (role: ChangeFile['role']) => change.files.find((file) => file.role === role);
    const docView = <T>(role: ChangeFile['role'], parse: (raw: string) => T): DocView<T> | null => {
      const file = fileOf(role);
      const raw = text(file?.sha);
      if (!file || raw === null) return null;
      return {
        id: `${id}/${role}`,
        path: file.path,
        status: file.status,
        doc: parse(raw),
        raw,
        hash: hashText(raw),
      };
    };

    const tasks = docView('tasks', parseTasks);
    const tasksFile = fileOf('tasks');
    const baseTasks = tasksFile?.status === 'modified' ? text(tasksFile.baseSha) : null;
    const capabilities = change.files
      .filter((file) => file.role === 'delta' && file.capability)
      .sort((a, b) => (a.capability ?? '').localeCompare(b.capability ?? ''))
      .map((file) => buildCapability(change, file, id));

    const counts = zeroCounts();
    for (const capability of capabilities) addCounts(counts, capability.counts);
    return {
      id,
      name: change.name,
      dirName: change.dirName,
      dir: change.dir,
      label: humanizeChangeName(change.dirName),
      status: change.status,
      isNew: change.isNew,
      date: change.date,
      proposal: docView('proposal', parseProposal),
      design: docView('design', parseDesign),
      tasks: tasks
        ? { ...tasks, doneAtBase: baseTasks === null ? null : parseTasks(baseTasks).done }
        : null,
      capabilities,
      diagrams: change.files
        .filter((file) => file.role === 'diagram')
        .map((file) => ({
          path: file.path,
          sha: file.sha,
          name: (file.rel.split('/').pop() ?? file.rel).replace(/\.excalidraw\.svg$/i, ''),
        })),
      otherFiles: change.files.filter(
        (file) => file.role === 'other' && file.status !== 'unchanged',
      ),
      counts,
      problemCount: capabilities.reduce(
        (sum, capability) =>
          sum +
          capability.problems.filter((p) => p.severity !== 'info').length +
          capability.changes.reduce(
            (inner, entry) => inner + entry.problems.filter((p) => p.severity !== 'info').length,
            0,
          ),
        0,
      ),
    };
  });

  // Whatever the main specs changed beyond what the archived changes account for.
  const directEdits: CapabilityView[] = [];
  for (const ref of plan.capabilities) {
    if (ref.baseSha === ref.headSha) continue;
    const expectedText = currentSpec(ref.capability);
    const actualText = text(ref.headSha);
    if (ref.headSha && actualText === null) continue; // not loaded: nothing sound to say
    const expected = expectedText === null ? null : parseSpec(expectedText);
    const actual = actualText === null ? null : parseSpec(actualText);
    const id = `specs/${ref.capability.replaceAll('/', '.')}`;
    const lines = linesFor(ref.baseSha, ref.headSha);
    const taken = new Set<string>();

    const entries = diffSpecs(expected, actual)
      .filter((entry) => {
        // An in-progress change that already wrote its result into the main spec.
        const synced = liveEntries.find(
          (live) =>
            live.capability === ref.capability &&
            live.change.op === entry.op &&
            live.change.name === (entry.after ?? entry.before)?.name &&
            normalizeBlock(live.change.after?.raw ?? '') === normalizeBlock(entry.after?.raw ?? ''),
        );
        if (synced && !synced.change.alreadySynced) {
          synced.change.alreadySynced = true;
          synced.change.problems.push({
            severity: 'info',
            code: 'synced-to-spec',
            message: 'This PR also writes this text into the main spec.',
          });
        }
        return !synced;
      })
      .map((entry): RequirementChange => {
        const subject = entry.after ?? entry.before;
        const name = subject?.name ?? '';
        const side = entry.after ? 'R' : 'L';
        const location = entry.after ?? entry.before;
        const hit = location
          ? firstLineIn(
              side === 'R' ? lines.added : lines.removed,
              location.line,
              lineCount(location.raw),
            )
          : null;
        const partial: Omit<RequirementChange, 'hash' | 'id'> = {
          op: entry.op,
          name,
          previousName:
            entry.before && entry.after && entry.before.name !== entry.after.name
              ? entry.before.name
              : null,
          before: entry.before,
          after: entry.after,
          reason: null,
          migration: null,
          source: location
            ? { path: ref.path, line: hit ?? location.line, side, inDiff: hit !== null }
            : null,
          ranges: entry.after ? [rangeOf(ref.path, entry.after)] : [],
          problems: entry.after ? requirementProblems(entry.after) : [],
          alreadySynced: false,
        };
        return {
          ...partial,
          id: `${id}/${uniqueId(slugify(name), taken)}`,
          hash: requirementHash(partial),
        };
      });

    const purposeChanged =
      expected !== null &&
      actual !== null &&
      (expected.purpose ?? '') !== (actual.purpose ?? '') &&
      !isPlaceholderPurpose(expected.purpose);
    if (entries.length === 0 && !purposeChanged) continue;

    const touched = new Set(entries.map((entry) => entry.name));
    directEdits.push({
      id,
      capability: ref.capability,
      label: humanizeCapability(ref.capability),
      isNew: expected === null,
      specPath: ref.path,
      deltaPath: null,
      purpose: purposeChanged || expected === null ? (actual?.purpose ?? null) : null,
      purposeBefore: purposeChanged ? (expected?.purpose ?? null) : null,
      changes: entries,
      unchanged: (actual?.requirements ?? []).filter((r) => !touched.has(r.name)),
      problems: actual?.problems ?? [],
      fallbackMarkdown: null,
      historical: false,
      counts: countChanges(entries),
      hash: hashText(actualText ?? ''),
    });
  }

  const counts = zeroCounts();
  const touchedCapabilities = new Set<string>();
  let requirementChanges = 0;
  for (const change of changes) {
    if (change.status === 'archive-edited' || change.status === 'deleted') continue;
    addCounts(counts, change.counts);
    for (const capability of change.capabilities) {
      touchedCapabilities.add(capability.capability);
      requirementChanges += capability.changes.length;
    }
  }
  for (const capability of directEdits) {
    addCounts(counts, capability.counts);
    touchedCapabilities.add(capability.capability);
    requirementChanges += capability.changes.length;
  }

  return {
    root: plan.root,
    changes,
    directEdits,
    otherFiles: plan.otherFiles,
    counts,
    requirementChanges,
    capabilitiesTouched: touchedCapabilities.size,
    isEmpty: changes.length === 0 && directEdits.length === 0 && plan.otherFiles.length === 0,
  };
}
