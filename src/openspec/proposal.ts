import { firstParagraph, splitTopLevelList } from './lists';
import { splitSections, stripHtmlComments } from './text';

export interface CapabilityRef {
  /** Capability path as written, e.g. `ride-unlock`. */
  name: string;
  /** Inline Markdown describing what changes. */
  description: string;
}

export interface ProposalSection {
  title: string;
  body: string;
  kind: 'why' | 'what-changes' | 'capabilities' | 'impact' | 'other';
  line: number;
}

export interface ProposalDoc {
  title: string | null;
  /** Sections in document order. Unknown ones are kept and rendered as Markdown. */
  sections: ProposalSection[];
  /** First paragraph of "Why": the lead of the overview card. */
  lead: string;
  newCapabilities: CapabilityRef[];
  modifiedCapabilities: CapabilityRef[];
  /** Capabilities Markdown that did not parse into the two lists. */
  capabilitiesRest: string;
  /** Number of items marked **BREAKING**. */
  breaking: number;
  /** Content above the first section, when there is any. */
  preamble: string;
  /** False when none of the standard sections were found: render the file as plain Markdown. */
  structured: boolean;
}

const KINDS: Array<[RegExp, ProposalSection['kind']]> = [
  [/^why\b/i, 'why'],
  [/^what(?:'s)?\s+chang/i, 'what-changes'],
  [/^capabilit/i, 'capabilities'],
  [/^impact\b/i, 'impact'],
];

function parseCapabilityList(markdown: string): { refs: CapabilityRef[]; rest: string } {
  const list = splitTopLevelList(markdown);
  const refs: CapabilityRef[] = [];
  const rest: string[] = [list.before];
  for (const item of list.items) {
    const match = /^`([^`]+)`\s*(?:[:–—-]\s*)?([\s\S]*)$/.exec(item);
    const name = match?.[1]?.trim();
    // Template placeholders such as `<capability-path>` are not capabilities.
    if (name && !/[<>]/.test(name)) {
      refs.push({ name, description: (match?.[2] ?? '').trim() });
    } else if (item && !/^(none|n\/a|-)\.?$/i.test(item.trim()) && !/[<>]/.test(item)) {
      rest.push(`- ${item}`);
    }
  }
  rest.push(list.after);
  return { refs, rest: rest.filter(Boolean).join('\n\n') };
}

/** Read `proposal.md`: Why, What Changes, Capabilities, Impact. Never throws. */
export function parseProposal(content: string): ProposalDoc {
  const clean = stripHtmlComments(content);
  const title = /^#\s+(.+)$/m.exec(clean)?.[1]?.trim() ?? null;
  const { preamble, sections: raw } = splitSections(clean, 2);
  const sections: ProposalSection[] = raw.map((section) => ({
    title: section.title,
    body: section.body,
    kind: KINDS.find(([pattern]) => pattern.test(section.title))?.[1] ?? 'other',
    line: section.line,
  }));

  const why = sections.find((section) => section.kind === 'why');
  const capabilities = sections.find((section) => section.kind === 'capabilities');
  let newCapabilities: CapabilityRef[] = [];
  let modifiedCapabilities: CapabilityRef[] = [];
  const rest: string[] = [];
  if (capabilities) {
    const sub = splitSections(capabilities.body, 3);
    if (sub.sections.length === 0) {
      const parsed = parseCapabilityList(capabilities.body);
      modifiedCapabilities = parsed.refs;
      rest.push(parsed.rest);
    } else {
      if (sub.preamble) rest.push(sub.preamble);
      for (const section of sub.sections) {
        const parsed = parseCapabilityList(section.body);
        if (/^new\b/i.test(section.title)) newCapabilities = parsed.refs;
        else if (/^modif/i.test(section.title)) modifiedCapabilities = parsed.refs;
        else rest.push(`### ${section.title}\n\n${section.body}`);
        if (parsed.rest && /^(new|modif)/i.test(section.title)) rest.push(parsed.rest);
      }
    }
  }

  const whatChanges = sections.find((section) => section.kind === 'what-changes');
  return {
    title,
    sections,
    lead: why ? firstParagraph(why.body) : '',
    newCapabilities,
    modifiedCapabilities,
    capabilitiesRest: rest.filter(Boolean).join('\n\n'),
    breaking: (whatChanges?.body.match(/\*\*BREAKING\*\*/g) ?? []).length,
    preamble: preamble.replace(/^#\s+.+$/m, '').trim(),
    structured: sections.some((section) => section.kind !== 'other'),
  };
}
