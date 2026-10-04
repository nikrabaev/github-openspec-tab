import { normalizeRequirementName } from './names';
import { parseRequirement, REQUIREMENT_HEADER } from './requirement';
import { buildCodeFenceMask, maskHtmlComments, normalizeLineEndings, splitLines } from './text';
import type { Problem, Requirement, RequirementBlock } from './types';

export interface RequirementsSectionParts {
  before: string;
  /** The `## Requirements` line. */
  headerLine: string;
  /** Content between the header and the first requirement block. */
  preamble: string;
  bodyBlocks: RequirementBlock[];
  after: string;
  /** False when the spec has no `## Requirements` section at all. */
  found: boolean;
}

/**
 * Split a main spec around its `## Requirements` section and read the
 * requirement blocks inside it. Port of `extractRequirementsSection`.
 */
export function extractRequirementsSection(content: string): RequirementsSectionParts {
  const lines = splitLines(content);
  const mask = buildCodeFenceMask(lines);
  const headerIndex = lines.findIndex(
    (line, i) => !mask[i] && /^##\s+Requirements\s*$/i.test(line),
  );

  if (headerIndex === -1) {
    const before = content.trimEnd();
    return {
      before: before ? `${before}\n\n` : '',
      headerLine: '## Requirements',
      preamble: '',
      bodyBlocks: [],
      after: '\n',
      found: false,
    };
  }

  let endIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (!mask[i] && /^##\s+/.test(lines[i] ?? '')) {
      endIndex = i;
      break;
    }
  }

  const isRequirementHeader = (i: number) => !mask[i] && REQUIREMENT_HEADER.test(lines[i] ?? '');
  const isTopLevelHeader = (i: number) => !mask[i] && /^##\s+/.test(lines[i] ?? '');

  const blocks: RequirementBlock[] = [];
  const preambleLines: string[] = [];
  let cursor = headerIndex + 1;
  while (cursor < endIndex && !isRequirementHeader(cursor)) {
    preambleLines.push(lines[cursor] ?? '');
    cursor++;
  }
  while (cursor < endIndex) {
    if (!isRequirementHeader(cursor)) {
      cursor++;
      continue;
    }
    const headerLine = lines[cursor] ?? '';
    const name = normalizeRequirementName(REQUIREMENT_HEADER.exec(headerLine)?.[1] ?? '');
    const start = cursor;
    cursor++;
    while (cursor < endIndex && !isRequirementHeader(cursor) && !isTopLevelHeader(cursor)) cursor++;
    blocks.push({
      headerLine,
      name,
      raw: lines.slice(start, cursor).join('\n').trimEnd(),
      line: start + 1,
    });
  }

  const before = lines.slice(0, headerIndex).join('\n');
  const after = lines.slice(endIndex).join('\n');
  return {
    before: before.trimEnd() ? `${before}\n` : before,
    headerLine: lines[headerIndex] ?? '## Requirements',
    preamble: preambleLines.join('\n').trimEnd(),
    bodyBlocks: blocks,
    after: after.startsWith('\n') ? after : `\n${after}`,
    found: true,
  };
}

/** The body of `## Purpose`, ignoring fenced and commented-out copies of the header. */
export function extractPurposeSection(content: string): string | null {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n');
  const masked = maskHtmlComments(normalized).split('\n');
  const fence = buildCodeFenceMask(masked);
  const start = masked.findIndex((line, i) => !fence[i] && /^##\s+Purpose\s*$/i.test(line));
  if (start === -1) return null;
  let end = masked.length;
  for (let i = start + 1; i < masked.length; i++) {
    if (!fence[i] && /^##\s+/.test(masked[i] ?? '')) {
      end = i;
      break;
    }
  }
  const hasProse = masked
    .slice(start + 1, end)
    .filter((_, offset) => !fence[start + 1 + offset])
    .join('\n')
    .trim();
  if (!hasProse) return null;
  return (
    lines
      .slice(start + 1, end)
      .join('\n')
      .trim() || null
  );
}

export interface SpecDoc {
  title: string | null;
  purpose: string | null;
  requirements: Requirement[];
  /** Text between `## Requirements` and the first requirement. */
  preamble: string;
  hasRequirementsSection: boolean;
  problems: Problem[];
}

const DELTA_HEADER = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i;

/** Read a main spec (`openspec/specs/<capability>/spec.md`). Never throws. */
export function parseSpec(content: string): SpecDoc {
  const lines = splitLines(content);
  const mask = buildCodeFenceMask(lines);
  const parts = extractRequirementsSection(content);
  const problems: Problem[] = [];

  let title: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = mask[i] ? null : /^#\s+(.+)$/.exec(lines[i] ?? '');
    if (match?.[1]) {
      title = match[1].trim();
      break;
    }
  }

  if (!parts.found) {
    problems.push({
      severity: 'warning',
      code: 'spec-no-requirements-section',
      message: 'This spec has no `## Requirements` section, so it has no requirements to show.',
    });
  }

  // Structure problems the reference refuses to archive over.
  const seen = new Map<string, number>();
  const requirementLines = new Set(parts.bodyBlocks.map((block) => block.line));
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const line = lines[i] ?? '';
    if (DELTA_HEADER.test(line)) {
      problems.push({
        severity: 'error',
        code: 'spec-delta-header',
        message: `Delta header "${line.trim()}" does not belong in a main spec and cuts the Requirements section short.`,
        line: i + 1,
      });
      continue;
    }
    const match = REQUIREMENT_HEADER.exec(line);
    if (!match?.[1]) continue;
    if (!requirementLines.has(i + 1)) {
      problems.push({
        severity: 'error',
        code: 'spec-requirement-outside-section',
        message: `"${line.trim()}" sits outside \`## Requirements\`, so OpenSpec does not see it.`,
        line: i + 1,
      });
      continue;
    }
    const name = normalizeRequirementName(match[1]);
    const previous = seen.get(name);
    if (previous !== undefined) {
      problems.push({
        severity: 'error',
        code: 'spec-duplicate-requirement',
        message: `Requirement "${name}" is declared twice (lines ${previous} and ${i + 1}).`,
        line: i + 1,
      });
    } else {
      seen.set(name, i + 1);
    }
  }

  return {
    title,
    purpose: extractPurposeSection(content),
    requirements: parts.bodyBlocks.map(parseRequirement),
    preamble: parts.preamble,
    hasRequirementsSection: parts.found,
    problems,
  };
}
