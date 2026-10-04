import type { ChangeView, DesignDoc, DesignSection as DesignPart, DocView } from '@/openspec';
import { ArrowIcon, CheckIcon, ChevronIcon, CloseIcon, PencilIcon, QuestionIcon } from '../icons';
import { Markdown, MarkdownProvider } from '../markdown/Markdown';
import { useMarkdownOptions } from '../markdownOptions';
import { Callout, isCompact, pairHalves, plural, Section } from './common';
import { DiagramFigure } from './Diagram';

function Part({ part, half }: { part: DesignPart; half: boolean }) {
  const block = half ? 'block is-half' : 'block';
  switch (part.kind) {
    case 'goals':
      return (
        <div className={block}>
          <h4>{part.title}</h4>
          {part.intro && <Markdown source={part.intro} />}
          <div className="goals">
            <div className="goal-card goal-yes">
              <h5>
                <CheckIcon size={14} /> Goals
              </h5>
              {part.goals ? (
                <Markdown source={part.goals} />
              ) : (
                <p className="muted">None listed.</p>
              )}
            </div>
            <div className="goal-card goal-no">
              <h5>
                <CloseIcon size={14} /> Non-goals
              </h5>
              {part.nonGoals ? (
                <Markdown source={part.nonGoals} />
              ) : (
                <p className="muted">None listed.</p>
              )}
            </div>
          </div>
        </div>
      );
    case 'decisions':
      return (
        <div className={block}>
          <h4>{part.title}</h4>
          {part.intro && <Markdown source={part.intro} />}
          <ol
            className={
              part.decisions.every((d) => isCompact(`${d.body}\n${d.alternatives ?? ''}`, 480))
                ? 'decisions is-compact'
                : 'decisions'
            }
          >
            {part.decisions.map((decision, index) => (
              <li key={decision.title} className="decision">
                <h5>
                  <span className="decision-number">{index + 1}</span>
                  {decision.title}
                </h5>
                <Markdown source={decision.body} />
                {decision.alternatives && (
                  <details className="fold">
                    <summary>
                      <ChevronIcon className="chev" />
                      Alternatives considered
                    </summary>
                    <Markdown source={decision.alternatives} />
                  </details>
                )}
              </li>
            ))}
          </ol>
        </div>
      );
    case 'risks':
      return (
        <div className={block}>
          <h4>{part.title}</h4>
          {part.intro && <Markdown source={part.intro} />}
          <ul className="risks">
            {part.risks.map((risk) => (
              <li key={risk.risk} className={risk.mitigation ? 'risk' : 'risk is-open'}>
                <div className="risk-side">
                  <span className={`tag tag-${risk.kind === 'risk' ? 'removed' : 'changed'}`}>
                    {risk.kind === 'risk' ? 'Risk' : 'Trade-off'}
                  </span>
                  <Markdown source={risk.risk} />
                </div>
                <ArrowIcon className="risk-arrow" />
                <div className="risk-side">
                  {risk.mitigation ? (
                    <>
                      <span className="tag tag-added">Mitigation</span>
                      <Markdown source={risk.mitigation} />
                    </>
                  ) : (
                    <span className="muted">No mitigation given.</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {part.outro && <Markdown source={part.outro} />}
        </div>
      );
    case 'open-questions':
      if (part.count === 0) {
        return (
          <div className={block}>
            <h4>{part.title}</h4>
            <p className="muted">None.</p>
          </div>
        );
      }
      return (
        <Callout
          className={half ? 'is-half' : undefined}
          tone="attention"
          icon={<QuestionIcon />}
          title={`Needs your answer: ${plural(part.count, 'open question')}`}
        >
          <Markdown source={part.body} />
        </Callout>
      );
    default:
      return (
        <div className={block}>
          <h4>{part.title}</h4>
          {part.body.trim() ? <Markdown source={part.body} /> : <p className="muted">Empty.</p>}
        </div>
      );
  }
}

/** Half a wide window is still a comfortable column for prose, however long it is. */
const LONG = 20_000;

/**
 * Whether a section may sit beside another on a wide window. Decisions and
 * risks always take the full width; so does anything holding a table or code.
 */
function sharesRow(part: DesignPart): boolean {
  switch (part.kind) {
    case 'decisions':
    case 'risks':
      return false;
    case 'goals':
      return isCompact(`${part.intro}\n${part.goals}\n${part.nonGoals}`, LONG);
    default:
      return isCompact(part.body, LONG);
  }
}

/** design.md: goals beside non-goals, decisions as cards, risks against mitigations. */
export function DesignSection({ change, doc }: { change: ChangeView; doc: DocView<DesignDoc> }) {
  const options = useMarkdownOptions(doc.path, { pathChips: true });
  const design = doc.doc;
  const halves = pairHalves(design.sections.map(sharesRow));

  return (
    <Section
      id={doc.id}
      title="Design"
      icon={<PencilIcon />}
      hash={doc.hash}
      meta={
        design.openQuestions > 0 && (
          <span className="tag tag-changed">{plural(design.openQuestions, 'open question')}</span>
        )
      }
    >
      <MarkdownProvider options={options}>
        <div className="doc">
          {design.preamble && <Markdown source={design.preamble} />}
          {design.sections.length === 0 && !design.preamble && <Markdown source={doc.raw} />}
          {design.sections.map((part, index) => (
            <Part key={`${part.line}:${part.title}`} part={part} half={halves[index] ?? false} />
          ))}
          {change.diagrams.length > 0 && (
            <div className="block">
              <h4>Diagrams</h4>
              <div className="diagrams">
                {change.diagrams.map((diagram) => (
                  <DiagramFigure key={diagram.path} diagram={diagram} />
                ))}
              </div>
            </div>
          )}
        </div>
      </MarkdownProvider>
    </Section>
  );
}
