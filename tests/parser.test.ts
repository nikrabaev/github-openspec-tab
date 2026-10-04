import { describe, expect, it } from 'vitest';
import {
  buildCodeFenceMask,
  foldRequirementName,
  humanizeChangeName,
  normalizeRequirementName,
  parseDeltaSpec,
  parseRequirement,
  parseSpec,
  requirementProblems,
  scenarioNameFromHeaderText,
  splitArchiveName,
} from '../src/openspec';

const block = (raw: string, line = 1) => {
  const headerLine = raw.split('\n')[0] ?? '';
  return { headerLine, name: headerLine.replace(/^###\s*Requirement:\s*/i, ''), raw, line };
};

describe('code fences', () => {
  it('masks fenced lines, including the fences, and honours fence length', () => {
    const lines = ['a', '````md', '```', '### Requirement: fake', '````', 'b', '~~~', 'c', '~~~'];
    expect(buildCodeFenceMask(lines)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
    ]);
  });

  it('keeps an unterminated fence open to the end', () => {
    expect(buildCodeFenceMask(['```', 'x', 'y'])).toEqual([true, true, true]);
  });
});

describe('requirement names', () => {
  it('matches exactly: only closing hashes and outer whitespace are dropped', () => {
    expect(normalizeRequirementName('  Unlock by QR code ###  ')).toBe('Unlock by QR code');
    expect(normalizeRequirementName('C#')).toBe('C#');
    expect(normalizeRequirementName('Unlock by QR Code')).not.toBe('Unlock by QR code');
  });

  it('folds case and inner spacing only to detect near-misses', () => {
    expect(foldRequirementName('Unlock  by QR Code')).toBe(
      foldRequirementName('unlock by qr code'),
    );
  });

  it('reads scenario names without the Scenario: prefix or closing hashes', () => {
    expect(scenarioNameFromHeaderText('Scenario: Dock reserved ####')).toBe('Dock reserved');
    expect(scenarioNameFromHeaderText('Edge case')).toBe('Edge case');
  });

  it('makes change names readable', () => {
    expect(humanizeChangeName('spn-353-transport-journeys').label).toBe(
      'SPN-353 · Transport journeys',
    );
    expect(humanizeChangeName('2026-09-28-bks-131-dock-reservations')).toEqual({
      ticket: 'BKS-131',
      title: 'Dock reservations',
      label: 'BKS-131 · Dock reservations',
    });
    expect(humanizeChangeName('add-dark-mode').label).toBe('Add dark mode');
    expect(humanizeChangeName('abc-12').label).toBe('ABC-12');
    expect(splitArchiveName('2026-01-02-foo')).toEqual({ date: '2026-01-02', name: 'foo' });
  });
});

describe('parseDeltaSpec', () => {
  it('reads all four sections with line numbers', () => {
    const plan = parseDeltaSpec(
      [
        '## ADDED Requirements',
        '',
        '### Requirement: A',
        'The system SHALL a.',
        '',
        '#### Scenario: One',
        '- **WHEN** x',
        '- **THEN** y',
        '',
        '## MODIFIED Requirements',
        '### Requirement: B',
        'The system SHALL b.',
        '## REMOVED Requirements',
        '### Requirement: C',
        '**Reason**: gone',
        '- `### Requirement: D`',
        '## RENAMED Requirements',
        '- FROM: `### Requirement: E`',
        '- TO: `### Requirement: F`',
      ].join('\n'),
    );
    expect(plan.added.map((b) => [b.name, b.line])).toEqual([['A', 3]]);
    expect(plan.modified.map((b) => [b.name, b.line])).toEqual([['B', 11]]);
    expect(plan.removed).toEqual([
      { name: 'C', line: 14 },
      { name: 'D', line: 16 },
    ]);
    expect(plan.removedBlocks.map((b) => b.name)).toEqual(['C']);
    expect(plan.renamed).toEqual([{ from: 'E', to: 'F', line: 18, toLine: 19 }]);
    expect(plan.sectionPresence).toEqual({
      added: true,
      modified: true,
      removed: true,
      renamed: true,
    });
  });

  it('accepts case-insensitive and repeated section headers', () => {
    const plan = parseDeltaSpec(
      '## added requirements\n### Requirement: A\nx\n## Notes\ntext\n## ADDED Requirements\n### Requirement: B\ny',
    );
    expect(plan.added.map((b) => b.name)).toEqual(['A', 'B']);
  });

  it('ignores headers inside code fences', () => {
    const plan = parseDeltaSpec(
      '## ADDED Requirements\n### Requirement: A\ntext\n```md\n## REMOVED Requirements\n### Requirement: Fake\n```\n',
    );
    expect(plan.added.map((b) => b.name)).toEqual(['A']);
    expect(plan.added[0]?.raw).toContain('### Requirement: Fake');
    expect(plan.sectionPresence.removed).toBe(false);
  });

  it('strips a BOM and reads CRLF files', () => {
    const plan = parseDeltaSpec('﻿## ADDED Requirements\r\n### Requirement: A\r\nx\r\n');
    expect(plan.added.map((b) => b.name)).toEqual(['A']);
  });

  it('accepts every bullet marker for REMOVED and RENAMED, and a bare FROM/TO', () => {
    const plan = parseDeltaSpec(
      '## REMOVED Requirements\n* `### Requirement: A`\n+ ### Requirement: B\n## RENAMED Requirements\nFROM: ### Requirement: C\n* TO: `### Requirement: D`',
    );
    expect(plan.removed.map((r) => r.name)).toEqual(['A', 'B']);
    expect(plan.renamed.map((r) => [r.from, r.to])).toEqual([['C', 'D']]);
  });

  it('reports FROM/TO lines that never pair instead of guessing', () => {
    const plan = parseDeltaSpec(
      '## RENAMED Requirements\n- FROM: `### Requirement: A`\n- FROM: `### Requirement: B`\n- TO: `### Requirement: X`\n- TO: `### Requirement: Y`',
    );
    expect(plan.renamed.map((r) => [r.from, r.to])).toEqual([['B', 'X']]);
    expect(plan.unpairedRenames).toEqual([
      { side: 'FROM', name: 'A', line: 2 },
      { side: 'TO', name: 'Y', line: 5 },
    ]);
  });

  it('reports requirements outside delta sections and non-requirement headers inside them', () => {
    const plan = parseDeltaSpec(
      '### Requirement: Early\nx\n## Notes\n### Requirement: Stray\ny\n## ADDED Requirements\n### Documentation\n### Requirement: A\nz',
    );
    expect(plan.orphanedRequirements).toEqual([
      { name: 'Early', section: null, line: 1 },
      { name: 'Stray', section: 'Notes', line: 4 },
    ]);
    expect(plan.skippedHeaders).toEqual([
      { header: 'Documentation', section: 'ADDED Requirements', line: 7 },
    ]);
    expect(plan.added.map((b) => b.name)).toEqual(['A']);
  });
});

describe('parseRequirement', () => {
  it('splits the statement from scenarios and steps from prose', () => {
    const requirement = parseRequirement(
      block(
        [
          '### Requirement: Unlock by QR code',
          'The system SHALL unlock a docked bike.',
          '',
          'Second paragraph.',
          '',
          '#### Scenario: Successful unlock',
          'Some context first.',
          '',
          '- **GIVEN** a docked bike',
          '- **WHEN** a rider scans',
          '  the QR code',
          '- **THEN** the dock releases the bike',
          '  - within 3 seconds',
          '  - with a sound',
          '- AND a ride starts',
          '- plain bullet',
          '',
          '#### Edge case',
          '- **when** lower case keyword',
        ].join('\n'),
        7,
      ),
    );
    expect(requirement.name).toBe('Unlock by QR code');
    expect(requirement.line).toBe(7);
    expect(requirement.statement).toBe(
      'The system SHALL unlock a docked bike.\n\nSecond paragraph.',
    );
    expect(requirement.scenarios.map((s) => s.name)).toEqual(['Successful unlock', 'Edge case']);
    expect(requirement.scenarios[0]?.offset).toBe(5);
    expect(requirement.scenarios[0]?.parts).toEqual([
      { kind: 'prose', text: 'Some context first.' },
      { kind: 'step', keyword: 'GIVEN', text: 'a docked bike', extra: '' },
      { kind: 'step', keyword: 'WHEN', text: 'a rider scans the QR code', extra: '' },
      {
        kind: 'step',
        keyword: 'THEN',
        text: 'the dock releases the bike',
        extra: '- within 3 seconds\n- with a sound',
      },
      { kind: 'step', keyword: 'AND', text: 'a ride starts', extra: '' },
      { kind: 'step', keyword: null, text: 'plain bullet', extra: '' },
    ]);
    expect(requirement.scenarios[1]?.parts).toEqual([
      { kind: 'step', keyword: 'WHEN', text: 'lower case keyword', extra: '' },
    ]);
  });

  it('does not treat a #### inside a fence as a scenario', () => {
    const requirement = parseRequirement(
      block(
        '### Requirement: A\nThe system SHALL a.\n```md\n#### Scenario: fake\n```\n#### Scenario: real\n- **WHEN** x',
      ),
    );
    expect(requirement.scenarios.map((s) => s.name)).toEqual(['real']);
    expect(requirement.statement).toContain('#### Scenario: fake');
  });

  it('extracts Reason and Migration from a removal', () => {
    const requirement = parseRequirement(
      block(
        '### Requirement: PIN\n**Reason**: Keypads are retired.\nMore detail.\n**Migration:** Use the QR code.',
      ),
    );
    expect(requirement.reason).toBe('Keypads are retired.\nMore detail.');
    expect(requirement.migration).toBe('Use the QR code.');
    expect(requirement.statement).toBe('');
  });

  it('flags missing keyword, missing scenario, wrong header level and empty scenarios', () => {
    const codes = (raw: string) =>
      requirementProblems(parseRequirement(block(raw))).map((p) => p.code);
    expect(
      codes('### Requirement: A\nThe system SHALL a.\n#### Scenario: s\n- **WHEN** x'),
    ).toEqual([]);
    expect(codes('### Requirement: A\nThe app does a.\n#### Scenario: s\n- **WHEN** x')).toEqual([
      'requirement-no-keyword',
    ]);
    expect(codes('### Requirement: A\nThe system MUST a.')).toEqual(['requirement-no-scenario']);
    expect(codes('### Requirement: A\nThe system MUST a.\n#### Scenario: s\n')).toEqual([
      'requirement-no-scenario',
      'scenario-empty',
    ]);
    const wrongLevel = requirementProblems(
      parseRequirement(block('### Requirement: A\nThe system MUST a.\n##### Scenario: s\n- x')),
    );
    expect(wrongLevel[0]?.message).toContain('four hashes');
  });
});

describe('parseSpec', () => {
  const spec = [
    '# ride-unlock Specification',
    '',
    '## Purpose',
    'Why this exists.',
    '',
    '## Requirements',
    '',
    'Intro text.',
    '',
    '### Requirement: A',
    'The system SHALL a.',
    '',
    '#### Scenario: s',
    '- **WHEN** x',
    '',
    '### Requirement: B',
    'The system SHALL b.',
    '',
    '## Notes',
    '### Requirement: Outside',
  ].join('\n');

  it('reads title, purpose, preamble and requirements with their lines', () => {
    const doc = parseSpec(spec);
    expect(doc.title).toBe('ride-unlock Specification');
    expect(doc.purpose).toBe('Why this exists.');
    expect(doc.preamble).toBe('\nIntro text.');
    expect(doc.requirements.map((r) => [r.name, r.line])).toEqual([
      ['A', 10],
      ['B', 16],
    ]);
  });

  it('reports structure problems instead of throwing', () => {
    expect(parseSpec(spec).problems.map((p) => p.code)).toEqual([
      'spec-requirement-outside-section',
    ]);
    expect(parseSpec('# x\n\nno sections').problems.map((p) => p.code)).toEqual([
      'spec-no-requirements-section',
    ]);
    expect(
      parseSpec('## Requirements\n### Requirement: A\nx\n### Requirement: A\ny').problems.map(
        (p) => p.code,
      ),
    ).toEqual(['spec-duplicate-requirement']);
    expect(
      parseSpec('## Requirements\n### Requirement: A\nx\n## ADDED Requirements\n').problems.map(
        (p) => p.code,
      ),
    ).toEqual(['spec-delta-header']);
  });
});
