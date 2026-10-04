import type { PhrasingContent, RootContent, Table } from 'mdast';
import { createContext, Fragment, type ReactNode, useContext, useId, useMemo, useRef } from 'react';
import type { DiffBlock, DiffItem } from '@/diff/blocks';
import type { Marks, Token } from '@/diff/tokens';
import type { Segment } from '@/diff/words';
import { parseInline, parseMarkdown } from '@/markdown/parse';
import type { GlossaryIndex, GlossaryMatch } from '@/openspec';
import { Term } from './Term';

/** How Markdown is turned into links, chips and highlights in one place of the UI. */
export interface MarkdownOptions {
  /** Style SHALL / MUST / SHOULD / MAY so obligations stand out. */
  keywords?: boolean;
  glossary?: GlossaryIndex | null;
  /** Resolve a relative link or path to an absolute URL; null leaves it as text. */
  resolveLink?(url: string): string | null;
  /** Turn `inline code` into something richer (a path chip, a capability chip). */
  renderCode?(value: string): ReactNode | null;
}

const OptionsContext = createContext<MarkdownOptions>({});

export function MarkdownProvider(props: { options: MarkdownOptions; children: ReactNode }) {
  return <OptionsContext.Provider value={props.options}>{props.children}</OptionsContext.Provider>;
}

/** Which fragment underlines which glossary term, shared by everything inside a `TermScope`. */
const ClaimsContext = createContext<Map<string, string> | null>(null);
/** Splits a scope in two, so both columns of a side-by-side view underline their terms. */
const ClaimSideContext = createContext('');

export function TermSide({ side, children }: { side: 'before' | 'after'; children: ReactNode }) {
  return <ClaimSideContext.Provider value={side}>{children}</ClaimSideContext.Provider>;
}

/**
 * Underline each glossary term once within this subtree (a requirement card, a
 * document section) rather than once per paragraph or step. The first fragment
 * in reading order claims a term and keeps it across re-renders.
 */
export function TermScope({ children }: { children: ReactNode }) {
  const claims = useRef(new Map<string, string>());
  return <ClaimsContext.Provider value={claims.current}>{children}</ClaimsContext.Provider>;
}

interface RenderState {
  options: MarkdownOptions;
  /** Glossary terms already underlined in this fragment: only the first use is marked. */
  seenTerms: Set<string>;
  /** Whether this fragment may underline a term, given what the rest of its scope already has. */
  claim(key: string): boolean;
}

export type DiffSide = 'both' | 'before' | 'after';

const KEYWORD = /\b(SHALL NOT|MUST NOT|SHOULD NOT|SHALL|MUST|SHOULD|MAY)\b/g;
const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

function keywordClass(keyword: string): string {
  if (keyword.endsWith('NOT')) return 'kw kw-not';
  if (keyword === 'SHALL' || keyword === 'MUST') return 'kw kw-must';
  return 'kw kw-soft';
}

/** Plain text with obligations styled and glossary terms underlined. */
function decorate(text: string, state: RenderState, keyPrefix: string): ReactNode {
  type Mark =
    | { start: number; end: number; kind: 'keyword' }
    | { start: number; end: number; kind: 'term'; match: GlossaryMatch };
  const marks: Mark[] = [];
  if (state.options.keywords) {
    for (const match of text.matchAll(KEYWORD)) {
      marks.push({ start: match.index, end: match.index + match[0].length, kind: 'keyword' });
    }
  }
  for (const match of state.options.glossary?.find(text) ?? []) {
    const key = `${match.avoided ? '!' : ''}${text.slice(match.start, match.end).toLowerCase()}`;
    if (state.seenTerms.has(key) || !state.claim(key)) continue;
    if (marks.some((mark) => match.start < mark.end && mark.start < match.end)) continue;
    state.seenTerms.add(key);
    marks.push({ start: match.start, end: match.end, kind: 'term', match });
  }
  if (marks.length === 0) return text;

  marks.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let cursor = 0;
  marks.forEach((mark, index) => {
    if (mark.start < cursor) return;
    if (mark.start > cursor) out.push(text.slice(cursor, mark.start));
    const value = text.slice(mark.start, mark.end);
    out.push(
      mark.kind === 'keyword' ? (
        <span key={`${keyPrefix}k${index}`} className={keywordClass(value)}>
          {value}
        </span>
      ) : (
        <Term key={`${keyPrefix}t${index}`} term={mark.match.term} avoided={mark.match.avoided}>
          {value}
        </Term>
      ),
    );
    cursor = mark.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function renderLink(url: string, children: ReactNode, state: RenderState, key: string): ReactNode {
  // Only plain web links and paths inside the repository become links. Anything
  // else with a scheme (javascript:, data:, ...) stays text.
  const external = /^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(url);
  const href = SAFE_PROTOCOL.test(url)
    ? url
    : external
      ? null
      : (state.options.resolveLink?.(url) ?? null);
  if (!href || !SAFE_PROTOCOL.test(href)) return <Fragment key={key}>{children}</Fragment>;
  return (
    <a key={key} href={href} rel="noopener noreferrer">
      {children}
    </a>
  );
}

function renderCode(value: string, state: RenderState, key: string): ReactNode {
  const custom = state.options.renderCode?.(value);
  if (custom) return <Fragment key={key}>{custom}</Fragment>;
  return <code key={key}>{value}</code>;
}

const isBreakingMark = (node: PhrasingContent | undefined) => {
  if (node?.type !== 'strong' || node.children.length !== 1) return false;
  const only = node.children[0];
  return only?.type === 'text' && /^BREAKING:?$/.test(only.value.trim());
};

function renderInline(
  nodes: readonly PhrasingContent[],
  state: RenderState,
  keyPrefix = '',
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.type) {
      case 'text': {
        // "**BREAKING**: text" reads as a badge followed by the text, without the colon.
        const value = isBreakingMark(nodes[index - 1])
          ? node.value.replace(/^\s*:\s*/, ' ')
          : node.value;
        return <Fragment key={key}>{decorate(value, state, key)}</Fragment>;
      }
      case 'strong': {
        if (isBreakingMark(node)) {
          return (
            <span key={key} className="badge badge-breaking">
              Breaking
            </span>
          );
        }
        return <strong key={key}>{renderInline(node.children, state, `${key}.`)}</strong>;
      }
      case 'emphasis':
        return <em key={key}>{renderInline(node.children, state, `${key}.`)}</em>;
      case 'delete':
        return <s key={key}>{renderInline(node.children, state, `${key}.`)}</s>;
      case 'inlineCode':
        return renderCode(node.value, state, key);
      case 'link':
        return renderLink(node.url, renderInline(node.children, state, `${key}.`), state, key);
      case 'break':
        return <br key={key} />;
      case 'image':
        return renderLink(node.url, node.alt || node.url, state, key);
      case 'html':
        // Raw HTML is never rendered. A line break is the one tag worth honouring.
        if (/^<br\s*\/?>$/i.test(node.value)) return <br key={key} />;
        if (/^<!--[\s\S]*-->$/.test(node.value)) return null;
        return <Fragment key={key}>{node.value}</Fragment>;
      case 'footnoteReference':
        return <sup key={key}>[{node.label ?? node.identifier}]</sup>;
      default:
        if ('children' in node) {
          return (
            <Fragment key={key}>
              {renderInline(node.children as PhrasingContent[], state, `${key}.`)}
            </Fragment>
          );
        }
        return 'value' in node ? <Fragment key={key}>{String(node.value)}</Fragment> : null;
    }
  });
}

function renderTable(node: Table, state: RenderState, key: string): ReactNode {
  const [head, ...rows] = node.children;
  const align = (index: number) => node.align?.[index] ?? undefined;
  return (
    <div key={key} className="md-table-wrap">
      <table>
        {head && (
          <thead>
            <tr>
              {head.children.map((cell, index) => (
                <th key={index} style={{ textAlign: align(index) }}>
                  {renderInline(cell.children, state)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.children.map((cell, index) => (
                <td key={index} style={{ textAlign: align(index) }}>
                  {renderInline(cell.children, state)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={checked ? 'md-check is-checked' : 'md-check'}
      role="img"
      aria-label={checked ? 'Done' : 'Not done'}
    >
      {checked && (
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

function renderBlock(node: RootContent, state: RenderState, key: string): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{renderInline(node.children, state)}</p>;
    case 'heading': {
      const Tag = `h${Math.min(6, node.depth + 2)}` as 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag key={key} className="md-heading">
          {renderInline(node.children, state)}
        </Tag>
      );
    }
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul';
      const task = node.children.some((item) => typeof item.checked === 'boolean');
      return (
        <Tag
          key={key}
          start={node.ordered ? (node.start ?? undefined) : undefined}
          className={task ? 'md-tasklist' : undefined}
        >
          {node.children.map((item, index) => {
            const breaking = JSON.stringify(item).includes('"value":"BREAKING');
            return (
              <li key={index} className={breaking ? 'is-breaking' : undefined}>
                {typeof item.checked === 'boolean' && <Checkbox checked={item.checked} />}
                {renderBlocks(item.children, state, !item.spread)}
              </li>
            );
          })}
        </Tag>
      );
    }
    case 'blockquote':
      return <blockquote key={key}>{renderBlocks(node.children, state)}</blockquote>;
    case 'code':
      return (
        <pre key={key} data-lang={node.lang ?? undefined}>
          <code>{node.value}</code>
        </pre>
      );
    case 'table':
      return renderTable(node, state, key);
    case 'thematicBreak':
      return <hr key={key} />;
    case 'html':
      if (/^\s*<!--[\s\S]*-->\s*$/.test(node.value)) return null;
      // Shown as the text it is, so nothing in a spec can inject markup into the page.
      return (
        <pre key={key} className="md-raw">
          <code>{node.value}</code>
        </pre>
      );
    case 'definition':
    case 'footnoteDefinition':
    case 'yaml':
      return null;
    default:
      if ('children' in node) {
        return <p key={key}>{renderInline(node.children as PhrasingContent[], state)}</p>;
      }
      return null;
  }
}

/** In a tight list the single paragraph of an item is shown without the paragraph wrapper. */
function renderBlocks(
  nodes: readonly RootContent[],
  state: RenderState,
  tight = false,
): ReactNode[] {
  return nodes.map((node, index) => {
    if (tight && node.type === 'paragraph') {
      return <Fragment key={`b${index}`}>{renderInline(node.children, state)}</Fragment>;
    }
    return renderBlock(node, state, `b${index}`);
  });
}

function useRenderState(): RenderState {
  const options = useContext(OptionsContext);
  const claims = useContext(ClaimsContext);
  const side = useContext(ClaimSideContext);
  const id = useId();
  return {
    options,
    // A fresh "seen" set per render pass, so the first use in this fragment is the one marked.
    seenTerms: new Set(),
    claim(term) {
      if (!claims) return true;
      const key = `${side}:${term}`;
      const owner = claims.get(key);
      if (owner === undefined) claims.set(key, id);
      return owner === undefined || owner === id;
    },
  };
}

/** Render a Markdown document or fragment. Raw HTML in the source is shown as text. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const state = useRenderState();
  const tree = useMemo(() => parseMarkdown(source), [source]);
  if (!source.trim()) return null;
  return (
    <div className={className ? `md ${className}` : 'md'}>{renderBlocks(tree.children, state)}</div>
  );
}

/** Render one line of inline Markdown, such as a scenario step, without a block wrapper. */
export function InlineMarkdown({ source }: { source: string }) {
  const state = useRenderState();
  const nodes = useMemo(() => parseInline(source), [source]);
  return <>{renderInline(nodes, state)}</>;
}

const sameMarks = (a: Marks, b: Marks) =>
  Boolean(a.strong) === Boolean(b.strong) &&
  Boolean(a.emphasis) === Boolean(b.emphasis) &&
  Boolean(a.delete) === Boolean(b.delete) &&
  Boolean(a.code) === Boolean(b.code) &&
  a.link === b.link;

/** Tokens back into formatted text: consecutive tokens with the same formatting share an element. */
function renderTokens(
  tokens: readonly Token[],
  state: RenderState,
  keyPrefix: string,
  decorated: boolean,
): ReactNode[] {
  const out: ReactNode[] = [];
  let index = 0;
  while (index < tokens.length) {
    const first = tokens[index];
    if (!first) break;
    let end = index + 1;
    if (!first.marks.code) {
      while (end < tokens.length && sameMarks(first.marks, (tokens[end] as Token).marks)) end++;
    }
    const text = tokens
      .slice(index, end)
      .map((token) => token.text)
      .join('');
    const key = `${keyPrefix}${index}`;
    let node: ReactNode = first.marks.code
      ? renderCode(text, state, key)
      : decorated
        ? decorate(text, state, key)
        : text;
    if (first.marks.strong) node = <strong>{node}</strong>;
    if (first.marks.emphasis) node = <em>{node}</em>;
    if (first.marks.delete) node = <s>{node}</s>;
    if (first.marks.link) node = renderLink(first.marks.link, node, state, `${key}l`);
    out.push(<Fragment key={key}>{node}</Fragment>);
    index = end;
  }
  return out;
}

function renderSegments(
  segments: readonly Segment[],
  side: DiffSide,
  state: RenderState,
): ReactNode[] {
  return segments.map((segment, index) => {
    const key = `s${index}`;
    if (segment.type === 'same') {
      return <Fragment key={key}>{renderTokens(segment.tokens, state, key, true)}</Fragment>;
    }
    if (segment.type === 'removed') {
      if (side === 'after') return null;
      return (
        <del key={key} className="w-del">
          {renderTokens(
            segment.tokens,
            { ...state, options: { ...state.options, glossary: null } },
            key,
            true,
          )}
        </del>
      );
    }
    if (side === 'before') return null;
    return (
      <ins key={key} className="w-ins">
        {renderTokens(segment.tokens, state, key, true)}
      </ins>
    );
  });
}

/** A changed line of inline Markdown, with removed words struck and added words highlighted. */
export function InlineDiff({
  segments,
  side = 'both',
}: {
  segments: readonly Segment[];
  side?: DiffSide;
}) {
  const state = useRenderState();
  return <>{renderSegments(segments, side, state)}</>;
}

const ITEM_CLASS: Record<DiffItem['status'], string | undefined> = {
  same: undefined,
  changed: undefined,
  added: 'blk-added',
  removed: 'blk-removed',
};

function renderDiffBlocks(
  blocks: readonly DiffBlock[],
  side: DiffSide,
  state: RenderState,
): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `d${index}`;
    switch (block.kind) {
      case 'same':
        return renderBlock(block.node, state, key);
      case 'added':
        if (side === 'before') return null;
        return (
          <div key={key} className="blk blk-added">
            {renderBlock(block.node, state, key)}
          </div>
        );
      case 'removed':
        if (side === 'after') return null;
        return (
          <div key={key} className="blk blk-removed">
            {renderBlock(
              block.node,
              { ...state, options: { ...state.options, glossary: null } },
              key,
            )}
          </div>
        );
      case 'inline': {
        const children = renderSegments(block.segments, side, state);
        if (block.node.type === 'heading') {
          const Tag = `h${Math.min(6, block.node.depth + 2)}` as 'h3' | 'h4' | 'h5' | 'h6';
          return (
            <Tag key={key} className="md-heading">
              {children}
            </Tag>
          );
        }
        return <p key={key}>{children}</p>;
      }
      case 'quote':
        return <blockquote key={key}>{renderDiffBlocks(block.children, side, state)}</blockquote>;
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag key={key} start={block.ordered ? (block.start ?? undefined) : undefined}>
            {block.items.map((item, itemIndex) => {
              if (item.status === 'added' && side === 'before') return null;
              if (item.status === 'removed' && side === 'after') return null;
              return (
                <li key={itemIndex} className={ITEM_CLASS[item.status]}>
                  {typeof item.checked === 'boolean' && <Checkbox checked={item.checked} />}
                  {renderDiffBlocks(item.children, side, state)}
                </li>
              );
            })}
          </Tag>
        );
      }
      default:
        return null;
    }
  });
}

/** Rendered Markdown with its changes marked: both sides at once, or one side of a split view. */
export function MarkdownDiff(props: {
  blocks: readonly DiffBlock[];
  side?: DiffSide;
  className?: string;
}) {
  const state = useRenderState();
  return (
    <div className={props.className ? `md ${props.className}` : 'md'}>
      {renderDiffBlocks(props.blocks, props.side ?? 'both', state)}
    </div>
  );
}
