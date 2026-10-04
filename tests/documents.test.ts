import { describe, expect, it } from 'vitest';
import {
  buildGlossaryIndex,
  parseDesign,
  parseGlossary,
  parseProposal,
  parseTasks,
  splitTopLevelList,
} from '../src/openspec';
import { FIXTURES, readTree } from './helpers/fixtures';

const head = readTree(`${FIXTURES}/showcase/head`);
const base = readTree(`${FIXTURES}/showcase/base`);
const CHANGE = 'openspec/changes/bks-142-group-rides';

describe('parseTasks', () => {
  it('reads numbered groups, progress and the next unchecked task', () => {
    const tasks = parseTasks(head[`${CHANGE}/tasks.md`] ?? '');
    expect(tasks.groups.map((g) => [g.number, g.title, g.done, g.total])).toEqual([
      ['1', 'Data model', 3, 3],
      ['2', 'Unlock service', 1, 4],
      ['3', 'Billing', 0, 2],
      ['4', 'Rider app', 0, 3],
    ]);
    expect([tasks.done, tasks.total]).toEqual([4, 12]);
    expect(tasks.next).toMatchObject({
      number: '2.2',
      text: 'Enforce the same-station rule',
      done: false,
    });
  });

  it('counts any list marker, nested tasks and unknown markers as not done; skips link bullets', () => {
    const tasks = parseTasks(
      [
        '- [x] done',
        '* [ ] star',
        '  - [ ] 1.2.1 nested',
        '1. [X] ordered',
        '- [~] in progress',
        '- [] empty box',
        '- [A](https://example.com) a link, not a task',
        '- [WIP] multi-character, not a task',
      ].join('\n'),
    );
    expect([tasks.done, tasks.total]).toEqual([2, 6]);
    expect(tasks.groups[0]?.tasks[2]).toMatchObject({ depth: 1, number: '1.2.1', text: 'nested' });
    expect(tasks.groups[0]?.title).toBe('');
  });

  it('reports no next task when everything is done', () => {
    expect(parseTasks('## 1. A\n- [x] 1.1 a').next).toBeNull();
  });
});

describe('parseProposal', () => {
  const proposal = parseProposal(head[`${CHANGE}/proposal.md`] ?? '');

  it('splits the standard sections and takes the lead from Why', () => {
    expect(proposal.structured).toBe(true);
    expect(proposal.sections.map((s) => s.kind)).toEqual([
      'why',
      'what-changes',
      'capabilities',
      'impact',
    ]);
    expect(proposal.lead).toMatch(/^Families and visitors ride together/);
    expect(proposal.lead).toMatch(/walk away\.$/);
  });

  it('reads capability lists and counts BREAKING items', () => {
    expect(proposal.newCapabilities.map((c) => c.name)).toEqual(['group-rides']);
    expect(proposal.modifiedCapabilities.map((c) => c.name)).toEqual([
      'ride-unlock',
      'ride-billing',
    ]);
    expect(proposal.modifiedCapabilities[0]?.description).toMatch(/^a group ride leader/);
    expect(proposal.breaking).toBe(1);
  });

  it('drops template comments and placeholder capabilities', () => {
    const doc = parseProposal(
      '## Why\n<!-- explain -->\nBecause.\n## Capabilities\n### New Capabilities\n- `<capability-path>`: <brief>\n### Modified Capabilities\n- `billing/refunds` - refunds change\n',
    );
    expect(doc.lead).toBe('Because.');
    expect(doc.newCapabilities).toEqual([]);
    expect(doc.modifiedCapabilities).toEqual([
      { name: 'billing/refunds', description: 'refunds change' },
    ]);
  });

  it('marks a proposal with no standard section as unstructured', () => {
    expect(parseProposal('# Notes\n\nJust some text.\n\n## Background\nMore.').structured).toBe(
      false,
    );
  });
});

describe('parseDesign', () => {
  const design = parseDesign(head[`${CHANGE}/design.md`] ?? '');
  const section = <K extends string>(kind: K) => design.sections.find((s) => s.kind === kind);

  it('types each section and keeps document order', () => {
    expect(design.sections.map((s) => s.kind)).toEqual([
      'context',
      'goals',
      'decisions',
      'risks',
      'markdown',
      'open-questions',
    ]);
    expect(design.openQuestions).toBe(2);
  });

  it('splits goals from non-goals', () => {
    const goals = section('goals');
    expect(goals?.kind === 'goals' && goals.goals.split('\n').length).toBe(3);
    expect(goals?.kind === 'goals' && goals.nonGoals).toContain('Splitting the cost');
  });

  it('reads decisions and folds their alternatives', () => {
    const decisions = section('decisions');
    if (decisions?.kind !== 'decisions') throw new Error('no decisions');
    expect(decisions.decisions.map((d) => d.title)).toEqual([
      'A group ride is a parent record over ordinary rides',
      'The leader scans each bike',
      'The server enforces the same-station rule',
    ]);
    expect(decisions.decisions[0]?.body).not.toContain('Alternatives');
    expect(decisions.decisions[0]?.alternatives).toMatch(/^- One ride with several bikes/);
    expect(decisions.decisions[2]?.alternatives).toBeNull();
  });

  it('splits risks into risk and mitigation, and recognises trade-offs', () => {
    const risks = section('risks');
    if (risks?.kind !== 'risks') throw new Error('no risks');
    expect(risks.risks.map((r) => [r.kind, Boolean(r.mitigation)])).toEqual([
      ['risk', true],
      ['risk', true],
      ['trade-off', true],
      ['risk', false],
    ]);
    expect(risks.risks[0]).toMatchObject({
      risk: 'One stolen phone can now release four bikes',
      mitigation: expect.stringMatching(/^the first group ride of an account needs a card check/),
    });
  });

  it('understands other ways of writing risks', () => {
    const doc = parseDesign(
      '## Risks\n- **Risk**: slow docks -> **Mitigation**: retry once\n- Data loss. Mitigation: nightly backups\n',
    );
    const risks = doc.sections[0];
    if (risks?.kind !== 'risks') throw new Error('no risks');
    expect(risks.risks).toEqual([
      { kind: 'risk', risk: 'slow docks', mitigation: 'retry once' },
      { kind: 'risk', risk: 'Data loss.', mitigation: 'nightly backups' },
    ]);
  });

  it('falls back to plain Markdown for sections it cannot structure', () => {
    const doc = parseDesign(
      '## Decisions\nWe decided to keep it simple.\n\n## Goals / Non-Goals\nNo labels here.',
    );
    expect(doc.sections.map((s) => s.kind)).toEqual(['markdown', 'markdown']);
  });
});

describe('glossary', () => {
  const terms = parseGlossary(base['docs/CONTEXT.md'] ?? '');

  it('works out the term format from the file', () => {
    expect(terms.map((t) => t.term)).toEqual([
      'Rider',
      'Dock',
      'Station',
      'Ride',
      'Pass',
      'Group ride',
      'Leader',
      'Hold',
      'Daily cap',
    ]);
    expect(terms[0]).toEqual({
      term: 'Rider',
      definition: 'A person with an account who takes out a bike.',
      avoid: ['User', 'customer', 'cyclist'],
    });
  });

  it('reads inline definitions, tables and heading-defined terms too', () => {
    expect(
      parseGlossary('- **Hold** — a bike kept for a rider\n- **Dock**: a locking point'),
    ).toEqual([
      { term: 'Hold', definition: 'a bike kept for a rider', avoid: [] },
      { term: 'Dock', definition: 'a locking point', avoid: [] },
    ]);
    expect(
      parseGlossary('| Term | Meaning |\n| --- | --- |\n| Pass | Lets a rider unlock |'),
    ).toEqual([{ term: 'Pass', definition: 'Lets a rider unlock', avoid: [] }]);
    expect(
      parseGlossary(
        '## Glossary\n\n### Station\nA group of docks.\n\n## Other\n\n### Not a term\nText.',
      ),
    ).toEqual([{ term: 'Station', definition: 'A group of docks.', avoid: [] }]);
    expect(parseGlossary('# Readme\n\nJust prose with **bold** words in it.')).toEqual([]);
  });

  it('finds whole-word terms, longest first, with plurals and avoided words', () => {
    const index = buildGlossaryIndex(terms);
    const found = index
      .find('A group ride leader pays; riders override nothing. The customer booked a Reservation.')
      .map((m) => [m.term.term, m.avoided]);
    expect(found).toEqual([
      ['Group ride', false],
      ['Leader', false],
      ['Rider', false],
      ['Rider', true],
      ['Hold', true],
    ]);
  });
});

describe('splitTopLevelList', () => {
  it('keeps nested bullets and continuation lines with their item', () => {
    expect(splitTopLevelList('Intro\n\n- one\n  more\n  - nested\n- two\n\nAfter')).toEqual({
      before: 'Intro',
      items: ['one\nmore\n- nested', 'two'],
      after: 'After',
    });
  });
});
