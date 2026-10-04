/**
 * Contract tests against the reference implementation.
 *
 * The parsers in `@fission-ai/openspec` are not exported, so ours are written
 * to follow them. These tests run the real CLI on the fixtures and check that
 * both read the same deltas, compute the same per-requirement diffs, count the
 * same tasks and rebuild the same spec on archive.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPatch, OMIT_HEADERS, structuredPatch } from 'diff';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyDelta,
  type ChangeView,
  parseDeltaSpec,
  parseTasks,
  type RequirementChange,
} from '../src/openspec';
import { FIXTURES, modelOf } from './helpers/fixtures';

const CLI = join(import.meta.dirname, '..', 'node_modules', '.bin', 'openspec');
const temporary: string[] = [];

function openspec(cwd: string, args: string[]): string {
  return execFileSync(CLI, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DO_NOT_TRACK: '1', OPENSPEC_TELEMETRY: '0', CI: '1', NO_COLOR: '1' },
  });
}

function scratchCopy(fixture: string, side: 'base' | 'head'): string {
  const dir = mkdtempSync(join(tmpdir(), 'openspec-tab-'));
  temporary.push(dir);
  cpSync(join(FIXTURES, fixture, side), dir, { recursive: true });
  return dir;
}

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

interface CliDelta {
  spec: string;
  operation: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
  requirement?: {
    name?: string;
    text: string;
    scenarios: Array<{ name?: string; rawText: string }>;
  };
  rename?: { from: string; to: string };
  diff?: string;
  warning?: string;
}

function cliShow(fixture: string, change: string): CliDelta[] {
  const out = openspec(join(FIXTURES, fixture, 'head'), [
    'change',
    'show',
    change,
    '--json',
    '--diff',
    '--no-interactive',
  ]);
  return (JSON.parse(out) as { deltas: CliDelta[] }).deltas;
}

/** The unified diff the CLI attaches to a MODIFIED delta, computed the same way. */
function unifiedDiff(before: string, after: string): string {
  const withNewline = (text: string) => (text.endsWith('\n') ? text : `${text}\n`);
  return formatPatch(
    structuredPatch('a', 'a', withNewline(before), withNewline(after)),
    OMIT_HEADERS,
  ).trimEnd();
}

/** What the CLI calls a requirement's text: the non-blank statement lines, trimmed. */
const statementLines = (statement: string) =>
  statement
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

const scenarioBody = (raw: string) => raw.split('\n').slice(1).join('\n').trim();

function compareWithCli(change: ChangeView, deltas: CliDelta[]) {
  const ours = change.capabilities.flatMap((capability) =>
    capability.changes.map((entry) => ({ capability: capability.capability, entry })),
  );
  const find = (spec: string, op: RequirementChange['op'], name: string) =>
    ours.find((o) => o.capability === spec && o.entry.op === op && o.entry.name === name)?.entry;

  for (const delta of deltas) {
    if (delta.operation === 'RENAMED') {
      const rename = delta.rename;
      expect(rename).toBeDefined();
      // A rename that is also modified is one card of ours, carrying the old name.
      const entry =
        find(delta.spec, 'renamed', rename?.to ?? '') ??
        find(delta.spec, 'modified', rename?.to ?? '');
      expect(entry, `rename ${rename?.from} → ${rename?.to}`).toBeDefined();
      expect(entry?.previousName).toBe(rename?.from);
      continue;
    }

    const name = delta.requirement?.name ?? '';
    const op = delta.operation.toLowerCase() as RequirementChange['op'];
    const entry = find(delta.spec, op, name);
    expect(entry, `${delta.operation} ${delta.spec}/${name}`).toBeDefined();
    if (!entry) continue;

    if (delta.operation !== 'REMOVED') {
      expect(statementLines(entry.after?.statement ?? '')).toBe(delta.requirement?.text);
      expect(
        entry.after?.scenarios.map((s) => ({ name: s.name, rawText: scenarioBody(s.raw) })),
      ).toEqual(delta.requirement?.scenarios);
    }
    if (delta.operation === 'MODIFIED') {
      if (delta.diff !== undefined) {
        expect(entry.before, `base block for ${name}`).not.toBeNull();
        expect(unifiedDiff(entry.before?.raw ?? '', entry.after?.raw ?? '')).toBe(delta.diff);
      } else {
        expect(entry.before).toBeNull();
      }
      const codes = entry.problems.map((problem) => problem.code);
      if (delta.warning?.startsWith('Header differs'))
        expect(codes).toContain('modified-near-miss');
      else if (delta.warning?.startsWith('No matching'))
        expect(codes).toContain('modified-no-match');
      else expect(codes.filter((code) => code.startsWith('modified-'))).toEqual([]);
    }
  }

  // Nothing of ours is missing from the CLI's list either (a merged rename counts twice there).
  const renamedAndModified = ours.filter((o) => o.entry.op === 'modified' && o.entry.previousName);
  expect(ours.length + renamedAndModified.length).toBe(deltas.length);
}

describe('contract: openspec change show --json --diff', () => {
  it('reads the same deltas and diffs for a change in progress', () => {
    const { model } = modelOf('showcase');
    const change = model.changes.find((c) => c.name === 'bks-142-group-rides');
    expect(change).toBeDefined();
    const deltas = cliShow('showcase', 'bks-142-group-rides');
    expect(deltas.length).toBe(10);
    if (change) compareWithCli(change, deltas);
  });

  it('agrees on repeated and case-variant headers, fences, bullet removals, renames and near-misses', () => {
    const { model } = modelOf('edge');
    const [change] = model.changes;
    expect(change).toBeDefined();
    const deltas = cliShow('edge', 'faster-dock-repairs');
    if (change) compareWithCli(change, deltas);
    expect(deltas.map((d) => d.requirement?.name).filter(Boolean)).not.toContain(
      'Not a real requirement',
    );
  });
});

describe('contract: openspec list --json', () => {
  it.each([
    ['showcase', 'bks-142-group-rides'],
    ['edge', 'faster-dock-repairs'],
    ['problems', 'fix-unlock-timeouts'],
  ])('counts tasks like the CLI (%s)', (fixture, name) => {
    const dir = join(FIXTURES, fixture, 'head');
    const listed = (
      JSON.parse(openspec(dir, ['list', '--json'])) as {
        changes: Array<{ name: string; completedTasks: number; totalTasks: number }>;
      }
    ).changes.find((change) => change.name === name);
    const tasks = parseTasks(readFileSync(join(dir, 'openspec/changes', name, 'tasks.md'), 'utf8'));
    expect({ done: tasks.done, total: tasks.total }).toEqual({
      done: listed?.completedTasks,
      total: listed?.totalTasks,
    });
  });
});

describe('contract: openspec archive', () => {
  it('rebuilds the same specs as archiving the change in progress', () => {
    const dir = scratchCopy('showcase', 'head');
    const readSpec = (capability: string) => {
      try {
        return readFileSync(join(dir, 'openspec/specs', capability, 'spec.md'), 'utf8');
      } catch {
        return null;
      }
    };
    const capabilities = ['ride-unlock', 'ride-billing', 'group-rides'];
    const expected = new Map(
      capabilities.map((capability) => {
        const delta = readFileSync(
          join(dir, 'openspec/changes/bks-142-group-rides/specs', capability, 'spec.md'),
          'utf8',
        );
        const result = applyDelta(readSpec(capability), parseDeltaSpec(delta), {
          specName: capability,
          changeName: 'bks-142-group-rides',
          deltaContent: delta,
        });
        expect(
          result.operations.flatMap((op) => op.problems).filter((p) => p.severity === 'error'),
        ).toEqual([]);
        return [capability, result.rebuilt];
      }),
    );

    openspec(dir, ['archive', 'bks-142-group-rides', '--yes']);
    for (const capability of capabilities) {
      expect(readSpec(capability), capability).toBe(expected.get(capability));
    }
  });

  it('matches the archived spec committed in the fixture', () => {
    const dir = scratchCopy('showcase', 'base');
    openspec(dir, ['archive', 'bks-131-dock-reservations', '--yes']);
    const archived = readFileSync(join(dir, 'openspec/specs/dock-availability/spec.md'), 'utf8');
    const committed = readFileSync(
      join(FIXTURES, 'showcase/head/openspec/specs/dock-availability/spec.md'),
      'utf8',
    );
    expect(archived).toBe(committed);

    // And the model sees no direct edit there: the archived change accounts for all of it.
    const { model } = modelOf('showcase');
    expect(model.directEdits.map((edit) => edit.capability)).toEqual(['rider-notifications']);
  });
});
