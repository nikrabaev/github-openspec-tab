import type { PhrasingContent, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const processor = unified().use(remarkParse).use(remarkGfm);
const cache = new Map<string, Root>();
const CACHE_LIMIT = 2000;

/**
 * Parse Markdown (CommonMark + GFM) into an mdast tree. Results are cached by
 * source text: the same statement or step is parsed once however often it is
 * rendered. Raw HTML stays as inert `html` nodes; nothing here ever turns
 * source text into markup.
 */
export function parseMarkdown(source: string): Root {
  const hit = cache.get(source);
  if (hit) return hit;
  const tree = processor.parse(source);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(source, tree);
  return tree;
}

/** The inline content of a one-paragraph fragment such as a scenario step. */
export function parseInline(source: string): PhrasingContent[] {
  const tree = parseMarkdown(source);
  const first = tree.children[0];
  if (tree.children.length === 1 && first?.type === 'paragraph') return first.children;
  // Not a single paragraph (e.g. the step starts with `#` or `>`): keep its text as written.
  return [{ type: 'text', value: source }];
}

/** The source text a node was parsed from. */
export function sourceOf(node: RootContent, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? '' : source.slice(start, end);
}
