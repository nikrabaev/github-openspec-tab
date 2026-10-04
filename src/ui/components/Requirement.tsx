import { useMemo } from 'react';
import { diffRequirement } from '@/diff/requirement';
import { blobUrl, diffLineUrl } from '@/github/route';
import type { Requirement, RequirementChange } from '@/openspec';
import { useDiffView, usePull } from '../context';
import { ArrowIcon, ChevronIcon, CommentIcon, ExternalIcon } from '../icons';
import { Markdown, MarkdownDiff, TermScope, TermSide } from '../markdown/Markdown';
import { Callout, CopyLink, OpLabel, ProblemList, plural, ReadToggle } from './common';
import { ScenarioDiffView, ScenarioSplitView, ScenarioView } from './Scenario';

/** A requirement as written: its statement, then its scenarios. */
export function RequirementBody(props: { requirement: Requirement; scenariosOpen?: boolean }) {
  const { requirement } = props;
  return (
    <>
      <Markdown source={requirement.statement} className="statement" />
      {requirement.scenarios.length > 0 && (
        <div className="scenarios">
          {requirement.scenarios.map((scenario) => (
            <ScenarioView
              key={`${scenario.offset}:${scenario.name}`}
              scenario={scenario}
              open={props.scenariosOpen ?? true}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ModifiedBody({ before, after }: { before: Requirement; after: Requirement }) {
  const view = useDiffView();
  const diff = useMemo(() => diffRequirement(before, after), [before, after]);
  const summary = [
    diff.counts.added && `${plural(diff.counts.added, 'scenario')} added`,
    diff.counts.removed && `${diff.counts.removed} removed`,
    diff.counts.changed && `${diff.counts.changed} changed`,
    diff.counts.same && `${diff.counts.same} unchanged`,
  ].filter(Boolean);

  const scenarioSummary = summary.length > 0 && (
    <p className="scenario-summary">{summary.join(' · ')}</p>
  );

  if (view === 'split') {
    return (
      <div className="split">
        <div className="split-pair split-head" aria-hidden="true">
          <div className="split-cell">Before</div>
          <div className="split-cell">After</div>
        </div>
        <div className="split-pair">
          <div className="split-cell">
            <TermSide side="before">
              <MarkdownDiff blocks={diff.statement} side="before" className="statement" />
            </TermSide>
          </div>
          <div className="split-cell">
            <TermSide side="after">
              <MarkdownDiff blocks={diff.statement} side="after" className="statement" />
            </TermSide>
          </div>
        </div>
        {scenarioSummary}
        <div className="scenarios">
          {diff.scenarios.map((scenario) => (
            <ScenarioSplitView key={`${scenario.status}:${scenario.name}`} diff={scenario} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {view === 'new' ? (
        <Markdown source={after.statement} className="statement" />
      ) : (
        <MarkdownDiff blocks={diff.statement} className="statement" />
      )}
      {scenarioSummary}
      <div className="scenarios">
        {diff.scenarios.map((scenario) => (
          <ScenarioDiffView
            key={`${scenario.status}:${scenario.name}`}
            diff={scenario}
            marks={view !== 'new'}
          />
        ))}
      </div>
    </>
  );
}

function SourceLink({ change }: { change: RequirementChange }) {
  const { data } = usePull();
  const source = change.source;
  if (!source) return null;
  if (source.inDiff) {
    return (
      <a
        className="icon-button has-label"
        href={diffLineUrl(data.pull, source.path, source.line, source.side)}
        title={`Comment on line ${source.line} of ${source.path} in Files changed`}
      >
        <CommentIcon />
        <span>Comment</span>
      </a>
    );
  }
  const commit = source.side === 'L' ? data.facts.baseSha : data.facts.headSha;
  return (
    <a
      className="icon-button has-label"
      href={blobUrl(data.pull, commit, source.path, source.line)}
      title={`This text is not part of the diff, so it cannot take a review comment. Open ${source.path} at line ${source.line}.`}
    >
      <ExternalIcon />
      <span>Source</span>
    </a>
  );
}

/** One changed requirement: what happened to it, shown the way that operation reads best. */
export function RequirementCard({
  change,
  historical,
}: {
  change: RequirementChange;
  historical?: boolean;
}) {
  const view = useDiffView();
  const { before, after } = change;
  const renamedAlso = change.op === 'modified' && change.previousName;

  let body: React.ReactNode = null;
  if (change.op === 'modified' && before && after) {
    body = <ModifiedBody before={before} after={after} />;
  } else if (change.op === 'removed') {
    body = (
      <>
        {change.reason && (
          <Callout tone="neutral" title="Reason">
            <Markdown source={change.reason} />
          </Callout>
        )}
        {change.migration && (
          <Callout tone="accent" title="Migration">
            <Markdown source={change.migration} />
          </Callout>
        )}
        {before && (
          <div className="removed-text">
            <RequirementBody requirement={before} scenariosOpen={false} />
          </div>
        )}
      </>
    );
  } else if (change.op === 'renamed') {
    body = after && (
      <details className="fold">
        <summary>
          <ChevronIcon className="chev" />
          The text is unchanged. Show it
        </summary>
        <RequirementBody requirement={after} scenariosOpen={false} />
      </details>
    );
  } else if (after) {
    body = <RequirementBody requirement={after} />;
  }

  return (
    <article
      className={`req req-${change.op}`}
      data-item={change.id}
      data-nav=""
      aria-labelledby={`${change.id}-title`}
    >
      <header className="req-head">
        <OpLabel op={change.op} />
        {renamedAlso && <OpLabel op="renamed" />}
        <h4 id={`${change.id}-title`}>
          {change.previousName && (
            <>
              <span className="old-name">{change.previousName}</span>
              <ArrowIcon className="rename-arrow" />
              <span className="sr-only"> renamed to </span>
            </>
          )}
          {change.name}
        </h4>
        <span className="grow" />
        <div className="req-actions">
          <CopyLink id={change.id} label="Copy link to this requirement" />
          {!historical && <SourceLink change={change} />}
          {!historical && <ReadToggle id={change.id} hash={change.hash} />}
        </div>
      </header>
      <ProblemList problems={change.problems} />
      <div className="req-body">
        <TermScope key={`${view}:${change.hash}`}>{body}</TermScope>
      </div>
    </article>
  );
}
