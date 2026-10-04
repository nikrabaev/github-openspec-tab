import { buildCodeFenceMask, splitLines, splitSections, stripHtmlComments } from './text';

export interface GlossaryTerm {
  term: string;
  /** Inline Markdown. */
  definition: string;
  /** Words the glossary says to avoid in favour of this term. */
  avoid: string[];
}

const GLOSSARY_SECTION = /\b(language|glossary|terms|terminology|vocabulary|definitions)\b/i;
const SEPARATOR = /^\s*(?:[:–—-]|--)\s*/;

function cleanTerm(term: string): string {
  return term.replace(/[`*_]/g, '').replace(/:$/, '').trim();
}

function parseAvoid(line: string): string[] | null {
  const match =
    /^\s*(?:[-*+]\s+)?(?:[_*]{1,2})?Avoid(?:[_*]{1,2})?\s*:\s*(?:[_*]{1,2})?\s*(.*)$/i.exec(line);
  if (!match) return null;
  return (match[1] ?? '')
    .split(/[,;]/)
    .map((word) => cleanTerm(word))
    .filter(Boolean);
}

function parseTable(lines: string[], start: number, terms: GlossaryTerm[]): number {
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
  const header = cells(lines[start] ?? '');
  if (!/^[\s|:-]+$/.test(lines[start + 1] ?? '') || header.length < 2) return start;
  let i = start + 2;
  for (; i < lines.length && (lines[i] ?? '').trim().startsWith('|'); i++) {
    const row = cells(lines[i] ?? '');
    const term = cleanTerm(row[0] ?? '');
    if (term && row[1]) terms.push({ term, definition: row[1], avoid: [] });
  }
  return i - 1;
}

function parseBody(body: string, terms: GlossaryTerm[], headingsAreTerms: boolean): void {
  const lines = splitLines(body);
  const mask = buildCodeFenceMask(lines);
  let current: GlossaryTerm | null = null;
  const start = (term: string, definition: string) => {
    current = { term: cleanTerm(term), definition: definition.trim(), avoid: [] };
    if (current.term) terms.push(current);
  };

  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      current = null;
      continue;
    }
    const avoid = parseAvoid(line);
    if (avoid) {
      const target = current ?? terms[terms.length - 1];
      target?.avoid.push(...avoid);
      continue;
    }
    if (line.trim().startsWith('|')) {
      i = parseTable(lines, i, terms);
      current = null;
      continue;
    }
    const heading = /^#{3,6}\s+(.+)$/.exec(line);
    if (heading?.[1]) {
      if (headingsAreTerms) start(heading[1], '');
      else current = null;
      continue;
    }
    // **Term**: definition  ·  - **Term** — definition  ·  **Term:** definition
    const bold = /^\s*(?:[-*+]\s+)?(?:\*\*|__)(.+?)(?:\*\*|__)(.*)$/.exec(line);
    if (bold?.[1] && bold[1].length <= 60) {
      const rest = bold[2] ?? '';
      const colonInside = bold[1].endsWith(':');
      if (colonInside || rest.trim() === '' || SEPARATOR.test(rest)) {
        start(bold[1], rest.replace(SEPARATOR, ''));
        continue;
      }
    }
    // Definition-list form: a `: definition` line under the term.
    const definitionLine = /^:\s+(.+)$/.exec(line);
    if (definitionLine?.[1] && i > 0 && !current) {
      const previous = (lines[i - 1] ?? '').trim();
      if (previous && previous.length <= 60) start(previous, definitionLine[1]);
      continue;
    }
    if (current) {
      const open: GlossaryTerm = current;
      open.definition = `${open.definition} ${line.trim()}`.trim();
    }
  }
}

/**
 * Read a glossary out of a context document (`docs/CONTEXT.md`).
 *
 * The format is worked out from the file: bold-term definitions (inline or on
 * the following lines, with an optional `_Avoid_:` list), term tables, heading
 * + paragraph pairs and definition lists are all recognised. When the document
 * has a section named Language / Glossary / Terms, only that section is read.
 */
export function parseGlossary(content: string): GlossaryTerm[] {
  const clean = stripHtmlComments(content);
  const { sections } = splitSections(clean, 2);
  const glossarySections = sections.filter((section) => GLOSSARY_SECTION.test(section.title));
  const terms: GlossaryTerm[] = [];
  if (glossarySections.length > 0) {
    for (const section of glossarySections) parseBody(section.body, terms, true);
  } else {
    parseBody(clean, terms, false);
  }

  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = term.term.toLowerCase();
    if (!term.definition || term.term.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface GlossaryMatch {
  start: number;
  end: number;
  term: GlossaryTerm;
  /** True when the text uses a word the glossary says to avoid. */
  avoided: boolean;
}

export interface GlossaryIndex {
  terms: GlossaryTerm[];
  find(text: string): GlossaryMatch[];
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build a matcher for glossary terms: whole words, case-insensitive, longest first, simple plurals. */
export function buildGlossaryIndex(terms: GlossaryTerm[]): GlossaryIndex {
  const lookup = new Map<string, { term: GlossaryTerm; avoided: boolean }>();
  for (const term of terms) lookup.set(term.term.toLowerCase(), { term, avoided: false });
  for (const term of terms) {
    for (const word of term.avoid) {
      const key = word.toLowerCase();
      if (!lookup.has(key)) lookup.set(key, { term, avoided: true });
    }
  }
  const words = [...lookup.keys()].sort((a, b) => b.length - a.length);
  if (words.length === 0) return { terms, find: () => [] };
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${words.map(escapeRegExp).join('|')})(s|es)?(?![\\p{L}\\p{N}_])`,
    'giu',
  );
  return {
    terms,
    find(text) {
      const matches: GlossaryMatch[] = [];
      for (const match of text.matchAll(pattern)) {
        const entry = lookup.get((match[1] ?? '').toLowerCase());
        if (!entry || match.index === undefined) continue;
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          term: entry.term,
          avoided: entry.avoided,
        });
      }
      return matches;
    },
  };
}
