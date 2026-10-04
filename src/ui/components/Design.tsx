import type { ReactNode } from 'react';
import type {
  ChangeView,
  Decision,
  DesignDoc,
  DesignSection as DesignPart,
  DocView,
} from '@/openspec';
import { ArrowIcon, CheckIcon, ChevronIcon, CloseIcon, PencilIcon, QuestionIcon } from '../icons';
import { Markdown, MarkdownProvider } from '../markdown/Markdown';
import { useMarkdownOptions } from '../markdownOptions';
import {
  Callout,
  DocRows,
  isCompact,
  layoutRows,
  pairHalves,
  plural,
  proseWeight,
  Section,
} from './common';
import { DiagramFigure } from './Diagram';
import { BlockComment, BlockDiscussion, BlockHead } from './Discussion';

/** Half a wide window is still a comfortable column for prose, however long it is. */
const LONG = 20_000;

/** The text before the first heading, laid out like a section. */
interface Preamble {
  kind: 'preamble';
  body: string;
}

/** A decision's text and its alternatives, as one piece of Markdown to measure. */
const decisionText = (decision: Decision) => `${decision.body}\n${decision.alternatives ?? ''}`;

/**
 * Decisions as cards, the title above the text. On a wide window short ones sit
 * several to a row and long ones two to a row; a decision with a table or code
 * keeps the full width.
 */
function Decisions({ decisions }: { decisions: Decision[] }) {
  const compact = decisions.every((decision) => isCompact(decisionText(decision), 480));
  const halves = pairHalves(decisions.map((decision) => isCompact(decisionText(decision), LONG)));
  return (
    <ol className={compact ? 'decisions is-compact' : 'decisions'}>
      {decisions.map((decision, index) => (
        <li
          key={decision.title}
          className={!compact && halves[index] ? 'decision is-half' : 'decision'}
        >
          <h5>
            <span className="decision-number">{index + 1}</span>
            <span className="grow">{decision.title}</span>
            <BlockComment
              line={decision.line}
              subject={`Decision ${index + 1}: ${decision.title}`}
            />
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
          <BlockDiscussion line={decision.line} />
        </li>
      ))}
    </ol>
  );
}

/** A titled block of the design, with the button to comment on it and the threads left on it. */
function Block({ part, children }: { part: DesignPart; children: ReactNode }) {
  return (
    <div className="block">
      <BlockHead title={part.title} line={part.line} subject={`Design: ${part.title}`} />
      {children}
      <BlockDiscussion line={part.line} />
    </div>
  );
}

function Part({ part }: { part: DesignPart | Preamble }) {
  switch (part.kind) {
    case 'preamble':
      return <Markdown source={part.body} />;
    case 'goals':
      return (
        <Block part={part}>
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
        </Block>
      );
    case 'decisions':
      return (
        <Block part={part}>
          {part.intro && <Markdown source={part.intro} />}
          <Decisions decisions={part.decisions} />
        </Block>
      );
    case 'risks':
      return (
        <Block part={part}>
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
        </Block>
      );
    case 'open-questions':
      if (part.count === 0) {
        return (
          <Block part={part}>
            <p className="muted">None.</p>
          </Block>
        );
      }
      return (
        <Callout
          tone="attention"
          icon={<QuestionIcon />}
          title={
            <>
              Needs your answer: {plural(part.count, 'open question')}
              <BlockComment line={part.line} subject={`Design: ${part.title}`} />
            </>
          }
        >
          <Markdown source={part.body} />
          <BlockDiscussion line={part.line} />
        </Callout>
      );
    default:
      return (
        <Block part={part}>
          {part.body.trim() ? <Markdown source={part.body} /> : <p className="muted">Empty.</p>}
        </Block>
      );
  }
}

/**
 * Whether a section may sit beside another on a wide window. Decisions and
 * risks always take the full width; so does anything holding a table or code.
 */
function sharesRow(part: DesignPart | Preamble): boolean {
  switch (part.kind) {
    case 'decisions':
    case 'risks':
      return false;
    default:
      return isCompact(partText(part), LONG);
  }
}

/** The Markdown a section is made of, to measure it. */
function partText(part: DesignPart | Preamble): string {
  switch (part.kind) {
    case 'decisions':
    case 'risks':
      return part.intro;
    case 'goals':
      return `${part.intro}\n${part.goals}\n${part.nonGoals}`;
    default:
      return part.body;
  }
}

/** design.md: goals beside non-goals, decisions as cards, risks against mitigations. */
export function DesignSection({ change, doc }: { change: ChangeView; doc: DocView<DesignDoc> }) {
  const options = useMarkdownOptions(doc.path, { pathChips: true });
  const design = doc.doc;
  const parts: Array<DesignPart | Preamble> = design.preamble
    ? [{ kind: 'preamble', body: design.preamble }, ...design.sections]
    : design.sections;
  const rows = layoutRows(
    parts,
    sharesRow,
    // Goals and non-goals are two cards, which stand taller than their text alone.
    (part) => proseWeight(partText(part)) + (part.kind === 'goals' ? 500 : 0),
  );

  return (
    <Section
      id={doc.id}
      title="Design"
      icon={<PencilIcon />}
      hash={doc.hash}
      doc={{ path: doc.path, subject: 'Design' }}
      meta={
        design.openQuestions > 0 && (
          <span className="tag tag-changed">{plural(design.openQuestions, 'open question')}</span>
        )
      }
    >
      <MarkdownProvider options={options}>
        <div className="doc">
          {parts.length === 0 && <Markdown source={doc.raw} />}
          <DocRows
            rows={rows}
            render={(part) => (
              <Part
                key={part.kind === 'preamble' ? 'preamble' : `${part.line}:${part.title}`}
                part={part}
              />
            )}
          />
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
