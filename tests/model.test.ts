import { describe, expect, it } from 'vitest';
import { buildModel, classifyPath, planLoads, snapshotFromFiles } from '../src/openspec';
import { modelOf } from './helpers/fixtures';

const spec = (...requirements: string[]) =>
  `# demo Specification\n\n## Purpose\nA demo capability used by the model tests.\n\n## Requirements\n\n${requirements.join('\n\n')}\n`;
const req = (name: string, text = `The system SHALL ${name.toLowerCase()}.`, scenario = 'Works') =>
  `### Requirement: ${name}\n${text}\n\n#### Scenario: ${scenario}\n- **WHEN** it runs\n- **THEN** it works`;
const proposal = '## Why\nBecause.\n\n## What Changes\n- Things.\n';

function model(base: Record<string, string>, head: Record<string, string>) {
  const snapshot = snapshotFromFiles(base, head);
  const plan = planLoads(snapshot.base, snapshot.head);
  return { plan, model: buildModel(plan, snapshot.blobs) };
}

describe('classifyPath', () => {
  it('recognises specs, change files and archived change files', () => {
    expect(classifyPath('src/a.ts')).toBeNull();
    expect(classifyPath('openspec/project.md')).toEqual({ kind: 'other' });
    expect(classifyPath('openspec/specs/billing/refunds/spec.md')).toEqual({
      kind: 'spec',
      capability: 'billing/refunds',
    });
    expect(classifyPath('openspec/changes/foo/specs/a/spec.md')).toMatchObject({
      kind: 'change-file',
      dir: 'openspec/changes/foo',
      archived: false,
      name: 'foo',
      role: 'delta',
      capability: 'a',
    });
    expect(classifyPath('openspec/changes/archive/2026-01-02-foo/design.md')).toMatchObject({
      dir: 'openspec/changes/archive/2026-01-02-foo',
      archived: true,
      name: 'foo',
      date: '2026-01-02',
      role: 'design',
    });
    expect(classifyPath('openspec/changes/foo/flow.excalidraw.svg')).toMatchObject({
      role: 'diagram',
    });
    expect(classifyPath('openspec/changes/README.md')).toEqual({ kind: 'other' });
  });
});

describe('planLoads', () => {
  it('ignores changes and specs the PR does not touch, and asks only for what it needs', () => {
    const { plan } = modelOf('showcase');
    expect(plan.changes.map((c) => [c.dirName, c.status, c.isNew])).toEqual([
      ['2026-09-28-bks-131-dock-reservations', 'archived', false],
      ['bks-142-group-rides', 'in-progress', true],
    ]);
    expect(plan.capabilities.map((c) => c.capability)).toEqual([
      'dock-availability',
      'group-rides',
      'ride-billing',
      'ride-unlock',
      'rider-notifications',
    ]);
    expect(plan.otherFiles).toEqual([{ path: 'openspec/project.md', status: 'modified' }]);
    const paths = plan.loads.map((load) => load.path);
    expect(paths.some((path) => path.includes('bks-101'))).toBe(false);
    expect(paths.some((path) => path.endsWith('.svg'))).toBe(false);
  });

  it('does no work for a PR without OpenSpec files', () => {
    const { plan, model } = modelOf('empty');
    expect(plan.loads).toEqual([]);
    expect(model.isEmpty).toBe(true);
    expect(model.requirementChanges).toBe(0);
  });
});

describe('buildModel: showcase PR', () => {
  const { model } = modelOf('showcase');
  const archived = model.changes[0];
  const live = model.changes[1];

  it('totals requirement changes across changes and direct edits', () => {
    expect(model.counts).toEqual({ added: 7, modified: 5, removed: 1, renamed: 1 });
    expect(model.requirementChanges).toBe(14);
    expect(model.capabilitiesTouched).toBe(5);
  });

  it('describes a change in progress: after = base spec with the deltas applied', () => {
    expect(live).toMatchObject({ status: 'in-progress', isNew: true });
    expect(live?.label.label).toBe('BKS-142 · Group rides');
    expect(live?.counts).toEqual({ added: 5, modified: 3, removed: 1, renamed: 1 });
    expect(live?.tasks?.doc).toMatchObject({ done: 4, total: 12 });
    expect(live?.diagrams.map((d) => d.name)).toEqual(['group-unlock-flow']);

    const unlock = live?.capabilities.find((c) => c.capability === 'ride-unlock');
    expect(unlock?.changes.map((c) => [c.op, c.name, c.previousName])).toEqual([
      ['modified', 'Unlock by QR code', null],
      ['modified', 'Unlock failure feedback', null],
      ['added', 'Group bikes come from one station', null],
      ['removed', 'Unlock with a station PIN', null],
      ['renamed', 'Bike hold', 'Reservation hold'],
    ]);
    expect(unlock?.unchanged.map((r) => r.name)).toEqual([
      'Unlock audit trail',
      'Low battery lockout',
    ]);

    const removed = unlock?.changes[3];
    expect(removed?.before?.statement).toContain('6-digit PIN');
    expect(removed?.reason).toMatch(/^Station keypads are being retired/);
    expect(removed?.migration).toMatch(/^Riders unlock with the QR code/);

    const modified = unlock?.changes[0];
    expect(modified?.before?.scenarios).toHaveLength(2);
    expect(modified?.after?.scenarios).toHaveLength(3);
    expect(modified?.source).toMatchObject({ side: 'R', inDiff: true, line: 3 });
  });

  it('marks a capability with no base spec as new and carries its Purpose', () => {
    const groupRides = live?.capabilities.find((c) => c.capability === 'group-rides');
    expect(groupRides?.isNew).toBe(true);
    expect(groupRides?.purpose).toMatch(/^Lets one rider take out several bikes/);
    expect(groupRides?.changes.every((c) => c.op === 'added')).toBe(true);
  });

  it('describes a change archived in the PR: before = base spec, comment link on the main spec', () => {
    expect(archived).toMatchObject({ status: 'archived', isNew: false, date: '2026-09-28' });
    expect(archived?.tasks).toMatchObject({ doneAtBase: 4, status: 'modified' });
    expect(archived?.proposal?.status).toBe('unchanged');
    const [added, modified] = archived?.capabilities[0]?.changes ?? [];
    expect(added).toMatchObject({ op: 'added', name: 'Reserve a dock' });
    expect(modified).toMatchObject({ op: 'modified', name: 'Free dock count' });
    expect(modified?.before?.statement).toContain('60 seconds');
    expect(modified?.after?.statement).toContain('30 seconds');
    // The changed line of the merged spec, not the unchanged header.
    expect(modified?.source).toEqual({
      path: 'openspec/specs/dock-availability/spec.md',
      line: 9,
      side: 'R',
      inDiff: true,
    });
  });

  it('reports specs edited directly, without what the archived change explains', () => {
    expect(model.directEdits.map((e) => e.capability)).toEqual(['rider-notifications']);
    const [edit] = model.directEdits;
    expect(edit?.deltaPath).toBeNull();
    expect(edit?.changes.map((c) => [c.op, c.name])).toEqual([
      ['modified', 'Ride receipt'],
      ['added', 'Overdue bike warning'],
    ]);
    expect(edit?.unchanged.map((r) => r.name)).toEqual(['Pass expiry reminder']);
  });

  it('gives every card a stable, unique id and a content hash', () => {
    const ids = [...model.changes.flatMap((c) => c.capabilities), ...model.directEdits].flatMap(
      (c) => c.changes.map((entry) => entry.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('c/bks-142-group-rides/spec/ride-unlock/unlock-by-qr-code');
    expect(ids).toContain('specs/rider-notifications/ride-receipt');
    const again = modelOf('showcase').model;
    expect(again.changes[1]?.capabilities[0]?.changes[0]?.hash).toBe(
      live?.capabilities[0]?.changes[0]?.hash,
    );
  });
});

describe('buildModel: format problems', () => {
  const { model } = modelOf('problems');
  const [change] = model.changes;
  const unlock = change?.capabilities.find((c) => c.capability === 'ride-unlock');
  const codesOf = (name: string) =>
    unlock?.changes.find((c) => c.name === name)?.problems.map((p) => p.code);

  it('never throws and attaches each problem to the card it concerns', () => {
    expect(codesOf('Unlock by QR Code')).toEqual(['modified-near-miss']);
    expect(codesOf('Unlock retry policy')).toEqual(['modified-no-match']);
    expect(codesOf('Unlock failure feedback')).toEqual(['modified-drops-scenarios']);
    expect(codesOf('Unlock rate limit')).toEqual([
      'requirement-no-keyword',
      'requirement-no-scenario',
    ]);
    expect(codesOf('Unlock audit trail')).toEqual(['added-exists']);
    expect(codesOf('Unlock with a keypad')).toEqual(['removed-not-found', 'removed-no-reason']);
    expect(unlock?.problems.map((p) => p.code)).toEqual([
      'rename-unpaired',
      'requirement-orphaned',
      'header-skipped',
    ]);
    expect(change?.problemCount).toBe(10);
  });

  it('still shows the diff for a near-miss, against the block it almost matched', () => {
    const nearMiss = unlock?.changes.find((c) => c.name === 'Unlock by QR Code');
    expect(nearMiss?.before?.name).toBe('Unlock by QR code');
  });

  it('falls back to plain Markdown for files it cannot read as OpenSpec', () => {
    const history = change?.capabilities.find((c) => c.capability === 'ride-history');
    expect(history?.fallbackMarkdown).toContain('### Past rides list');
    expect(history?.changes).toEqual([]);
    expect(change?.proposal?.doc.structured).toBe(false);
  });
});

describe('buildModel: other shapes of PR', () => {
  it('shows a spec edited directly, with renames detected by identical body', () => {
    const { model: m } = model(
      { 'openspec/specs/demo/spec.md': spec(req('Alpha'), req('Beta'), req('Gamma')) },
      {
        'openspec/specs/demo/spec.md': spec(
          req('Alpha', 'The system MUST alpha, now.'),
          req('Beta renamed', 'The system SHALL beta.'),
          req(
            'Delta',
            'The service MUST refuse every request that arrives without a token.',
            'Refused',
          ),
          req('Gamma revised', 'The system SHALL gamma, twice.'),
        ),
      },
    );
    expect(m.changes).toEqual([]);
    expect(m.directEdits[0]?.changes.map((c) => [c.op, c.name, c.previousName])).toEqual([
      ['modified', 'Alpha', null],
      ['renamed', 'Beta renamed', 'Beta'],
      ['added', 'Delta', null],
      ['modified', 'Gamma revised', 'Gamma'],
    ]);
    expect(m.directEdits[0]?.changes[0]?.source).toMatchObject({ side: 'R', inDiff: true });

    const removal = model(
      { 'openspec/specs/demo/spec.md': spec(req('Alpha'), req('Beta')) },
      { 'openspec/specs/demo/spec.md': spec(req('Alpha')) },
    ).model.directEdits[0]?.changes[0];
    expect(removal).toMatchObject({
      op: 'removed',
      name: 'Beta',
      source: { side: 'L', inDiff: true },
    });
  });

  it('applies several archived changes in date order, each on top of the previous', () => {
    const delta = (body: string) => `## ${body}`;
    const { model: m } = model(
      { 'openspec/specs/demo/spec.md': spec(req('Alpha')) },
      {
        'openspec/specs/demo/spec.md': spec(
          req('Alpha', 'The system SHALL alpha, twice revised.'),
          req('Beta'),
        ),
        'openspec/changes/archive/2026-03-01-first/proposal.md': proposal,
        'openspec/changes/archive/2026-03-01-first/specs/demo/spec.md': delta(
          `ADDED Requirements\n\n${req('Beta')}\n\n## MODIFIED Requirements\n\n${req('Alpha', 'The system SHALL alpha, revised.')}`,
        ),
        'openspec/changes/archive/2026-03-02-second/proposal.md': proposal,
        'openspec/changes/archive/2026-03-02-second/specs/demo/spec.md': delta(
          `MODIFIED Requirements\n\n${req('Alpha', 'The system SHALL alpha, twice revised.')}`,
        ),
      },
    );
    expect(m.changes.map((c) => c.name)).toEqual(['first', 'second']);
    const second = m.changes[1]?.capabilities[0]?.changes[0];
    expect(second?.before?.statement).toBe('The system SHALL alpha, revised.');
    expect(second?.problems).toEqual([]);
    expect(m.directEdits).toEqual([]);
  });

  it('does not report an in-progress change twice when the PR also syncs the main spec', () => {
    const changed = req('Alpha', 'The system SHALL alpha, revised.');
    const { model: m } = model(
      { 'openspec/specs/demo/spec.md': spec(req('Alpha')) },
      {
        'openspec/specs/demo/spec.md': spec(changed),
        'openspec/changes/sync-early/proposal.md': proposal,
        'openspec/changes/sync-early/specs/demo/spec.md': `## MODIFIED Requirements\n\n${changed}\n`,
      },
    );
    expect(m.directEdits).toEqual([]);
    const entry = m.changes[0]?.capabilities[0]?.changes[0];
    expect(entry?.before?.statement).toBe('The system SHALL alpha.');
    expect(entry?.problems.map((p) => p.code)).toEqual(['synced-to-spec']);
    expect(m.requirementChanges).toBe(1);
  });

  it('recognises a change deleted without archiving and an edit to an old archive', () => {
    const files = {
      'openspec/changes/dropped/proposal.md': proposal,
      'openspec/changes/archive/2026-01-01-old/proposal.md': proposal,
      'openspec/changes/archive/2026-01-01-old/specs/demo/spec.md': `## ADDED Requirements\n\n${req('Alpha')}\n`,
      'openspec/specs/demo/spec.md': spec(req('Alpha')),
    };
    const { model: m } = model(files, {
      'openspec/changes/archive/2026-01-01-old/proposal.md': `${proposal}\nA typo fix.\n`,
      'openspec/changes/archive/2026-01-01-old/specs/demo/spec.md':
        files['openspec/changes/archive/2026-01-01-old/specs/demo/spec.md'],
      'openspec/specs/demo/spec.md': files['openspec/specs/demo/spec.md'],
    });
    expect(m.changes.map((c) => [c.name, c.status])).toEqual([
      ['old', 'archive-edited'],
      ['dropped', 'deleted'],
    ]);
    // History is shown, not counted, and not checked against today's spec.
    expect(m.requirementChanges).toBe(0);
    expect(m.changes[0]?.capabilities[0]).toMatchObject({ historical: true });
    expect(m.changes[0]?.capabilities[0]?.changes[0]?.problems).toEqual([]);
  });
});
