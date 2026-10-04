import { normalizeRequirementName } from './names';
import { REQUIREMENT_HEADER } from './requirement';
import { buildCodeFenceMask, splitLines } from './text';
import type { RequirementBlock } from './types';

export interface RemovedEntry {
  name: string;
  /** 1-based line of the entry in the delta file. */
  line: number;
}

export interface RenamePair {
  from: string;
  to: string;
  /** 1-based line of the `FROM:` entry. */
  line: number;
  /** 1-based line of the `TO:` entry. */
  toLine: number;
}

/** A `FROM:` or `TO:` line in RENAMED that never formed a pair. */
export interface UnpairedRename {
  side: 'FROM' | 'TO';
  name: string;
  line: number;
}

/** A `### Requirement:` block written outside every delta section. */
export interface OrphanedRequirement {
  name: string;
  /** The `## ` section it sits under, or null above the first one. */
  section: string | null;
  line: number;
}

/** A `###` header inside ADDED/MODIFIED that is not `### Requirement:`. */
export interface SkippedHeader {
  header: string;
  section: string;
  line: number;
}

export interface DeltaPlan {
  added: RequirementBlock[];
  modified: RequirementBlock[];
  /** Names to remove, in document order (header and bullet forms). */
  removed: RemovedEntry[];
  /** The authored blocks of header-form removals: they carry Reason / Migration. */
  removedBlocks: RequirementBlock[];
  renamed: RenamePair[];
  unpairedRenames: UnpairedRename[];
  orphanedRequirements: OrphanedRequirement[];
  skippedHeaders: SkippedHeader[];
  sectionPresence: { added: boolean; modified: boolean; removed: boolean; renamed: boolean };
}

interface SectionBody {
  lines: string[];
  fenceMask: boolean[];
  /** 1-based line number of the first body line. */
  bodyStartLine: number;
}

interface DeltaSection {
  title: string;
  body: SectionBody;
}

const DELTA_SECTION_TITLES = new Set([
  'added requirements',
  'modified requirements',
  'removed requirements',
  'renamed requirements',
]);

function splitTopLevelSections(lines: string[], fenceMask: boolean[]): DeltaSection[] {
  const starts: Array<{ title: string; index: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenceMask[i]) continue;
    const match = /^(##)\s+(.+)$/.exec(lines[i] ?? '');
    if (match?.[2]) starts.push({ title: match[2].trim(), index: i });
  }
  return starts.map((current, i) => {
    const end = starts[i + 1]?.index ?? lines.length;
    return {
      title: current.title,
      body: {
        lines: lines.slice(current.index + 1, end),
        fenceMask: fenceMask.slice(current.index + 1, end),
        bodyStartLine: current.index + 2,
      },
    };
  });
}

/** Every body whose title folds to `desired`: a repeated header applies in full. */
function sectionsNamed(sections: DeltaSection[], desired: string) {
  const target = desired.toLowerCase();
  const matches = sections.filter((section) => section.title.toLowerCase() === target);
  return {
    title: matches[0]?.title ?? desired,
    bodies: matches.map((section) => section.body),
    found: matches.length > 0,
  };
}

function parseBlocks(
  body: SectionBody,
  skipped?: { section: string; sink: SkippedHeader[] },
): RequirementBlock[] {
  const { lines, fenceMask, bodyStartLine } = body;
  const isRequirementHeader = (i: number) =>
    !fenceMask[i] && REQUIREMENT_HEADER.test(lines[i] ?? '');
  const isTopLevelHeader = (i: number) => !fenceMask[i] && /^##\s+/.test(lines[i] ?? '');
  const recordSkipped = (i: number) => {
    if (!skipped || fenceMask[i]) return;
    const line = lines[i] ?? '';
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3?.[1] && !REQUIREMENT_HEADER.test(line)) {
      skipped.sink.push({
        header: h3[1].trim(),
        section: skipped.section,
        line: bodyStartLine + i,
      });
    }
  };

  const blocks: RequirementBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !isRequirementHeader(i)) {
      recordSkipped(i);
      i++;
    }
    if (i >= lines.length) break;
    const headerLine = lines[i] ?? '';
    const name = normalizeRequirementName(REQUIREMENT_HEADER.exec(headerLine)?.[1] ?? '');
    const start = i;
    i++;
    while (i < lines.length && !isRequirementHeader(i) && !isTopLevelHeader(i)) {
      recordSkipped(i);
      i++;
    }
    blocks.push({
      headerLine,
      name,
      raw: lines.slice(start, i).join('\n').trimEnd(),
      line: bodyStartLine + start,
    });
  }
  return blocks;
}

function parseRemovedNames(body: SectionBody): RemovedEntry[] {
  const entries: RemovedEntry[] = [];
  for (let i = 0; i < body.lines.length; i++) {
    if (body.fenceMask[i]) continue;
    const line = body.lines[i] ?? '';
    const header = REQUIREMENT_HEADER.exec(line);
    if (header?.[1]) {
      entries.push({ name: normalizeRequirementName(header[1]), line: body.bodyStartLine + i });
      continue;
    }
    // Bullet form, with any CommonMark bullet marker.
    const bullet = /^\s*[-*+]\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(line);
    if (bullet?.[1]) {
      entries.push({ name: normalizeRequirementName(bullet[1]), line: body.bodyStartLine + i });
    }
  }
  return entries;
}

function parseRenamedPairs(body: SectionBody, unpaired: UnpairedRename[]): RenamePair[] {
  const pairs: RenamePair[] = [];
  let pending: { name: string; line: number } | undefined;
  for (let i = 0; i < body.lines.length; i++) {
    if (body.fenceMask[i]) continue;
    const line = body.lines[i] ?? '';
    const lineNumber = body.bodyStartLine + i;
    const from = /^\s*[-*+]?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(line);
    const to = /^\s*[-*+]?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(line);
    if (from?.[1]) {
      if (pending) unpaired.push({ side: 'FROM', name: pending.name, line: pending.line });
      pending = { name: normalizeRequirementName(from[1]), line: lineNumber };
    } else if (to?.[1]) {
      const name = normalizeRequirementName(to[1]);
      if (!pending) {
        unpaired.push({ side: 'TO', name, line: lineNumber });
        continue;
      }
      pairs.push({ from: pending.name, to: name, line: pending.line, toLine: lineNumber });
      pending = undefined;
    }
  }
  if (pending) unpaired.push({ side: 'FROM', name: pending.name, line: pending.line });
  return pairs;
}

function findOrphanedRequirements(lines: string[], fenceMask: boolean[]): OrphanedRequirement[] {
  const orphans: OrphanedRequirement[] = [];
  let section: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (fenceMask[i]) continue;
    const line = lines[i] ?? '';
    const sectionMatch = /^(##)\s+(.+)$/.exec(line);
    if (sectionMatch?.[2]) {
      section = sectionMatch[2].trim();
      continue;
    }
    if (section !== null && DELTA_SECTION_TITLES.has(section.toLowerCase())) continue;
    const header = REQUIREMENT_HEADER.exec(line);
    if (header?.[1]) {
      orphans.push({ name: normalizeRequirementName(header[1]), section, line: i + 1 });
    }
  }
  return orphans;
}

/**
 * Read a delta spec (`changes/<change>/specs/<capability>/spec.md`).
 *
 * Port of the reference `parseDeltaSpec`: section headers are matched
 * case-insensitively and may repeat, fenced lines are ignored, REMOVED accepts
 * headers or bullets, and RENAMED is read as strict FROM/TO pairs. Every block
 * also carries its line number so the UI can link to it.
 */
export function parseDeltaSpec(content: string): DeltaPlan {
  const lines = splitLines(content);
  const fenceMask = buildCodeFenceMask(lines);
  const sections = splitTopLevelSections(lines, fenceMask);
  const added = sectionsNamed(sections, 'ADDED Requirements');
  const modified = sectionsNamed(sections, 'MODIFIED Requirements');
  const removed = sectionsNamed(sections, 'REMOVED Requirements');
  const renamed = sectionsNamed(sections, 'RENAMED Requirements');

  const skippedHeaders: SkippedHeader[] = [];
  const unpairedRenames: UnpairedRename[] = [];
  const plan: DeltaPlan = {
    added: added.bodies.flatMap((body) =>
      parseBlocks(body, { section: added.title, sink: skippedHeaders }),
    ),
    modified: modified.bodies.flatMap((body) =>
      parseBlocks(body, { section: modified.title, sink: skippedHeaders }),
    ),
    removed: removed.bodies.flatMap(parseRemovedNames),
    removedBlocks: removed.bodies.flatMap((body) => parseBlocks(body)),
    // Pairs are read per section copy, so a FROM never pairs with a TO in another copy.
    renamed: renamed.bodies.flatMap((body) => parseRenamedPairs(body, unpairedRenames)),
    unpairedRenames,
    orphanedRequirements: findOrphanedRequirements(lines, fenceMask),
    skippedHeaders,
    sectionPresence: {
      added: added.found,
      modified: modified.found,
      removed: removed.found,
      renamed: renamed.found,
    },
  };
  plan.unpairedRenames.sort((a, b) => a.line - b.line);
  plan.skippedHeaders.sort((a, b) => a.line - b.line);
  return plan;
}

export function hasDeltaSections(plan: DeltaPlan): boolean {
  return Object.values(plan.sectionPresence).some(Boolean);
}

export function countOperations(plan: DeltaPlan): number {
  return plan.added.length + plan.modified.length + plan.removed.length + plan.renamed.length;
}
