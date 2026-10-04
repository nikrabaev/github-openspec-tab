import { diffArrays } from 'diff';

/**
 * Line-level helpers shared by every OpenSpec reader.
 *
 * These follow the reference implementation (`@fission-ai/openspec` 1.14,
 * `core/parsers/code-fence.ts` and `requirement-blocks.ts`) so that what the
 * tab shows is what `openspec archive` would do.
 */

/** Strip a UTF-8 BOM and normalise CRLF / CR to LF. */
export function normalizeLineEndings(content: string): string {
  return content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function splitLines(content: string): string[] {
  return normalizeLineEndings(content).split('\n');
}

interface ActiveFence {
  marker: string;
  length: number;
}

function openingFence(line: string): ActiveFence | null {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  const run = match?.[1];
  if (!run) return null;
  return { marker: run.charAt(0), length: run.length };
}

function closesFence(line: string, active: ActiveFence): boolean {
  const match = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  const run = match?.[1];
  return Boolean(run && run.charAt(0) === active.marker && run.length >= active.length);
}

/**
 * A per-line mask where `true` marks a line inside a fenced code block,
 * including the fence lines themselves. Markdown structure on masked lines is
 * ignored by every reader.
 */
export function buildCodeFenceMask(lines: readonly string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let active: ActiveFence | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!active) {
      const fence = openingFence(line);
      if (fence) {
        active = fence;
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true;
    if (closesFence(line, active)) active = null;
  }
  return mask;
}

/** Blank out `<!-- ... -->` spans, keeping line count so indices stay aligned. */
export function maskHtmlComments(content: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  let out = '';
  let index = 0;
  for (;;) {
    const open = content.indexOf('<!--', index);
    if (open === -1) return out + content.slice(index);
    out += content.slice(index, open);
    let close = -1;
    for (let i = open + 4; i < content.length; i++) {
      if (content.startsWith('-->', i)) {
        close = i + 3;
        break;
      }
      if (content.startsWith('--!>', i)) {
        close = i + 4;
        break;
      }
    }
    if (close === -1) return out + blank(content.slice(open));
    out += blank(content.slice(open, close));
    index = close;
  }
}

/** Remove HTML comments entirely (template placeholders are not content). */
export function stripHtmlComments(content: string): string {
  return maskHtmlComments(content)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

/** Collapse runs of blank lines to one, leaving fenced code untouched. */
export function collapseBlankRunsOutsideFences(content: string): string {
  const lines = content.split('\n');
  const mask = buildCodeFenceMask(lines);
  const kept: string[] = [];
  let blankRun = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (mask[i]) {
      blankRun = 0;
      kept.push(line);
      continue;
    }
    if (line === '') {
      blankRun++;
      if (blankRun > 1) continue;
      kept.push(line);
      continue;
    }
    blankRun = 0;
    kept.push(line);
  }
  return kept.join('\n');
}

export interface MarkdownSection {
  /** Heading text without the leading `#`s, trimmed. */
  title: string;
  level: number;
  /** Body between this heading and the next heading of the same or higher level. */
  body: string;
  /** 1-based line of the heading in the source. */
  line: number;
}

/**
 * Split a document into its headings of exactly `level`, fence-aware. Content
 * above the first such heading is returned as `preamble`.
 */
export function splitSections(
  content: string,
  level: number,
): { preamble: string; sections: MarkdownSection[] } {
  const lines = splitLines(content);
  const mask = buildCodeFenceMask(lines);
  const heading = new RegExp(`^#{${level}}\\s+(.+)$`);
  const boundary = new RegExp(`^#{1,${level}}\\s+`);
  const sections: MarkdownSection[] = [];
  let preambleEnd = lines.length;
  let i = 0;
  while (i < lines.length) {
    const match = mask[i] ? null : heading.exec(lines[i] ?? '');
    if (!match) {
      i++;
      continue;
    }
    if (sections.length === 0) preambleEnd = i;
    let end = i + 1;
    while (end < lines.length && (mask[end] || !boundary.test(lines[end] ?? ''))) end++;
    sections.push({
      title: stripClosingHashes(match[1] ?? '').trim(),
      level,
      body: lines
        .slice(i + 1, end)
        .join('\n')
        .trim(),
      line: i + 1,
    });
    i = end;
  }
  return { preamble: lines.slice(0, preambleEnd).join('\n').trim(), sections };
}

/** `### Foo ###` renders as `Foo`; only a run preceded by a space or tab closes. */
export function stripClosingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, '');
}

/** Small, fast, stable string hash (cyrb53) used for change detection. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Whitespace-insensitive form of a block, for "did this change" comparisons. */
export function normalizeBlock(raw: string): string {
  return normalizeLineEndings(raw).trim();
}

/** Share of words two texts have in common, in order: 0 (nothing) to 1 (identical). */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = a.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const right = b.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (left.length === 0 || right.length === 0) return 0;
  let common = 0;
  for (const part of diffArrays(left, right)) {
    if (!part.added && !part.removed) common += part.value.length;
  }
  return (2 * common) / (left.length + right.length);
}
