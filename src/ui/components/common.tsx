import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { deepLink } from '@/github/route';
import type { Counts, Operation, Problem } from '@/openspec';
import { usePull, useReview } from '../context';
import { AlertIcon, CheckIcon, InfoIcon, LinkIcon, StopIcon, SyncIcon } from '../icons';
import { InlineMarkdown, TermScope } from '../markdown/Markdown';

const OP_TEXT: Record<Operation, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
  renamed: 'Renamed',
};

export function OpLabel({ op }: { op: Operation }) {
  return <span className={`op op-${op}`}>{OP_TEXT[op]}</span>;
}

export function OpDot({ op }: { op: Operation }) {
  return <span className={`dot dot-${op}`} role="img" aria-label={OP_TEXT[op]} />;
}

/** How many requirements a capability's delta adds, modifies, removes and renames. */
export function CountChips({ counts }: { counts: Counts }) {
  const { added, modified, removed, renamed } = counts;
  return (
    <span className="counts">
      {added > 0 && (
        <span className="count count-added" title={`${added} added`}>
          +{added}
        </span>
      )}
      {modified > 0 && (
        <span className="count count-modified" title={`${modified} modified`}>
          ~{modified}
        </span>
      )}
      {removed > 0 && (
        <span className="count count-removed" title={`${removed} removed`}>
          −{removed}
        </span>
      )}
      {renamed > 0 && (
        <span className="count count-renamed" title={`${renamed} renamed`}>
          →{renamed}
        </span>
      )}
    </span>
  );
}

const SEVERITY_ICON = { error: StopIcon, warning: AlertIcon, info: InfoIcon } as const;
const SEVERITY_TEXT = { error: 'Problem', warning: 'Warning', info: 'Note' } as const;

/** Format problems, shown next to the thing they are about. */
export function ProblemList({ problems }: { problems: readonly Problem[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="problems">
      {problems.map((problem) => {
        const Icon = SEVERITY_ICON[problem.severity];
        return (
          <li
            key={`${problem.code}:${problem.line ?? ''}:${problem.message}`}
            className={`problem problem-${problem.severity}`}
          >
            <Icon />
            <span>
              <span className="sr-only">{SEVERITY_TEXT[problem.severity]}: </span>
              <InlineMarkdown source={problem.message} />
              {problem.line !== undefined && (
                <span className="problem-line"> Line {problem.line}.</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "Mark as read", remembered per pull request and reset when the content changes. */
export function ReadToggle({ id, hash, compact }: { id: string; hash: string; compact?: boolean }) {
  const review = useReview();
  const status = review.statusOf(id, hash);
  const label =
    status === 'read' ? 'Read' : status === 'stale' ? 'Changed since you read it' : 'Mark as read';
  return (
    <button
      type="button"
      className={`read read-${status}${compact ? ' is-compact' : ''}`}
      aria-pressed={status === 'read'}
      title={
        status === 'stale'
          ? 'This changed after you marked it as read. Mark it again when you have re-read it.'
          : undefined
      }
      onClick={() => review.toggle(id, hash)}
    >
      {status === 'stale' ? (
        <SyncIcon size={14} />
      ) : (
        <span className="read-box">{status === 'read' && <CheckIcon size={12} />}</span>
      )}
      <span>{label}</span>
    </button>
  );
}

/** Copy a deep link to an item of the tab. */
export function CopyLink({ id, label = 'Copy link' }: { id: string; label?: string }) {
  const { data } = usePull();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={copied ? 'Link copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(deepLink(data.pull, id));
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <CheckIcon /> : <LinkIcon />}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Link copied' : ''}
      </span>
    </button>
  );
}

export function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const fraction = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <div
      className={done === total && total > 0 ? 'bar is-complete' : 'bar'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <span style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}

/**
 * Tells a section how tall its sticky header is, as `--section-head-height` on
 * the section, so the requirement headers inside can stick right below it
 * whatever the header wraps to.
 */
export function useHeadHeight(head: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = head.current;
    const section = element?.parentElement;
    if (!element || !section || typeof ResizeObserver === 'undefined') return;
    const publish = () =>
      section.style.setProperty('--section-head-height', `${element.offsetHeight}px`);
    // Once now, so a jump made on load already lands below the header.
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, [head]);
}

/** A titled section of a change, with its anchor, deep link and read toggle. */
export function Section(props: {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  hash?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section ${props.className ?? ''}`} data-item={props.id} data-nav="">
      <header className="section-head">
        <h3>
          {props.icon}
          <span>{props.title}</span>
        </h3>
        {props.meta}
        <span className="grow" />
        <CopyLink id={props.id} />
        {props.hash !== undefined && <ReadToggle id={props.id} hash={props.hash} />}
      </header>
      <TermScope>{props.children}</TermScope>
    </section>
  );
}

export function Callout(props: {
  tone: 'attention' | 'accent' | 'danger' | 'neutral';
  title: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className={`callout callout-${props.tone}`}>
      <div className="callout-title">
        {props.icon}
        {props.title}
      </div>
      <div className="callout-body">{props.children}</div>
    </div>
  );
}

export { plural } from '@/openspec/text';

/** One row of a document on a wide window: a section across it, or two columns of sections. */
export type DocRow<T> = { full: T } | { left: T[]; right: T[] };

/**
 * Lays a document's sections out for a wide window. Sections that can share a
 * row and follow one another are split into two columns of about the same
 * length, read down the left and then down the right. When no split comes out
 * balanced, a column would end in a hole beside the other, so those sections
 * each take the full width instead, as does any section that cannot share.
 */
export function layoutRows<T>(
  items: readonly T[],
  canShare: (item: T) => boolean,
  weight: (item: T) => number,
): DocRow<T>[] {
  const rows: DocRow<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    const columns = run.length > 1 ? splitRun(run, weight) : null;
    if (columns) rows.push(columns);
    else for (const item of run) rows.push({ full: item });
    run = [];
  };
  for (const item of items) {
    if (canShare(item)) {
      run.push(item);
    } else {
      flush();
      rows.push({ full: item });
    }
  }
  flush();
  return rows;
}

/** The shorter column must be at least this much of the longer one. */
const BALANCE = 0.5;

/**
 * Cuts a run where the two sides come out closest in weight, keeping the order.
 * Null when even that cut leaves one side under half the other.
 */
function splitRun<T>(run: T[], weight: (item: T) => number): DocRow<T> | null {
  const weights = run.map(weight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cut = 1;
  let best = Number.POSITIVE_INFINITY;
  let bestLeft = 0;
  let left = 0;
  for (let i = 1; i < run.length; i++) {
    left += weights[i - 1] ?? 0;
    const difference = Math.abs(total - 2 * left);
    if (difference < best) {
      best = difference;
      cut = i;
      bestLeft = left;
    }
  }
  const right = total - bestLeft;
  if (Math.min(bestLeft, right) < BALANCE * Math.max(bestLeft, right)) return null;
  return { left: run.slice(0, cut), right: run.slice(cut) };
}

/** A document's sections in the rows `layoutRows` gave them. `render` must key what it returns. */
export function DocRows<T>(props: { rows: DocRow<T>[]; render: (item: T) => ReactNode }) {
  return props.rows.map((row, index) =>
    'full' in row ? (
      props.render(row.full)
    ) : (
      <div key={`columns-${index}`} className="doc-columns">
        <div className="doc-column">{row.left.map(props.render)}</div>
        <div className="doc-column">{row.right.map(props.render)}</div>
      </div>
    ),
  );
}

/**
 * A rough measure of how tall a piece of Markdown is once rendered in a column:
 * its length, plus an allowance for each paragraph or list item (a part-filled
 * last line and the gap after it) and for the section heading.
 */
export function proseWeight(markdown: string): number {
  const blocks = markdown.split('\n').filter((line) => line.trim() !== '').length;
  return markdown.length + 90 * blocks + 160;
}

/**
 * In a grid of two columns, says which items take half a row: an item does only
 * when the one after it (or before it) can sit beside it, so none is left alone
 * in half a row.
 */
export function pairHalves(canShare: readonly boolean[]): boolean[] {
  const half = canShare.map(() => false);
  for (let i = 0; i < canShare.length - 1; i++) {
    if (canShare[i] && canShare[i + 1]) {
      half[i] = true;
      half[i + 1] = true;
      i++;
    }
  }
  return half;
}

/**
 * Whether a piece of Markdown is short enough for a narrow column. Long prose
 * reads badly in one, and tables and code blocks need the room, so anything
 * with either is never compact.
 */
export function isCompact(markdown: string, limit: number): boolean {
  if (markdown.length > limit) return false;
  return !/^\s*\|.*\|\s*$/m.test(markdown) && !/^\s*(?:```|~~~)/m.test(markdown);
}
