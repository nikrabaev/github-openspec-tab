import { diffArrays } from 'diff';
import type { PhrasingContent } from 'mdast';
import { parseInline } from '../markdown/parse';
import { type Token, tokenize, tokenKey } from './tokens';

export interface Segment {
  type: 'same' | 'removed' | 'added';
  tokens: Token[];
}

const allSpace = (tokens: readonly Token[]) => tokens.every((token) => token.space);

/**
 * Word-level diff between two token sequences.
 *
 * The raw diff is tidied for reading: whitespace between two changes joins
 * them (so "within ~~10 seconds~~ **5 seconds**" reads as one edit, not two),
 * and a replacement always lists what was removed before what was added.
 */
export function diffTokens(before: readonly Token[], after: readonly Token[]): Segment[] {
  const raw = diffArrays(before as Token[], after as Token[], {
    comparator: (a, b) => tokenKey(a) === tokenKey(b),
  });

  // jsdiff reports common runs with the old tokens; show them with the new formatting.
  const parts: Segment[] = [];
  let afterIndex = 0;
  for (const part of raw) {
    if (part.added) {
      parts.push({ type: 'added', tokens: part.value });
      afterIndex += part.value.length;
    } else if (part.removed) {
      parts.push({ type: 'removed', tokens: part.value });
    } else {
      parts.push({ type: 'same', tokens: after.slice(afterIndex, afterIndex + part.value.length) });
      afterIndex += part.value.length;
    }
  }

  // Fold whitespace-only common runs that sit between two changes into both sides.
  const folded: Segment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const previous = folded[folded.length - 1];
    const next = parts[i + 1];
    if (
      part.type === 'same' &&
      allSpace(part.tokens) &&
      previous &&
      previous.type !== 'same' &&
      next &&
      next.type !== 'same'
    ) {
      folded.push({ type: 'removed', tokens: part.tokens }, { type: 'added', tokens: part.tokens });
      continue;
    }
    folded.push(part);
  }

  // Within each run of changes, group removed then added.
  const out: Segment[] = [];
  let removed: Token[] = [];
  let added: Token[] = [];
  const flush = () => {
    // A change that is only whitespace is not worth marking.
    if (removed.length && allSpace(removed) && added.length && allSpace(added)) {
      out.push({ type: 'same', tokens: added });
    } else {
      if (removed.length) out.push({ type: 'removed', tokens: removed });
      if (added.length) out.push({ type: 'added', tokens: added });
    }
    removed = [];
    added = [];
  };
  for (const part of folded) {
    if (part.type === 'removed') removed.push(...part.tokens);
    else if (part.type === 'added') added.push(...part.tokens);
    else {
      flush();
      const last = out[out.length - 1];
      if (last?.type === 'same') last.tokens.push(...part.tokens);
      else out.push({ type: 'same', tokens: [...part.tokens] });
    }
  }
  flush();
  return out;
}

export function diffInline(
  before: readonly PhrasingContent[],
  after: readonly PhrasingContent[],
): Segment[] {
  return diffTokens(tokenize(before), tokenize(after));
}

/** Word diff between two inline Markdown strings. */
export function diffInlineMarkdown(before: string, after: string): Segment[] {
  return diffInline(parseInline(before), parseInline(after));
}

export const hasChanges = (segments: readonly Segment[]) =>
  segments.some((segment) => segment.type !== 'same');

/** Share of words two inline Markdown strings have in common, 0 to 1. */
export function similarity(before: string, after: string): number {
  if (before === after) return 1;
  const a = tokenize(parseInline(before)).filter((token) => !token.space);
  const b = tokenize(parseInline(after)).filter((token) => !token.space);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let common = 0;
  for (const part of diffArrays(a.map(tokenKey), b.map(tokenKey))) {
    if (!part.added && !part.removed) common += part.value.length;
  }
  return (2 * common) / (a.length + b.length);
}
