import { describe, expect, it } from 'vitest';
import { alignSequences } from '../src/diff/align';
import { blocksChanged, diffBlocks } from '../src/diff/blocks';
import { diffRequirement } from '../src/diff/requirement';
import { tokensText } from '../src/diff/tokens';
import { diffInlineMarkdown, hasChanges, similarity } from '../src/diff/words';
import { parseRequirement } from '../src/openspec';

const flat = (before: string, after: string) =>
  diffInlineMarkdown(before, after).map((s) => `${s.type[0]}:${tokensText(s.tokens)}`);

describe('word diff', () => {
  it('marks only the words that changed', () => {
    expect(
      flat(
        'the dock releases the bike within 3 seconds',
        'the dock releases the bike within 2 seconds',
      ),
    ).toEqual(['s:the dock releases the bike within ', 'r:3', 'a:2', 's: seconds']);
  });

  it('joins neighbouring edits into one replacement, removed before added', () => {
    expect(
      flat('updated within 60 seconds of a change', 'refreshed every 30 seconds of a change'),
    ).toEqual(['r:updated within 60', 'a:refreshed every 30', 's: seconds of a change']);
  });

  it('keeps bold, code and links on the tokens', () => {
    const segments = diffInlineMarkdown(
      'shows "Not responding"',
      'shows **"Not responding"** with code `DOCK_TIMEOUT`, see [the table](docs/errors.md)',
    );
    const added = segments.filter((s) => s.type === 'added').flatMap((s) => s.tokens);
    expect(added.find((t) => t.text === 'DOCK_TIMEOUT')?.marks).toEqual({ code: true });
    expect(added.find((t) => t.text === 'table')?.marks).toEqual({ link: 'docs/errors.md' });
    const same = segments.filter((s) => s.type === 'same').flatMap((s) => s.tokens);
    expect(same.find((t) => t.text === 'Not')?.marks).toEqual({ strong: true });
  });

  it('treats inline code as one token and a changed link target as a change', () => {
    expect(flat('use `DOCK_TIMEOUT` here', 'use `DOCK_BUSY` here')).toEqual([
      's:use ',
      'r:DOCK_TIMEOUT',
      'a:DOCK_BUSY',
      's: here',
    ]);
    expect(hasChanges(diffInlineMarkdown('see [docs](a.md)', 'see [docs](b.md)'))).toBe(true);
  });

  it('ignores formatting-only and whitespace-only differences', () => {
    expect(hasChanges(diffInlineMarkdown('a group ride', 'a **group ride**'))).toBe(false);
    expect(hasChanges(diffInlineMarkdown('a  b', 'a b'))).toBe(false);
  });

  it('does not interpret raw HTML', () => {
    const segments = diffInlineMarkdown('safe', 'safe <img src=x onerror=alert(1)>');
    expect(tokensText(segments.flatMap((s) => s.tokens))).toContain('<img src=x onerror=alert(1)>');
  });

  it('measures similarity between 0 and 1', () => {
    expect(similarity('a b c', 'a b c')).toBe(1);
    expect(similarity('a b c d', 'a b x y')).toBe(0.5);
    expect(similarity('a', 'z')).toBe(0);
  });
});

describe('alignSequences', () => {
  it('pairs similar items in order and leaves the rest alone', () => {
    const pairs = alignSequences(['a', 'b', 'c'], ['a', 'x', 'c', 'd'], (x, y) =>
      x === y ? 1 : 0,
    );
    expect(pairs).toEqual([
      { before: 'a', after: 'a' },
      { before: 'b', after: null },
      { before: null, after: 'x' },
      { before: 'c', after: 'c' },
      { before: null, after: 'd' },
    ]);
  });
});

describe('diffBlocks', () => {
  it('diffs matching paragraphs by word and reports whole added blocks', () => {
    const blocks = diffBlocks(
      'The system SHALL a.\n\nKept.',
      'The system SHALL b.\n\nKept.\n\nNew paragraph.',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['inline', 'same', 'added']);
    expect(blocksChanged(blocks)).toBe(true);
    expect(blocksChanged(diffBlocks('Same.\n\n- a\n- b', 'Same.\n\n- a\n- b'))).toBe(false);
  });

  it('aligns list items and replaces code blocks whole', () => {
    const [list] = diffBlocks(
      '- one\n- two\n- three',
      '- one\n- two, changed\n- four words here now',
    );
    expect(list?.kind === 'list' && list.items.map((i) => i.status)).toEqual([
      'same',
      'changed',
      'removed',
      'added',
    ]);
    expect(diffBlocks('```\na\n```', '```\nb\n```').map((b) => b.kind)).toEqual([
      'removed',
      'added',
    ]);
  });
});

describe('diffRequirement', () => {
  const requirement = (raw: string) =>
    parseRequirement({ headerLine: raw.split('\n')[0] ?? '', name: 'R', raw, line: 1 });
  const before = requirement(`### Requirement: R
The system SHALL unlock within 3 seconds.

#### Scenario: Kept
- **WHEN** a
- **THEN** b

#### Scenario: Changed
- **WHEN** the dock does not confirm within 10 seconds
- **THEN** the app shows an error

#### Scenario: Dropped
- **WHEN** x

#### Scenario: Old name
- **WHEN** a rider scans a held bike
- **THEN** the bike stays locked for the other rider`);
  const after = requirement(`### Requirement: R
The system SHALL unlock within 2 seconds.

#### Scenario: Kept
- **WHEN** a
- **THEN** b

#### Scenario: Changed
- **GIVEN** a slow network
- **WHEN** the dock does not confirm within 5 seconds
- **AND** the app shows an error

#### Scenario: New name
- **WHEN** a rider scans a held bike
- **THEN** the bike stays locked for the other rider

#### Scenario: Brand new
- **WHEN** y`);
  const diff = diffRequirement(before, after);

  it('marks scenarios as kept, changed, removed, renamed and added, in reading order', () => {
    expect(diff.scenarios.map((s) => [s.name, s.status, s.previousName])).toEqual([
      ['Kept', 'same', null],
      ['Changed', 'changed', null],
      ['Dropped', 'removed', null],
      ['New name', 'changed', 'Old name'],
      ['Brand new', 'added', null],
    ]);
    expect(diff.counts).toEqual({ same: 1, added: 1, removed: 1, changed: 2 });
    expect(diff.statementChanged).toBe(true);
  });

  it('aligns steps within a scenario', () => {
    const rows = diff.scenarios[1]?.rows ?? [];
    expect(
      rows.map((r) => [
        r.status,
        r.after?.kind === 'step' ? r.after.keyword : null,
        r.keywordChanged,
      ]),
    ).toEqual([
      ['added', 'GIVEN', false],
      ['changed', 'WHEN', false],
      ['changed', 'AND', true],
    ]);
    expect(
      rows[1]?.segments?.filter((s) => s.type !== 'same').map((s) => tokensText(s.tokens)),
    ).toEqual(['10', '5']);
    expect(rows[2]?.segments).toBeNull();
  });

  it('reports no change for identical requirements', () => {
    const same = diffRequirement(before, before);
    expect(same.statementChanged).toBe(false);
    expect(same.scenarios.every((s) => s.status === 'same')).toBe(true);
  });
});
