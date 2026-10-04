import { describe, expect, it } from 'vitest';
import { applyDelta, parseDeltaSpec, parseSpec } from '../src/openspec';

const BASE = `# demo Specification

## Purpose
Demo purpose that is long enough to be a real purpose statement.

## Requirements

### Requirement: Alpha
The system SHALL alpha.

#### Scenario: One
- **WHEN** a
- **THEN** b

### Requirement: Beta
The system SHALL beta.

#### Scenario: One
- **WHEN** a

### Requirement: Gamma
The system SHALL gamma.

#### Scenario: One
- **WHEN** a
`;

const apply = (delta: string, base: string | null = BASE) =>
  applyDelta(base, parseDeltaSpec(delta), {
    specName: 'demo',
    changeName: 'my-change',
    deltaContent: delta,
  });
const names = (content: string) => parseSpec(content).requirements.map((r) => r.name);
const codes = (result: ReturnType<typeof apply>) =>
  [...result.problems, ...result.operations.flatMap((op) => op.problems)].map((p) => p.code);

describe('applyDelta', () => {
  it('applies renamed, removed, modified, added in that order and keeps the original order', () => {
    const result = apply(`## ADDED Requirements
### Requirement: Delta
The system SHALL delta.

#### Scenario: One
- **WHEN** a

## MODIFIED Requirements
### Requirement: Alpha Prime
The system SHALL alpha, faster.

#### Scenario: One
- **WHEN** a
- **THEN** b

## REMOVED Requirements
### Requirement: Beta
**Reason**: unused

## RENAMED Requirements
- FROM: \`### Requirement: Alpha\`
- TO: \`### Requirement: Alpha Prime\`
`);
    expect(codes(result)).toEqual([]);
    expect(names(result.rebuilt)).toEqual(['Alpha Prime', 'Gamma', 'Delta']);
    expect(result.counts).toEqual({ added: 1, modified: 1, removed: 1, renamed: 1 });
    expect(result.rebuilt).toContain('The system SHALL alpha, faster.');
    expect(result.rebuilt.endsWith('- **WHEN** a\n')).toBe(true);
    expect(result.rebuilt).not.toMatch(/\n{3,}/);

    const modified = result.operations.find((op) => op.op === 'modified');
    expect(modified?.before?.raw.split('\n')[0]).toBe('### Requirement: Alpha Prime');
    const renamed = result.operations.find((op) => op.op === 'renamed');
    expect(renamed?.before?.name).toBe('Alpha');
    expect(renamed?.from).toBe('Alpha');
  });

  it('builds a skeleton for a new capability and carries the delta Purpose', () => {
    const delta = `## Purpose
Lets riders do a brand new thing that did not exist before.

## ADDED Requirements
### Requirement: New
The system SHALL new.

#### Scenario: One
- **WHEN** a
`;
    const result = apply(delta, null);
    expect(result.isNewSpec).toBe(true);
    expect(result.rebuilt).toBe(`# demo Specification

## Purpose
Lets riders do a brand new thing that did not exist before.

## Requirements

### Requirement: New
The system SHALL new.

#### Scenario: One
- **WHEN** a
`);
    const withoutPurpose = apply(delta.replace(/## Purpose[\s\S]*?(?=## ADDED)/, ''), null);
    expect(withoutPurpose.rebuilt).toContain(
      'TBD - created by archiving change my-change. Update Purpose after archive.',
    );
  });

  it('only allows ADDED on a new capability', () => {
    const result = apply(
      '## MODIFIED Requirements\n### Requirement: X\nThe system SHALL x.\n## REMOVED Requirements\n### Requirement: Y\n',
      null,
    );
    expect(codes(result)).toEqual(['removed-from-new-spec', 'new-spec-not-added']);
    expect(names(result.rebuilt)).toEqual([]);
  });

  it('matches names exactly and reports near-misses with the block they almost matched', () => {
    const result = apply(`## MODIFIED Requirements
### Requirement: alpha
The system SHALL alpha.

#### Scenario: One
- **WHEN** a

### Requirement: Missing
The system SHALL x.
`);
    const [nearMiss, missing] = result.operations;
    expect(nearMiss?.problems.map((p) => p.code)).toEqual(['modified-near-miss']);
    expect(nearMiss?.before?.name).toBe('Alpha');
    expect(nearMiss?.applied).toBe(false);
    expect(missing?.problems.map((p) => p.code)).toEqual(['modified-no-match']);
    expect(missing?.before).toBeNull();
    expect(names(result.rebuilt)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('warns when a MODIFIED block drops a scenario the spec has', () => {
    const result = apply(
      '## MODIFIED Requirements\n### Requirement: Alpha\nThe system SHALL alpha.\n\n#### Scenario: Two\n- **WHEN** a\n',
    );
    expect(result.operations[0]?.problems.map((p) => p.code)).toEqual(['modified-drops-scenarios']);
    expect(result.operations[0]?.problems[0]?.message).toContain('"One"');
  });

  it('treats entries the spec already reflects as synced, not as errors', () => {
    const result = apply(`## ADDED Requirements
### Requirement: Gamma
The system SHALL gamma.

#### Scenario: One
- **WHEN** a

## REMOVED Requirements
### Requirement: Long gone

## RENAMED Requirements
- FROM: \`### Requirement: Old beta\`
- TO: \`### Requirement: Beta\`
`);
    expect(
      result.operations.map((op) => [op.op, op.alreadySynced, op.problems.map((p) => p.code)]),
    ).toEqual([
      ['renamed', true, ['already-synced']],
      ['removed', true, ['removed-not-found']],
      ['added', true, ['already-synced']],
    ]);
    expect(result.counts).toEqual({ added: 0, modified: 0, removed: 0, renamed: 0 });
  });

  it('reports conflicts between sections and duplicates within one', () => {
    const result = apply(`## ADDED Requirements
### Requirement: Beta
The system SHALL beta, differently.
### Requirement: Twice
The system SHALL x.
### Requirement: Twice
The system SHALL y.

## MODIFIED Requirements
### Requirement: Alpha
The system SHALL alpha.

#### Scenario: One
- **WHEN** a

## REMOVED Requirements
### Requirement: Alpha

## RENAMED Requirements
- FROM: \`### Requirement: Gamma\`
- TO: \`### Requirement: Twice\`
`);
    expect(new Set(codes(result))).toEqual(
      new Set([
        'duplicate-in-section',
        'cross-section-conflict',
        'added-collides-with-rename',
        'added-exists',
      ]),
    );
  });

  it('refuses a rename onto an existing name or from a missing one', () => {
    const result = apply(`## RENAMED Requirements
- FROM: \`### Requirement: Alpha\`
- TO: \`### Requirement: Beta\`
- FROM: \`### Requirement: Nope\`
- TO: \`### Requirement: Other\`
- FROM: \`### Requirement: gamma\`
- TO: \`### Requirement: Gamma two\`
`);
    expect(result.operations.map((op) => op.problems.map((p) => p.code))).toEqual([
      ['rename-target-exists'],
      ['rename-source-missing'],
      ['rename-source-missing'],
    ]);
    expect(result.operations[2]?.before?.name).toBe('Gamma');
    expect(names(result.rebuilt)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('reports a delta with sections but no entries', () => {
    expect(codes(apply('## ADDED Requirements\n\nnothing here\n'))).toEqual([
      'delta-no-operations',
    ]);
  });
});
