import { normalizeRequirementName, scenarioNameFromHeaderText } from './names';
import { buildCodeFenceMask, normalizeLineEndings } from './text';
import type {
  Problem,
  Requirement,
  RequirementBlock,
  Scenario,
  ScenarioPart,
  StepKeyword,
  StepPart,
} from './types';

/** The canonical requirement header. Case-insensitive, space after `###` optional. */
export const REQUIREMENT_HEADER = /^###\s*Requirement:\s*(.+)\s*$/i;

/** Any level-4 header opens a scenario, not only `#### Scenario:` (reference parity). */
const SCENARIO_HEADER = /^####\s+/;

const BULLET = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;

const KEYWORDS = 'GIVEN|WHEN|THEN|AND|BUT';
const STEP_PATTERNS: RegExp[] = [
  // **WHEN** text · **WHEN**: text
  new RegExp(`^\\*\\*(${KEYWORDS})\\*\\*\\s*:?\\s*(.*)$`, 'i'),
  // **WHEN:** text
  new RegExp(`^\\*\\*(${KEYWORDS}):\\*\\*\\s*(.*)$`, 'i'),
  // __WHEN__ text
  new RegExp(`^__(${KEYWORDS})__\\s*:?\\s*(.*)$`, 'i'),
  // WHEN text (upper case only, so prose starting with "And" is left alone)
  new RegExp(`^(${KEYWORDS})\\b:?\\s+(.*)$`),
];

function parseStep(text: string): { keyword: StepKeyword | null; text: string } {
  for (const pattern of STEP_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return { keyword: match[1].toUpperCase() as StepKeyword, text: (match[2] ?? '').trim() };
    }
  }
  return { keyword: null, text: text.trim() };
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function dedent(lines: string[]): string {
  const widths = lines.filter((line) => line.trim()).map(indentOf);
  const min = widths.length ? Math.min(...widths) : 0;
  return lines
    .map((line) => line.slice(Math.min(min, indentOf(line))))
    .join('\n')
    .trim();
}

/** Break a scenario body into step bullets and the prose around them. */
export function parseScenarioBody(body: string): ScenarioPart[] {
  const lines = normalizeLineEndings(body).split('\n');
  const mask = buildCodeFenceMask(lines);
  const parts: ScenarioPart[] = [];
  let prose: string[] = [];
  let step: StepPart | null = null;
  let stepExtra: string[] = [];
  let lazy = false;

  const flushProse = () => {
    const text = prose.join('\n').trim();
    if (text) parts.push({ kind: 'prose', text });
    prose = [];
  };
  const flushStep = () => {
    if (!step) return;
    step.extra = dedent(stepExtra);
    parts.push(step);
    step = null;
    stepExtra = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fenced = mask[i] ?? false;
    const indent = indentOf(line);
    const blank = line.trim() === '';

    if (step) {
      if (blank) {
        if (stepExtra.length > 0) stepExtra.push('');
        lazy = false;
        continue;
      }
      // A plain line right under the bullet continues its text, however it is indented.
      if (lazy && !fenced && !BULLET.test(line) && !/^#{1,6}\s/.test(line)) {
        step.text = `${step.text} ${line.trim()}`.trim();
        continue;
      }
      // Anything else that is indented (sub-bullets, code, later paragraphs) belongs to the bullet.
      if (indent >= 2 || (fenced && stepExtra.length > 0)) {
        stepExtra.push(line);
        lazy = false;
        continue;
      }
      flushStep();
    }

    const bullet = fenced ? null : BULLET.exec(line);
    if (bullet && indent < 2) {
      flushProse();
      const parsed = parseStep(bullet[2] ?? '');
      step = { kind: 'step', keyword: parsed.keyword, text: parsed.text, extra: '' };
      stepExtra = [];
      lazy = true;
      continue;
    }
    prose.push(line);
  }
  flushStep();
  flushProse();
  return parts;
}

const META_LINE = /^\s*(?:[-*+]\s+)?\*\*(Reason|Migration)(?::\*\*|\*\*\s*:?)\s*(.*)$/i;

/** Pull `**Reason**` / `**Migration**` out of a removal's statement. */
function extractRemovalNotes(statement: string): {
  rest: string;
  reason: string | null;
  migration: string | null;
} {
  const lines = statement.split('\n');
  const mask = buildCodeFenceMask(lines);
  const rest: string[] = [];
  const notes: Record<string, string[]> = {};
  let current: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = mask[i] ? null : META_LINE.exec(line);
    if (match?.[1]) {
      current = match[1].toLowerCase();
      notes[current] = [match[2] ?? ''];
      continue;
    }
    if (current && line.trim() !== '') {
      notes[current]?.push(line.trim());
      continue;
    }
    current = null;
    rest.push(line);
  }
  const note = (key: string) => notes[key]?.join('\n').trim() || null;
  return { rest: rest.join('\n').trim(), reason: note('reason'), migration: note('migration') };
}

/**
 * Break a requirement block into its statement and scenarios.
 *
 * A scenario is any non-fenced `####` header with its body, as in the
 * reference; the body runs to the next header of level 4 or above.
 */
export function parseRequirement(block: RequirementBlock): Requirement {
  const lines = normalizeLineEndings(block.raw).split('\n');
  const mask = buildCodeFenceMask(lines);
  const isScenarioHeader = (i: number) => !mask[i] && SCENARIO_HEADER.test(lines[i] ?? '');

  let firstScenario = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (isScenarioHeader(i)) {
      firstScenario = i;
      break;
    }
  }

  const scenarios: Scenario[] = [];
  let i = firstScenario;
  while (i < lines.length) {
    if (!isScenarioHeader(i)) {
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < lines.length && (mask[i] || !/^#{1,4}\s/.test(lines[i] ?? ''))) i++;
    const header = (lines[start] ?? '').replace(SCENARIO_HEADER, '');
    scenarios.push({
      name: scenarioNameFromHeaderText(header),
      parts: parseScenarioBody(lines.slice(start + 1, i).join('\n')),
      raw: lines.slice(start, i).join('\n').trimEnd(),
      offset: start,
    });
  }

  const notes = extractRemovalNotes(lines.slice(1, firstScenario).join('\n').trim());
  return {
    name: normalizeRequirementName(block.name),
    headerLine: block.headerLine,
    raw: block.raw,
    statement: notes.rest,
    scenarios,
    line: block.line,
    reason: notes.reason,
    migration: notes.migration,
  };
}

export function containsShallOrMust(text: string): boolean {
  return /\b(SHALL|MUST)\b/.test(text);
}

/** Format problems of one requirement that is meant to hold (not a removal). */
export function requirementProblems(requirement: Requirement): Problem[] {
  const problems: Problem[] = [];
  const hasBody = (scenario: Scenario) => scenario.parts.length > 0;
  const real = requirement.scenarios.filter(hasBody);
  const empty = requirement.scenarios.length - real.length;

  if (!requirement.statement) {
    problems.push({
      severity: 'warning',
      code: 'requirement-no-statement',
      message: 'This requirement has no statement before its scenarios.',
      line: requirement.line,
    });
  } else if (!containsShallOrMust(requirement.statement)) {
    problems.push({
      severity: 'warning',
      code: 'requirement-no-keyword',
      message: 'The statement has no SHALL or MUST, so `openspec validate` will reject it.',
      line: requirement.line,
    });
  }
  if (real.length === 0) {
    const wrongLevel = /^(?:#{1,3}|#{5,6})\s+Scenario:/im.test(requirement.statement);
    const bulleted = /^\s*[-*+]\s+\*\*Scenario/im.test(requirement.statement);
    problems.push({
      severity: 'warning',
      code: 'requirement-no-scenario',
      message: wrongLevel
        ? 'No scenario was found: scenario headers must use exactly four hashes (`#### Scenario:`).'
        : bulleted
          ? 'No scenario was found: scenarios must be `#### Scenario:` headers, not bullets.'
          : 'This requirement has no scenario. Every requirement needs at least one.',
      line: requirement.line,
    });
  }
  if (empty > 0) {
    problems.push({
      severity: 'warning',
      code: 'scenario-empty',
      message:
        empty === 1
          ? 'One scenario header has nothing under it.'
          : `${empty} scenario headers have nothing under them.`,
      line: requirement.line,
    });
  }
  return problems;
}
