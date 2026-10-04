import { splitTopLevelList } from './lists';
import { buildCodeFenceMask, normalizeLineEndings, splitSections, stripHtmlComments } from './text';

export interface Decision {
  title: string;
  /** Markdown of the decision without its alternatives. */
  body: string;
  /** Markdown of the alternatives considered, folded by default. */
  alternatives: string | null;
}

export interface Risk {
  kind: 'risk' | 'trade-off';
  /** Inline/block Markdown of the risk. */
  risk: string;
  /** Markdown of the mitigation, when the item is written as risk → mitigation. */
  mitigation: string | null;
}

export type DesignSection =
  | { kind: 'markdown'; title: string; body: string; line: number }
  | { kind: 'context'; title: string; body: string; line: number }
  | {
      kind: 'goals';
      title: string;
      intro: string;
      goals: string;
      nonGoals: string;
      line: number;
    }
  | { kind: 'decisions'; title: string; intro: string; decisions: Decision[]; line: number }
  | { kind: 'risks'; title: string; intro: string; risks: Risk[]; outro: string; line: number }
  | { kind: 'open-questions'; title: string; body: string; count: number; line: number };

export interface DesignDoc {
  title: string | null;
  preamble: string;
  sections: DesignSection[];
  /** Number of open questions: surfaced on the overview card. */
  openQuestions: number;
}

const LABEL = (words: string) =>
  new RegExp(
    `^\\s*(?:#{3,6}\\s+)?(?:\\*\\*|__)?\\s*(${words})\\s*:?\\s*(?:\\*\\*|__)?\\s*:?\\s*(.*)$`,
    'i',
  );

const GOALS_LABEL = LABEL('Goals');
const NON_GOALS_LABEL = LABEL('Non[- ]?Goals');

function splitGoals(body: string): { intro: string; goals: string; nonGoals: string } | null {
  const lines = normalizeLineEndings(body).split('\n');
  const mask = buildCodeFenceMask(lines);
  const buckets = { intro: [] as string[], goals: [] as string[], nonGoals: [] as string[] };
  let current: keyof typeof buckets = 'intro';
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!mask[i]) {
      const nonGoals = NON_GOALS_LABEL.exec(line);
      const goals = nonGoals ? null : GOALS_LABEL.exec(line);
      // Only a label on its own line (or a heading) switches bucket, not prose mentioning goals.
      const isLabel = (match: RegExpExecArray | null) =>
        Boolean(match) && (/^\s*#{3,6}\s/.test(line) || /^\s*(\*\*|__)/.test(line));
      if (isLabel(nonGoals)) {
        current = 'nonGoals';
        found = true;
        if (nonGoals?.[2]) buckets.nonGoals.push(nonGoals[2]);
        continue;
      }
      if (isLabel(goals)) {
        current = 'goals';
        found = true;
        if (goals?.[2]) buckets.goals.push(goals[2]);
        continue;
      }
    }
    buckets[current].push(line);
  }
  if (!found) return null;
  return {
    intro: buckets.intro.join('\n').trim(),
    goals: buckets.goals.join('\n').trim(),
    nonGoals: buckets.nonGoals.join('\n').trim(),
  };
}

const ALTERNATIVES_START =
  /^\s*(?:#{4,6}\s+|[-*+]\s+)?(?:\*\*|__)?\s*Alternatives?(?:\s+considered)?\b[^\n]*$/i;
const NEXT_LABEL =
  /^\s*(?:#{4,6}\s+\S|(?:\*\*|__)[A-Z][^*_\n]{0,40}(?:\*\*|__)\s*:|(?:\*\*|__)[A-Z][^*_\n]{0,40}:(?:\*\*|__))/;

/** Pull the "Alternatives considered" part out of a decision so it can be folded. */
function splitAlternatives(body: string): { body: string; alternatives: string | null } {
  const lines = normalizeLineEndings(body).split('\n');
  const mask = buildCodeFenceMask(lines);
  const start = lines.findIndex((line, i) => !mask[i] && ALTERNATIVES_START.test(line));
  if (start === -1) return { body: body.trim(), alternatives: null };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!mask[i] && NEXT_LABEL.test(line) && !ALTERNATIVES_START.test(line)) {
      end = i;
      break;
    }
  }
  const first = (lines[start] ?? '')
    .replace(/^\s*(?:#{4,6}\s+|[-*+]\s+)?/, '')
    .replace(/^(?:\*\*|__)?\s*Alternatives?(?:\s+considered)?\s*:?\s*(?:\*\*|__)?\s*:?\s*/i, '');
  const alternatives = [first, ...lines.slice(start + 1, end)].join('\n').trim();
  return {
    body: [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim(),
    alternatives: alternatives || null,
  };
}

function cleanDecisionTitle(title: string): string {
  return title
    .replace(/^Decision\s*\d*\s*[:.–—-]\s*/i, '')
    .replace(/^D\d+\s*[:.–—-]\s*/i, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

function parseDecisions(body: string): { intro: string; decisions: Decision[] } {
  const sub = splitSections(body, 3);
  if (sub.sections.length > 0) {
    return {
      intro: sub.preamble,
      decisions: sub.sections.map((section) => ({
        title: cleanDecisionTitle(section.title),
        ...splitAlternatives(section.body),
      })),
    };
  }
  const list = splitTopLevelList(body);
  const decisions: Decision[] = [];
  for (const item of list.items) {
    const lead = /^(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:.–—-]?\s*([\s\S]*)$/.exec(item);
    const title = lead?.[1]?.replace(/:$/, '').trim();
    if (!title) return { intro: body.trim(), decisions: [] };
    decisions.push({ title: cleanDecisionTitle(title), ...splitAlternatives(lead?.[2] ?? '') });
  }
  if (decisions.length === 0 || list.after) return { intro: body.trim(), decisions: [] };
  return { intro: list.before, decisions };
}

const ARROW = /\s(?:→|->|=>|⇒)\s/;
const MITIGATION = /(?:\*\*|__)?\s*Mitigations?\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?/i;
const RISK_LABEL =
  /^(?:\[(Risk|Trade-?off)\]|(?:\*\*|__)\[?(Risk|Trade-?off)\]?(?:\*\*|__)\s*:?|(?:\*\*|__)(Risk|Trade-?off):(?:\*\*|__)|(Risk|Trade-?off)\s*:)\s*/i;

function parseRisk(item: string): Risk {
  let text = item.trim();
  const label = RISK_LABEL.exec(text);
  const labelText = label?.[1] ?? label?.[2] ?? label?.[3] ?? label?.[4] ?? '';
  if (label) text = text.slice(label[0].length);
  const kind: Risk['kind'] = /trade/i.test(labelText) ? 'trade-off' : 'risk';

  const mitigation = MITIGATION.exec(text);
  const arrow = ARROW.exec(text);
  const cut =
    mitigation && (!arrow || mitigation.index <= arrow.index + arrow[0].length)
      ? { index: mitigation.index, length: mitigation[0].length }
      : arrow
        ? { index: arrow.index, length: arrow[0].length }
        : null;
  if (!cut) return { kind, risk: text, mitigation: null };

  const risk = text
    .slice(0, cut.index)
    .replace(/\s*(?:→|->|=>|⇒)\s*$/, '')
    .trim();
  const after = text
    .slice(cut.index + cut.length)
    .replace(MITIGATION, '')
    .replace(/^\s*(?:→|->|=>|⇒)\s*/, '')
    .trim();
  return { kind, risk, mitigation: after || null };
}

function countQuestions(body: string): number {
  const list = splitTopLevelList(body);
  if (list.items.length > 0) return list.items.length;
  return body.split('\n').filter((line) => line.trim().endsWith('?')).length;
}

/** Read `design.md` into typed sections. Anything unrecognised stays plain Markdown. */
export function parseDesign(content: string): DesignDoc {
  const clean = stripHtmlComments(content);
  const title = /^#\s+(.+)$/m.exec(clean)?.[1]?.trim() ?? null;
  const { preamble, sections: raw } = splitSections(clean, 2);
  let openQuestions = 0;

  const sections = raw.map((section): DesignSection => {
    const { title: heading, body, line } = section;
    if (/^context\b/i.test(heading)) return { kind: 'context', title: heading, body, line };
    if (/non[- ]?goals/i.test(heading) || /^goals\b/i.test(heading)) {
      const split = splitGoals(body);
      if (split) return { kind: 'goals', title: heading, ...split, line };
    }
    if (/^decisions?\b/i.test(heading)) {
      const parsed = parseDecisions(body);
      if (parsed.decisions.length > 0)
        return { kind: 'decisions', title: heading, ...parsed, line };
    }
    if (/^risks?\b/i.test(heading) || /trade-?offs?/i.test(heading)) {
      const list = splitTopLevelList(body);
      if (list.items.length > 0) {
        return {
          kind: 'risks',
          title: heading,
          intro: list.before,
          risks: list.items.map(parseRisk),
          outro: list.after,
          line,
        };
      }
    }
    if (
      /^open\s+questions?\b/i.test(heading) ||
      /^(unresolved|outstanding)\s+questions?/i.test(heading)
    ) {
      const count =
        body.trim() && !/^(none|n\/a)\.?$/i.test(body.trim()) ? countQuestions(body) : 0;
      openQuestions += count;
      return { kind: 'open-questions', title: heading, body, count, line };
    }
    return { kind: 'markdown', title: heading, body, line };
  });

  return {
    title,
    preamble: preamble.replace(/^#\s+.+$/m, '').trim(),
    sections,
    openQuestions,
  };
}
