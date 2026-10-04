import { useRef } from 'react';
import { blobUrl } from '@/github/route';
import type { CapabilityView } from '@/openspec';
import { usePull } from '../context';
import { ChevronIcon, SpecIcon } from '../icons';
import { Markdown, TermScope } from '../markdown/Markdown';
import {
  Callout,
  CopyLink,
  CountChips,
  isCompact,
  ProblemList,
  plural,
  useHeadHeight,
} from './common';
import { RequirementBody, RequirementCard } from './Requirement';

/** One capability's spec: its changed requirements as cards, the rest folded away. */
export function CapabilitySection({ view }: { view: CapabilityView }) {
  const { data } = usePull();
  const sourcePath = view.deltaPath ?? view.specPath;
  const head = useRef<HTMLElement>(null);
  useHeadHeight(head);
  return (
    <section className="section capability" data-item={view.id} data-nav="">
      <header className="section-head" ref={head}>
        <h3>
          <SpecIcon />
          <span>{view.label}</span>
        </h3>
        <code className="cap-id">{view.capability}</code>
        {view.isNew && <span className="tag tag-added">New capability</span>}
        {view.historical && <span className="tag">Archived earlier</span>}
        <CountChips counts={view.counts} />
        <span className="grow" />
        <a className="quiet-link" href={blobUrl(data.pull, data.facts.headSha, sourcePath)}>
          {view.deltaPath ? 'Delta file' : 'Spec file'}
        </a>
        <CopyLink id={view.id} />
      </header>

      <ProblemList problems={view.problems} />

      {view.purpose && (
        <Callout tone="neutral" title={view.purposeBefore ? 'Purpose (changed)' : 'Purpose'}>
          <Markdown source={view.purpose} />
          {view.purposeBefore && (
            <div className="removed-text">
              <Markdown source={view.purposeBefore} />
            </div>
          )}
        </Callout>
      )}

      {view.fallbackMarkdown !== null && (
        <div className="card fallback">
          <Markdown source={view.fallbackMarkdown} />
        </div>
      )}

      <div className="req-list">
        {view.changes.map((change) => (
          <RequirementCard key={change.id} change={change} historical={view.historical} />
        ))}
      </div>

      {view.unchanged.length > 0 && (
        <details className="unchanged">
          <summary>
            <ChevronIcon className="chev" />
            {plural(view.unchanged.length, 'unchanged requirement')}
          </summary>
          <div className="unchanged-list">
            {view.unchanged.map((requirement) => (
              <article key={requirement.name} className="req req-unchanged">
                <header className="req-head">
                  <h4>{requirement.name}</h4>
                </header>
                <div
                  className={
                    isCompact(requirement.statement, 900) ? 'req-body' : 'req-body is-stacked'
                  }
                >
                  <TermScope>
                    <RequirementBody requirement={requirement} scenariosOpen={false} />
                  </TermScope>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
