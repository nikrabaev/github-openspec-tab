import { buildCodeFenceMask, normalizeLineEndings } from './text';

const BULLET = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;

export interface ListSplit {
  /** Markdown before the first top-level list item. */
  before: string;
  /** Each top-level item as Markdown, marker removed, continuation lines de-indented. */
  items: string[];
  /** Markdown after the list ends. */
  after: string;
}

/**
 * Split a Markdown fragment around its first top-level list. Nested bullets
 * and continuation lines stay with their item.
 */
export function splitTopLevelList(markdown: string): ListSplit {
  const lines = normalizeLineEndings(markdown).split('\n');
  const mask = buildCodeFenceMask(lines);
  const before: string[] = [];
  const after: string[] = [];
  const items: string[][] = [];
  let state: 'before' | 'list' | 'after' = 'before';
  let sawBlank = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (state === 'after') {
      after.push(line);
      continue;
    }
    const indent = line.length - line.trimStart().length;
    const bullet = mask[i] ? null : BULLET.exec(line);
    if (bullet && indent < 2) {
      state = 'list';
      sawBlank = false;
      items.push([bullet[2] ?? '']);
      continue;
    }
    if (state === 'before') {
      before.push(line);
      continue;
    }
    const current = items[items.length - 1];
    if (line.trim() === '') {
      sawBlank = true;
      current?.push('');
      continue;
    }
    // After a blank line, only indented content still belongs to the item.
    if (sawBlank && indent < 2 && !mask[i]) {
      state = 'after';
      after.push(line);
      continue;
    }
    sawBlank = false;
    current?.push(indent >= 2 ? line.slice(2) : line);
  }

  return {
    before: before.join('\n').trim(),
    items: items.map((item) => item.join('\n').trim()),
    after: after.join('\n').trim(),
  };
}

/** The first paragraph of a Markdown fragment, on one line. */
export function firstParagraph(markdown: string): string {
  const lines = normalizeLineEndings(markdown).split('\n');
  const mask = buildCodeFenceMask(lines);
  const paragraph: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (mask[i]) {
      if (paragraph.length) break;
      continue;
    }
    if (line === '') {
      if (paragraph.length) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      if (paragraph.length) break;
      continue;
    }
    if (BULLET.test(line) && paragraph.length) break;
    paragraph.push(line.replace(/^(?:[-*+]|\d{1,9}[.)])\s+/, ''));
  }
  return paragraph.join(' ');
}
