import { type ReactNode, useEffect, useRef, useState } from 'react';
import { deepLink } from '@/github/route';
import type { Operation, Problem } from '@/openspec';
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
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div
      className={done === total && total > 0 ? 'bar is-complete' : 'bar'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
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
