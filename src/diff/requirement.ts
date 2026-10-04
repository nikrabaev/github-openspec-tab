import type { Requirement, Scenario, ScenarioPart } from '../openspec/types';
import { alignSequences } from './align';
import { blocksChanged, type DiffBlock, type DiffStatus, diffBlocks } from './blocks';
import { diffInlineMarkdown, hasChanges, type Segment, similarity } from './words';

/** One aligned row of a scenario: a step (or prose) before and after. */
export interface PartRow {
  status: DiffStatus;
  before: ScenarioPart | null;
  after: ScenarioPart | null;
  /** Word diff of a changed step's text. */
  segments: Segment[] | null;
  /** Block diff of changed prose, or of a changed step's nested content. */
  blocks: DiffBlock[] | null;
  keywordChanged: boolean;
}

export interface ScenarioDiff {
  status: DiffStatus;
  name: string;
  /** Set when the scenario was matched to one with a different name. */
  previousName: string | null;
  before: Scenario | null;
  after: Scenario | null;
  rows: PartRow[];
}

export interface RequirementDiff {
  statement: DiffBlock[];
  statementChanged: boolean;
  scenarios: ScenarioDiff[];
  counts: Record<DiffStatus, number>;
}

function partText(part: ScenarioPart): string {
  return part.kind === 'step' ? `${part.text}\n${part.extra}` : part.text;
}

function partScore(a: ScenarioPart, b: ScenarioPart): number {
  if (a.kind !== b.kind) return 0;
  if (a.kind === 'step' && b.kind === 'step') {
    const text = a.text === b.text ? 1 : similarity(a.text, b.text);
    return 0.85 * text + (a.keyword === b.keyword ? 0.15 : 0);
  }
  return similarity(a.text, b.text);
}

function wholeRows(parts: readonly ScenarioPart[], status: 'added' | 'removed'): PartRow[] {
  return parts.map((part) => ({
    status,
    before: status === 'removed' ? part : null,
    after: status === 'added' ? part : null,
    segments: null,
    blocks: null,
    keywordChanged: false,
  }));
}

function diffParts(before: readonly ScenarioPart[], after: readonly ScenarioPart[]): PartRow[] {
  return alignSequences(before, after, partScore, 0.45).map((pair): PartRow => {
    const a = pair.before;
    const b = pair.after;
    const row: PartRow = {
      status: 'same',
      before: a,
      after: b,
      segments: null,
      blocks: null,
      keywordChanged: false,
    };
    if (!a || !b) {
      row.status = a ? 'removed' : 'added';
      return row;
    }
    if (a.kind === 'step' && b.kind === 'step') {
      row.keywordChanged = a.keyword !== b.keyword;
      if (a.text !== b.text) {
        const segments = diffInlineMarkdown(a.text, b.text);
        if (hasChanges(segments)) row.segments = segments;
      }
      if (a.extra !== b.extra) {
        const blocks = diffBlocks(a.extra, b.extra);
        if (blocksChanged(blocks)) row.blocks = blocks;
      }
    } else if (a.text !== b.text) {
      const blocks = diffBlocks(a.text, b.text);
      if (blocksChanged(blocks)) row.blocks = blocks;
    }
    if (row.segments || row.blocks || row.keywordChanged) row.status = 'changed';
    return row;
  });
}

const scenarioBody = (scenario: Scenario) => scenario.parts.map(partText).join('\n');

/**
 * Compare two versions of a requirement the way a reviewer reads them:
 * statement block by block, scenarios matched by name (or by content when a
 * scenario was renamed), steps aligned within each scenario.
 */
export function diffRequirement(before: Requirement, after: Requirement): RequirementDiff {
  const statement = diffBlocks(before.statement, after.statement);

  // Match scenarios by name first, then by body for those that were renamed.
  const matchOf = new Map<Scenario, Scenario>();
  const taken = new Set<Scenario>();
  for (const scenario of after.scenarios) {
    const match = before.scenarios.find((s) => !taken.has(s) && s.name === scenario.name);
    if (match) {
      matchOf.set(scenario, match);
      taken.add(match);
    }
  }
  for (const scenario of after.scenarios) {
    if (matchOf.has(scenario)) continue;
    let best: Scenario | null = null;
    let bestScore = 0.6;
    for (const candidate of before.scenarios) {
      if (taken.has(candidate)) continue;
      const score = similarity(scenarioBody(candidate), scenarioBody(scenario));
      if (score >= bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best) {
      matchOf.set(scenario, best);
      taken.add(best);
    }
  }

  const scenarios: ScenarioDiff[] = [];
  const emitted = new Set<Scenario>();
  const emitRemovedBefore = (index: number) => {
    for (let i = 0; i < index; i++) {
      const old = before.scenarios[i];
      if (!old || taken.has(old) || emitted.has(old)) continue;
      emitted.add(old);
      scenarios.push({
        status: 'removed',
        name: old.name,
        previousName: null,
        before: old,
        after: null,
        rows: wholeRows(old.parts, 'removed'),
      });
    }
  };
  for (const scenario of after.scenarios) {
    const old = matchOf.get(scenario);
    if (!old) {
      scenarios.push({
        status: 'added',
        name: scenario.name,
        previousName: null,
        before: null,
        after: scenario,
        rows: wholeRows(scenario.parts, 'added'),
      });
      continue;
    }
    emitRemovedBefore(before.scenarios.indexOf(old));
    const rows = diffParts(old.parts, scenario.parts);
    const renamed = old.name !== scenario.name;
    scenarios.push({
      status: renamed || rows.some((row) => row.status !== 'same') ? 'changed' : 'same',
      name: scenario.name,
      previousName: renamed ? old.name : null,
      before: old,
      after: scenario,
      rows,
    });
  }
  emitRemovedBefore(before.scenarios.length);

  const counts: Record<DiffStatus, number> = { same: 0, added: 0, removed: 0, changed: 0 };
  for (const scenario of scenarios) counts[scenario.status]++;
  return { statement, statementChanged: blocksChanged(statement), scenarios, counts };
}
