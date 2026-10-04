import { diffArrays } from 'diff';
import type { Blockquote, Heading, List, ListItem, Paragraph, RootContent } from 'mdast';
import { parseMarkdown, sourceOf } from '../markdown/parse';
import { alignSequences } from './align';
import { diffInline, hasChanges, type Segment } from './words';

export type DiffStatus = 'same' | 'added' | 'removed' | 'changed';

export interface DiffItem {
  status: DiffStatus;
  checked: boolean | null;
  children: DiffBlock[];
}

/** A block of rendered Markdown and how it changed. */
export type DiffBlock =
  | { kind: 'same' | 'added' | 'removed'; node: RootContent }
  /** A paragraph or heading whose words changed. */
  | { kind: 'inline'; node: Paragraph | Heading; segments: Segment[] }
  | { kind: 'list'; ordered: boolean; start: number | null; items: DiffItem[] }
  | { kind: 'quote'; children: DiffBlock[] };

function textOf(node: RootContent | ListItem): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node) {
    return (node.children as Array<RootContent | ListItem>).map(textOf).join(' ');
  }
  return '';
}

const words = (text: string) => text.match(/[\p{L}\p{N}_]+/gu) ?? [];

function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return 0;
  let common = 0;
  for (const part of diffArrays(left, right)) {
    if (!part.added && !part.removed) common += part.value.length;
  }
  return (2 * common) / (left.length + right.length);
}

const WHOLE_BLOCK = new Set(['code', 'table', 'thematicBreak', 'html', 'definition', 'yaml']);

function diffNodes(
  before: readonly RootContent[],
  beforeSource: string,
  after: readonly RootContent[],
  afterSource: string,
): DiffBlock[] {
  const equal = (a: RootContent, b: RootContent) =>
    a.type === b.type && sourceOf(a, beforeSource) === sourceOf(b, afterSource);
  const aligned = alignSequences(
    before,
    after,
    (a, b) => {
      if (a.type !== b.type) return 0;
      if (equal(a, b)) return 1;
      // Code, tables and the like are replaced whole rather than diffed inside.
      if (WHOLE_BLOCK.has(a.type)) return 0;
      // Two lists next to each other are the same list being edited.
      if (a.type === 'list') return Math.max(0.45, textSimilarity(textOf(a), textOf(b)));
      return textSimilarity(textOf(a), textOf(b));
    },
    0.4,
  );

  const out: DiffBlock[] = [];
  for (const pair of aligned) {
    const a = pair.before;
    const b = pair.after;
    if (a && !b) out.push({ kind: 'removed', node: a });
    else if (b && !a) out.push({ kind: 'added', node: b });
    else if (a && b) {
      if (equal(a, b)) {
        out.push({ kind: 'same', node: b });
      } else if ((a.type === 'paragraph' || a.type === 'heading') && a.type === b.type) {
        const segments = diffInline(a.children, (b as Paragraph | Heading).children);
        out.push(
          hasChanges(segments)
            ? { kind: 'inline', node: b as Paragraph | Heading, segments }
            : { kind: 'same', node: b },
        );
      } else if (a.type === 'list' && b.type === 'list') {
        out.push(diffLists(a, beforeSource, b, afterSource));
      } else if (a.type === 'blockquote' && b.type === 'blockquote') {
        out.push({
          kind: 'quote',
          children: diffNodes(a.children, beforeSource, (b as Blockquote).children, afterSource),
        });
      } else {
        out.push({ kind: 'removed', node: a }, { kind: 'added', node: b });
      }
    }
  }
  return out;
}

function diffLists(
  before: List,
  beforeSource: string,
  after: List,
  afterSource: string,
): DiffBlock {
  const asSame = (item: ListItem): DiffBlock[] =>
    item.children.map((node) => ({ kind: 'same' as const, node }));
  const items = alignSequences(
    before.children,
    after.children,
    (a, b) => textSimilarity(textOf(a), textOf(b)),
    0.4,
  ).map((pair): DiffItem => {
    if (pair.before && pair.after) {
      const children = diffNodes(
        pair.before.children,
        beforeSource,
        pair.after.children,
        afterSource,
      );
      const changed =
        children.some((child) => child.kind !== 'same') ||
        pair.before.checked !== pair.after.checked;
      return {
        status: changed ? 'changed' : 'same',
        checked: pair.after.checked ?? null,
        children,
      };
    }
    const item = pair.after ?? pair.before;
    return {
      status: pair.after ? 'added' : 'removed',
      checked: item?.checked ?? null,
      children: item ? asSame(item) : [],
    };
  });
  return { kind: 'list', ordered: Boolean(after.ordered), start: after.start ?? null, items };
}

/**
 * Diff two Markdown fragments block by block: matching paragraphs get a
 * word-level diff, lists are aligned item by item, and blocks that cannot be
 * compared inside (code, tables) are shown as removed and added.
 */
export function diffBlocks(before: string, after: string): DiffBlock[] {
  return diffNodes(parseMarkdown(before).children, before, parseMarkdown(after).children, after);
}

export function blocksChanged(blocks: readonly DiffBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'same') return false;
    if (block.kind === 'list') return block.items.some((item) => item.status !== 'same');
    if (block.kind === 'quote') return blocksChanged(block.children);
    return true;
  });
}
