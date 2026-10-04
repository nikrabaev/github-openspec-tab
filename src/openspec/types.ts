export type Severity = 'error' | 'warning' | 'info';

/** A format problem, shown inline next to the thing it is about. */
export interface Problem {
  severity: Severity;
  /** Stable machine-readable id, e.g. `modified-no-match`. */
  code: string;
  message: string;
  /** 1-based line in the file the problem was found in, when known. */
  line?: number;
}

export type StepKeyword = 'GIVEN' | 'WHEN' | 'THEN' | 'AND' | 'BUT';

/** One bullet of a scenario: `- **WHEN** the rider scans the code`. */
export interface StepPart {
  kind: 'step';
  /** `null` for a bullet with no recognised keyword. */
  keyword: StepKeyword | null;
  /** Inline Markdown after the keyword. */
  text: string;
  /** Nested Markdown under the bullet (sub-bullets, code), de-indented. */
  extra: string;
}

/** Scenario content that is not a step bullet: a paragraph, a table, a code block. */
export interface ProsePart {
  kind: 'prose';
  text: string;
}

export type ScenarioPart = StepPart | ProsePart;

export interface Scenario {
  name: string;
  parts: ScenarioPart[];
  /** The scenario as written, header included. */
  raw: string;
  /** 0-based line offset of the header within the requirement block. */
  offset: number;
}

export interface Requirement {
  name: string;
  headerLine: string;
  /** The whole block as written: header, statement and scenarios. */
  raw: string;
  /** Markdown between the header and the first scenario. */
  statement: string;
  scenarios: Scenario[];
  /** 1-based line of the header in its source file. */
  line: number;
  /** `**Reason**` of a removal, when the block carries one. */
  reason: string | null;
  /** `**Migration**` of a removal, when the block carries one. */
  migration: string | null;
}

/** A requirement block before it is broken down, as the delta reader sees it. */
export interface RequirementBlock {
  headerLine: string;
  name: string;
  raw: string;
  /** 1-based line of the header in its source file. */
  line: number;
}

export type Operation = 'added' | 'modified' | 'removed' | 'renamed';
