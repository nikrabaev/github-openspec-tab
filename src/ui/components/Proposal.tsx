import { useMemo } from 'react';
import {
  type CapabilityRef,
  type CapabilityView,
  type ChangeView,
  type DocView,
  humanizeCapability,
  type ProposalDoc,
  type ProposalSection as ProposalPart,
} from '@/openspec';
import { usePull } from '../context';
import { BookIcon } from '../icons';
import { InlineMarkdown, Markdown, MarkdownProvider } from '../markdown/Markdown';
import { useMarkdownOptions } from '../markdownOptions';
import { CountChips, DocRows, isCompact, layoutRows, proseWeight, Section } from './common';

/**
 * The capabilities a proposal lists, one row each: the name as the spec section
 * shows it, whether it is new, what the delta does to it, and the description
 * underneath at the full width of the row.
 */
function CapabilityList(props: {
  added: CapabilityRef[];
  modified: CapabilityRef[];
  views: ReadonlyMap<string, CapabilityView>;
}) {
  const { goTo } = usePull();
  const rows = [
    ...props.added.map((ref) => ({ ref, isNew: true })),
    ...props.modified.map((ref) => ({ ref, isNew: false })),
  ];
  return (
    <ul className="cap-list">
      {rows.map(({ ref, isNew }) => {
        const view = props.views.get(ref.name);
        return (
          <li key={`${isNew}:${ref.name}`} className="cap-row">
            <div className="cap-head">
              {view ? (
                <button type="button" className="cap-name" onClick={() => goTo(view.id)}>
                  {view.label}
                </button>
              ) : (
                <span
                  className="cap-name"
                  title="This change has no delta spec for this capability"
                >
                  {humanizeCapability(ref.name)}
                </span>
              )}
              <code className="cap-id">{ref.name}</code>
              <span className={isNew ? 'tag tag-added' : 'tag tag-changed'}>
                {isNew ? 'New' : 'Modified'}
              </span>
              <span className="grow" />
              {view && <CountChips counts={view.counts} />}
            </div>
            {ref.description && (
              <p className="cap-text">
                <InlineMarkdown source={ref.description} />
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A part of the proposal: one of its sections, or the text before the first heading. */
type Part = ProposalPart | { kind: 'preamble'; body: string };

/** proposal.md: Why, What Changes, Capabilities and Impact as distinct blocks. */
export function ProposalSection({
  change,
  doc,
}: {
  change: ChangeView;
  doc: DocView<ProposalDoc>;
}) {
  const views = useMemo(
    () => new Map(change.capabilities.map((capability) => [capability.capability, capability])),
    [change.capabilities],
  );
  const targets = useMemo(
    () => new Map([...views].map(([name, capability]) => [name, capability.id])),
    [views],
  );
  const options = useMarkdownOptions(doc.path, { capabilities: targets, pathChips: true });
  const proposal = doc.doc;
  // On a wide window the parts fill two columns, unless one holds a table or code and needs
  // the room. The text before the first heading is the first part.
  const parts: Part[] = proposal.preamble
    ? [{ kind: 'preamble', body: proposal.preamble }, ...proposal.sections]
    : proposal.sections;
  const listed = proposal.newCapabilities.length + proposal.modifiedCapabilities.length;
  const rows = layoutRows(
    parts,
    (part) => isCompact(part.body, 20_000),
    // Each capability is a row with a heading line of its own, on top of its text.
    (part) => proseWeight(part.body) + (part.kind === 'capabilities' ? 150 * listed : 0),
  );

  const renderSection = (section: Part) => {
    if (section.kind === 'preamble') return <Markdown key="preamble" source={section.body} />;
    const key = `${section.line}:${section.title}`;
    if (section.kind === 'capabilities') {
      return (
        <div key={key} className="block block-capabilities">
          <h4>{section.title}</h4>
          {listed > 0 && (
            <CapabilityList
              added={proposal.newCapabilities}
              modified={proposal.modifiedCapabilities}
              views={views}
            />
          )}
          {proposal.capabilitiesRest && <Markdown source={proposal.capabilitiesRest} />}
          {listed === 0 && !proposal.capabilitiesRest && (
            <p className="muted">No capabilities listed.</p>
          )}
        </div>
      );
    }
    return (
      <div key={key} className={`block block-${section.kind}`}>
        <h4>{section.title}</h4>
        {section.body.trim() ? <Markdown source={section.body} /> : <p className="muted">Empty.</p>}
      </div>
    );
  };

  return (
    <Section id={doc.id} title="Proposal" icon={<BookIcon />} hash={doc.hash}>
      <MarkdownProvider options={options}>
        {!proposal.structured ? (
          <div className="card fallback">
            <Markdown source={doc.raw} />
          </div>
        ) : (
          <div className="doc">
            <DocRows rows={rows} render={renderSection} />
          </div>
        )}
      </MarkdownProvider>
    </Section>
  );
}
