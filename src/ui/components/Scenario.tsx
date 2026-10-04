import type { DiffStatus } from '@/diff/blocks';
import type { PartRow, ScenarioDiff } from '@/diff/requirement';
import type { Scenario, ScenarioPart } from '@/openspec';
import { ChevronIcon } from '../icons';
import {
  type DiffSide,
  InlineDiff,
  InlineMarkdown,
  Markdown,
  MarkdownDiff,
  TermSide,
} from '../markdown/Markdown';
import { plural } from './common';

const STATUS_TEXT: Record<DiffStatus, string | null> = {
  same: null,
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

function Keyword({ part, changed }: { part: ScenarioPart | null; changed?: boolean }) {
  if (part?.kind !== 'step') return <span className="kwd" />;
  if (!part.keyword)
    return (
      <span className="kwd kwd-none" aria-hidden="true">
        •
      </span>
    );
  return (
    <span className={`kwd kwd-${part.keyword.toLowerCase()}${changed ? ' is-changed' : ''}`}>
      {part.keyword}
    </span>
  );
}

function PartBody({ part }: { part: ScenarioPart }) {
  if (part.kind === 'prose') return <Markdown source={part.text} />;
  return (
    <>
      <InlineMarkdown source={part.text} />
      {part.extra && <Markdown source={part.extra} className="step-extra" />}
    </>
  );
}

/** One row: the keyword in its own column, then the step. Prose spans the full width. */
function Row({ row, side }: { row: PartRow; side: DiffSide }) {
  const part = side === 'before' ? row.before : (row.after ?? row.before);
  if (!part) return <div className="step is-empty" aria-hidden="true" />;
  // In a split view a row that exists on one side only is simply that side's text.
  const status =
    side === 'both'
      ? row.status
      : row.status === 'changed'
        ? 'changed'
        : row.status === 'same'
          ? 'same'
          : side === 'before'
            ? 'removed'
            : 'added';
  const body =
    row.status === 'changed' && row.before && row.after ? (
      <>
        {row.segments ? (
          <InlineDiff segments={row.segments} side={side} />
        ) : part.kind === 'step' ? (
          <InlineMarkdown source={part.text} />
        ) : null}
        {row.blocks ? (
          <MarkdownDiff
            blocks={row.blocks}
            side={side}
            className={part.kind === 'step' ? 'step-extra' : undefined}
          />
        ) : (
          part.kind === 'step' &&
          part.extra && <Markdown source={part.extra} className="step-extra" />
        )}
      </>
    ) : (
      <PartBody part={part} />
    );
  return (
    <div className={`step step-${status}${part.kind === 'prose' ? ' is-prose' : ''}`}>
      {part.kind === 'step' && (
        <>
          {side === 'both' && row.keywordChanged && row.before && (
            <Keyword part={row.before} changed />
          )}
          <Keyword part={part} />
        </>
      )}
      <div className="step-text">{body}</div>
    </div>
  );
}

function stepCount(parts: readonly ScenarioPart[]): string {
  const steps = parts.filter((part) => part.kind === 'step').length;
  return steps > 0 ? plural(steps, 'step') : 'no steps';
}

function Summary(props: {
  name: string;
  previousName?: string | null;
  status: DiffStatus;
  count: string;
}) {
  const status = STATUS_TEXT[props.status];
  return (
    <summary>
      <ChevronIcon className="chev" />
      <span className="scn-kind">Scenario</span>
      <span className="scn-name">
        {props.previousName && (
          <>
            <del className="w-del">{props.previousName}</del>{' '}
          </>
        )}
        {props.name}
      </span>
      {status && <span className={`tag tag-${props.status}`}>{status}</span>}
      <span className="scn-count">{props.count}</span>
    </summary>
  );
}

/** A scenario as written: folded under its name, steps in a keyword column. */
export function ScenarioView({ scenario, open = true }: { scenario: Scenario; open?: boolean }) {
  return (
    <details className="scn" open={open}>
      <Summary name={scenario.name} status="same" count={stepCount(scenario.parts)} />
      <div className="steps">
        {scenario.parts.length === 0 && <p className="muted">This scenario has no steps.</p>}
        {scenario.parts.map((part, index) => (
          <Row
            key={index}
            side="both"
            row={{
              status: 'same',
              before: part,
              after: part,
              segments: null,
              blocks: null,
              keywordChanged: false,
            }}
          />
        ))}
      </div>
    </details>
  );
}

/** A scenario of a modified requirement, with its changes marked inline. */
export function ScenarioDiffView({ diff, marks = true }: { diff: ScenarioDiff; marks?: boolean }) {
  const parts = (diff.after ?? diff.before)?.parts ?? [];
  // "New version only" keeps the status tag but shows the text clean.
  const rows = marks ? diff.rows : diff.rows.filter((row) => row.after);
  return (
    <details
      className={`scn scn-${diff.status}`}
      open={diff.status !== 'same' && (marks || diff.status !== 'removed')}
    >
      <Summary
        name={diff.name}
        previousName={marks ? diff.previousName : null}
        status={diff.status}
        count={stepCount(parts)}
      />
      <div className="steps">
        {rows.map((row, index) => (
          <Row
            key={index}
            side={marks ? 'both' : 'after'}
            row={marks ? row : { ...row, status: 'same', segments: null, blocks: null }}
          />
        ))}
        {!marks && diff.status === 'removed' && (
          <p className="muted">Removed in the new version.</p>
        )}
      </div>
    </details>
  );
}

/** A scenario side by side: old on the left, new on the right, aligned step by step. */
export function ScenarioSplitView({ diff }: { diff: ScenarioDiff }) {
  const status = STATUS_TEXT[diff.status];
  return (
    <details className={`scn scn-split scn-${diff.status}`} open={diff.status !== 'same'}>
      <summary>
        <ChevronIcon className="chev" />
        <span className="split-pair">
          <span className="split-cell">
            {diff.before ? (
              <>
                <span className="scn-kind">Scenario</span>
                <span className="scn-name">{diff.previousName ?? diff.name}</span>
              </>
            ) : (
              <span className="muted">Not in the old version</span>
            )}
          </span>
          <span className="split-cell">
            {diff.after ? (
              <>
                <span className="scn-kind">Scenario</span>
                <span className="scn-name">{diff.name}</span>
              </>
            ) : (
              <span className="muted">Not in the new version</span>
            )}
            {status && <span className={`tag tag-${diff.status}`}>{status}</span>}
          </span>
        </span>
      </summary>
      <div className="steps">
        {diff.rows.map((row, index) => (
          <div className="split-pair" key={index}>
            <div className="split-cell">
              <TermSide side="before">
                {row.before ? <Row row={row} side="before" /> : <div className="step is-empty" />}
              </TermSide>
            </div>
            <div className="split-cell">
              <TermSide side="after">
                {row.after ? <Row row={row} side="after" /> : <div className="step is-empty" />}
              </TermSide>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
