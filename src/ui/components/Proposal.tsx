import { useMemo } from 'react';
import type { CapabilityRef, ChangeView, DocView, ProposalDoc } from '@/openspec';
import { usePull } from '../context';
import { BookIcon, SpecIcon } from '../icons';
import { InlineMarkdown, Markdown, MarkdownProvider } from '../markdown/Markdown';
import { useMarkdownOptions } from '../markdownOptions';
import { Section } from './common';

function CapabilityList(props: {
  title: string;
  refs: CapabilityRef[];
  targets: ReadonlyMap<string, string>;
  tone: string;
}) {
  const { goTo } = usePull();
  if (props.refs.length === 0) return null;
  return (
    <div className="cap-group">
      <h5>{props.title}</h5>
      <ul>
        {props.refs.map((ref) => {
          const target = props.targets.get(ref.name);
          return (
            <li key={ref.name}>
              {target ? (
                <button
                  type="button"
                  className={`chip chip-capability chip-${props.tone}`}
                  onClick={() => goTo(target)}
                >
                  <SpecIcon size={12} />
                  {ref.name}
                </button>
              ) : (
                <span
                  className={`chip chip-${props.tone}`}
                  title="This change has no delta spec for this capability"
                >
                  {ref.name}
                </span>
              )}
              <span className="cap-desc">
                <InlineMarkdown source={ref.description} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** proposal.md: Why, What Changes, Capabilities and Impact as distinct blocks. */
export function ProposalSection({
  change,
  doc,
}: {
  change: ChangeView;
  doc: DocView<ProposalDoc>;
}) {
  const targets = useMemo(
    () => new Map(change.capabilities.map((capability) => [capability.capability, capability.id])),
    [change.capabilities],
  );
  const options = useMarkdownOptions(doc.path, { capabilities: targets, pathChips: true });
  const proposal = doc.doc;

  return (
    <Section id={doc.id} title="Proposal" icon={<BookIcon />} hash={doc.hash}>
      <MarkdownProvider options={options}>
        {!proposal.structured ? (
          <div className="card fallback">
            <Markdown source={doc.raw} />
          </div>
        ) : (
          <div className="doc">
            {proposal.preamble && <Markdown source={proposal.preamble} />}
            {proposal.sections.map((section) => {
              const key = `${section.line}:${section.title}`;
              if (section.kind === 'capabilities') {
                return (
                  <div key={key} className="block block-capabilities">
                    <h4>{section.title}</h4>
                    <CapabilityList
                      title="New"
                      refs={proposal.newCapabilities}
                      targets={targets}
                      tone="added"
                    />
                    <CapabilityList
                      title="Modified"
                      refs={proposal.modifiedCapabilities}
                      targets={targets}
                      tone="modified"
                    />
                    {proposal.capabilitiesRest && <Markdown source={proposal.capabilitiesRest} />}
                    {proposal.newCapabilities.length + proposal.modifiedCapabilities.length === 0 &&
                      !proposal.capabilitiesRest && (
                        <p className="muted">No capabilities listed.</p>
                      )}
                  </div>
                );
              }
              return (
                <div key={key} className={`block block-${section.kind}`}>
                  <h4>{section.title}</h4>
                  {section.body.trim() ? (
                    <Markdown source={section.body} />
                  ) : (
                    <p className="muted">Empty.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </MarkdownProvider>
    </Section>
  );
}
