import { readFileSync } from 'node:fs';
import type React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  type FixtureComments,
  fakeCommentServices,
  snapshotFromFixture,
} from '../harness/fakeComments';
import type { CommentsSnapshot } from '../src/github/comments';
import type { LoadedPull } from '../src/github/load';
import { parseGlossary } from '../src/openspec';
import { App } from '../src/ui/App';
import { isCompact, layoutRows, pairHalves } from '../src/ui/components/common';
import { when } from '../src/ui/components/Discussion';
import type { Services } from '../src/ui/context';
import { Markdown, MarkdownProvider } from '../src/ui/markdown/Markdown';
import { looksLikePath, resolveRepoPath } from '../src/ui/markdownOptions';
import { buildOutline, filterOutline } from '../src/ui/outline';
import { luminance } from '../src/ui/theme';
import { FIXTURES, modelOf, readTree } from './helpers/fixtures';

const services: Services = {
  loadReview: async () => null,
  saveReview: async () => {},
  loadPreferences: async () => ({ diffView: 'inline' }),
  savePreferences: async () => {},
  openOptions: () => {},
  navigate: () => {},
  reload: () => {},
};

function loaded(fixture: string): LoadedPull {
  const { plan, model } = modelOf(fixture);
  return {
    pull: { owner: 'pedalway', repo: 'pedalway', number: 128 },
    facts: { baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40), baseRef: 'main', state: 'open' },
    plan,
    model,
    glossary: parseGlossary(readTree(`${FIXTURES}/${fixture}/base`)['docs/CONTEXT.md'] ?? ''),
    warnings: [],
    readFile: async () => null,
  };
}

/** Server-render to a string, without the markers React puts between adjacent text nodes. */
const toHtml = (element: React.ReactElement) => renderToString(element).replaceAll('<!-- -->', '');

const render = (fixture: string) =>
  toHtml(
    <App
      state={{ status: 'ready', data: loaded(fixture) }}
      repo="pedalway/pedalway"
      target={null}
      services={services}
    />,
  );

describe('App', () => {
  it('renders a pull request with several changes', () => {
    const html = render('showcase');
    for (const text of [
      'BKS-142',
      'Group rides',
      'Archived in this PR',
      'In progress',
      'Unlock by QR code',
      'Reservation hold',
      'Bike hold',
      'Needs your answer',
      'Alternatives considered',
      'Mitigation',
      'unchanged requirement',
      'Specs edited directly',
      '4 of 12',
    ]) {
      expect(html.includes(text), text).toBe(true);
    }
    // Word-level changes, obligations and glossary terms are marked up.
    expect(html).toMatch(/<del class="w-del">.*?3.*?<\/del>/);
    expect(html).toMatch(/<ins class="w-ins">.*?2.*?<\/ins>/);
    expect(html).toContain('class="kw kw-must"');
    expect(html).toContain('class="kw kw-not"');
    expect(html).toContain('class="term"');
    expect(html).toContain('class="term term-avoided"');
    // The comment link points at the changed line in Files changed.
    expect(html).toMatch(/pull\/128\/files#diff-[0-9a-f]{64}R\d+/);
  });

  it('gives long content room: no thin columns, and a table keeps the full width', () => {
    const long = render('longform');
    expect(long).toContain('class="decisions"');
    // Long decisions sit two to a row at most; the one with a table is not one of them.
    expect(long.match(/class="decision is-half"/g)).toHaveLength(2);
    expect(long.match(/class="decision"/g)).toHaveLength(2);
    expect(long).toContain('class="req-body is-stacked"');
    expect(long).toContain('class="task-groups"');
    const short = render('showcase');
    expect(short).toContain('class="decisions is-compact"');
    expect(short).not.toContain('is-half');
    expect(short).not.toContain('is-stacked');
    expect(short).toContain('class="task-groups is-compact"');
  });

  it('puts a proposal in two columns of about the same length', () => {
    const html = render('longform');
    const columns = html.split('class="doc-column"');
    // The opening lines, Why and What Changes on the left; Capabilities and Impact on the right.
    expect(columns[1]).toContain('Ticket: BKS-150');
    expect(columns[1]).toContain('block-why');
    expect(columns[1]).toContain('block-what-changes');
    expect(columns[2]).toContain('block-capabilities');
    expect(columns[2]).toContain('block-impact');
  });

  it('lists each capability as a row: name, id, new or modified, and what the delta does', () => {
    const html = render('longform');
    const rows = html.split('<li class="cap-row">').slice(1);
    expect(rows).toHaveLength(5);
    const facts = rows.map((row) => [
      /class="cap-name">([^<]+)</.exec(row)?.[1],
      /class="cap-id">([^<]+)</.exec(row)?.[1],
      /class="tag tag-(?:added|changed)">([^<]+)</.exec(row)?.[1],
      [
        ...(row.split('class="cap-text"')[0] ?? '').matchAll(
          /class="count count-\w+"[^>]*>([^<]+)</g,
        ),
      ]
        .map((match) => match[1])
        .join(' '),
    ]);
    expect(facts).toEqual([
      ['Refund review', 'refund-review', 'New', '+3'],
      ['Payment provider refund webhooks', 'payment-provider-refund-webhooks', 'New', '+1'],
      ['Ride billing', 'ride-billing', 'Modified', '+2 ~1'],
      ['Rider notifications', 'rider-notifications', 'Modified', '+1 ~1'],
      ['Receipts', 'receipts', 'Modified', '~1'],
    ]);
    // The name is a button that jumps to the capability's spec; the description follows it.
    expect(rows[0]).toMatch(/<button type="button" class="cap-name">/);
    expect(rows[0]).toContain('how a request that no automatic rule approved');
  });

  it('shows format problems inline and falls back to plain Markdown', () => {
    const html = render('problems');
    expect(html).toContain('only in case or spacing');
    expect(html).toContain('has no matching TO: line');
    expect(html).toContain('Past rides list');
    expect(html).toContain('Fix unlock timeouts');
  });

  it('shows a friendly empty state, a skeleton and errors', () => {
    expect(render('empty')).toContain('No OpenSpec changes in this pull request');
    expect(
      toHtml(<App state={{ status: 'loading' }} repo="o/r" target={null} services={services} />),
    ).toContain('aria-busy="true"');
    expect(
      toHtml(
        <App
          state={{ status: 'error', error: new Error('boom') }}
          repo="o/r"
          target={null}
          services={services}
        />,
      ),
    ).toContain('Something went wrong');
  });
});

describe('Review comments', () => {
  const fixture = JSON.parse(
    readFileSync(`${FIXTURES}/showcase/comments.json`, 'utf8'),
  ) as FixtureComments;
  const withComments = (snapshot: CommentsSnapshot) =>
    toHtml(
      <App
        state={{ status: 'ready', data: loaded('showcase') }}
        repo="pedalway/pedalway"
        target={null}
        services={{ ...services, comments: fakeCommentServices(snapshot) }}
      />,
    );

  it('shows each thread where it belongs, with what it is on', () => {
    const html = withComments(snapshotFromFixture(fixture));
    expect(html).toContain('Two seconds is tight for the older docks');
    expect(html).toMatch(/Scenario: Successful unlock · line 8<\/a>/);
    // The link opens the line in Files changed.
    expect(html).toMatch(/pull\/128\/files#diff-[0-9a-f]{64}R8"/);
    // The settled thread and the outdated one are folded away, each under one line.
    expect(html).toContain('1 resolved thread');
    expect(html).toContain('1 outdated thread');
    expect(html).toContain('On an earlier version of this file');
    expect(html).toContain('On the file as a whole');
    // The outline counts the threads that still want an answer.
    expect(html.match(/class="outline-comments"/g)).toHaveLength(5);
  });

  it('lets a reader with a token comment, reply and resolve', () => {
    const html = withComments(snapshotFromFixture(fixture));
    expect(html).toContain('Reply…');
    expect(html).toContain('>Resolve</button>');
    expect(html).toContain('>Unresolve</button>');
    expect(html).toContain('title="Comment on Requirement: Unlock by QR code"');
    expect(html).toContain(
      'title="Comment on Scenario: Successful unlock (Requirement: Unlock by QR code)"',
    );
    expect(html).toContain('title="Comment on Decision 2: The leader scans each bike"');
    expect(html).toContain('title="Comment on Proposal: What Changes"');
    expect(html).not.toContain('Reply on GitHub');
    expect(html).not.toContain('Review in progress');
  });

  it('is read-only without a token: links to GitHub instead of buttons', () => {
    const html = withComments(snapshotFromFixture(fixture, false));
    expect(html).toContain('Two seconds is tight for the older docks');
    expect(html).toContain('Reply on GitHub');
    expect(html).not.toContain('comment-trigger');
    expect(html).not.toContain('Reply…');
    expect(html).not.toContain('>Resolve</button>');
    // The requirement keeps its link to the line in Files changed.
    expect(html).toMatch(/title="Comment on line \d+ of [^"]+ in Files changed"/);
  });

  it('shows a review in progress and marks its comments as pending', () => {
    const snapshot = snapshotFromFixture({
      ...fixture,
      threads: [
        ...fixture.threads,
        {
          path: 'openspec/changes/bks-142-group-rides/tasks.md',
          line: 10,
          comments: [{ author: 'sam', at: '2026-09-30T09:00:00Z', body: 'Mine.', pending: true }],
        },
      ],
    });
    const html = withComments(snapshot);
    expect(html).toContain('Review in progress');
    expect(html).toContain('1 pending comment');
    expect(html).toContain('>Pending</span>');
  });

  it('renders comment text inertly, and not as spec text', () => {
    const html = withComments(
      snapshotFromFixture({
        viewer: 'sam',
        threads: [
          {
            path: 'openspec/changes/bks-142-group-rides/proposal.md',
            line: 12,
            comments: [
              {
                author: 'ines',
                at: '2026-09-30T09:00:00Z',
                body: 'The rider MUST see <img src=x onerror=alert(1)> [this](javascript:alert(2))',
              },
            ],
          },
        ],
      }),
    );
    const comment = html.slice(html.indexOf('class="comment-main"'));
    const body = comment.slice(0, comment.indexOf('</li>'));
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body).not.toMatch(/<img src|href="javascript/);
    // No SHALL / MUST styling and no glossary underlines in people's words.
    expect(body).not.toContain('class="kw');
    expect(body).not.toContain('class="term');
  });

  it('dates a comment relative to now when it is recent', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    expect(when('2026-10-04T11:59:40Z', now)).toBe('just now');
    expect(when('2026-10-04T11:15:00Z', now)).toBe('45 minutes ago');
    expect(when('2026-10-04T09:00:00Z', now)).toBe('3 hours ago');
    expect(when('2026-10-02T12:00:00Z', now)).toBe('2 days ago');
    expect(when('2026-09-12T08:00:00Z', now)).toBe('12 Sep 2026');
    expect(when('not a date', now)).toBe('');
  });
});

describe('Markdown rendering is inert', () => {
  const render = (source: string) =>
    toHtml(
      <MarkdownProvider
        options={{ resolveLink: (url) => `https://github.com/o/r/blob/sha/${url}` }}
      >
        <Markdown source={source} />
      </MarkdownProvider>,
    );

  it('never turns raw HTML into markup', () => {
    const html = render(
      'Text <img src=x onerror=alert(1)> more\n\n<script>alert(1)</script>\n\n<div onclick="x()">block</div>',
    );
    expect(html).not.toMatch(/<script|<img|<div onclick/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('only links to http, https and mailto', () => {
    const html = render(
      '[a](javascript:alert(1)) [b](data:text/html,x) [c](https://example.com) [d](docs/x.md) [e](#frag) ![i](javascript:alert(2))',
    );
    expect(html).not.toMatch(/href="(javascript|data):/);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="https://github.com/o/r/blob/sha/docs/x.md"');
    expect((html.match(/<a /g) ?? []).length).toBe(2);
  });

  it('drops template comments', () => {
    expect(render('<!-- hidden -->\n\nShown <!-- inline --> text')).not.toContain('hidden');
  });
});

describe('helpers', () => {
  it('recognises file paths but not routes or identifiers', () => {
    expect(looksLikePath('services/unlock/src/unlock-handler.ts')).toBe(true);
    expect(looksLikePath('apps/rider/src/')).toBe(true);
    expect(looksLikePath('./scripts/run.sh')).toBe(true);
    for (const value of [
      'POST /v2/unlocks',
      '/v2/unlocks',
      'group_ride_id',
      'https://a/b',
      'a | b/c',
      '@scope/pkg',
    ]) {
      expect(looksLikePath(value), value).toBe(false);
    }
  });

  it('resolves relative links against the file they are in', () => {
    const file = 'openspec/changes/foo/design.md';
    expect(resolveRepoPath(file, 'diagram.svg')).toBe('openspec/changes/foo/diagram.svg');
    expect(resolveRepoPath(file, '../../specs/a/spec.md#req')).toBe('openspec/specs/a/spec.md');
    expect(resolveRepoPath(file, '/docs/x.md')).toBe('docs/x.md');
    expect(resolveRepoPath(file, '../../../../etc/passwd')).toBeNull();
  });

  it('builds and filters the outline', () => {
    const outline = buildOutline(modelOf('showcase').model);
    expect(outline.filter((item) => item.depth === 0).map((item) => item.label)).toEqual([
      'BKS-131 · Dock reservations',
      'BKS-142 · Group rides',
      'Specs edited directly',
      'Other files',
    ]);
    expect(outline.filter((item) => item.hash).length).toBe(19);
    const filtered = filterOutline(outline, 'pin').map((item) => item.label);
    expect(filtered).toEqual(['BKS-142 · Group rides', 'Ride unlock', 'Unlock with a station PIN']);
    expect(filterOutline(outline, 'zzz')).toEqual([]);
  });

  it('splits sections that can share a row into two balanced columns', () => {
    const rows = layoutRows(
      [
        { name: 'why', size: 2, wide: false },
        { name: 'what', size: 9, wide: false },
        { name: 'capabilities', size: 6, wide: false },
        { name: 'impact', size: 5, wide: false },
        { name: 'table', size: 4, wide: true },
        { name: 'alone', size: 3, wide: false },
      ],
      (item) => !item.wide,
      (item) => item.size,
    );
    const names = rows.map((row) =>
      'full' in row
        ? row.full.name
        : [row.left.map((item) => item.name), row.right.map((item) => item.name)],
    );
    expect(names).toEqual([
      [
        ['why', 'what'],
        ['capabilities', 'impact'],
      ],
      'table',
      'alone',
    ]);
    // A short section beside a long one would leave a hole under it: both keep the full width.
    const lopsided = layoutRows(
      [
        { name: 'context', size: 10 },
        { name: 'goals', size: 3 },
      ],
      () => true,
      (item) => item.size,
    );
    expect(lopsided).toEqual([
      { full: { name: 'context', size: 10 } },
      { full: { name: 'goals', size: 3 } },
    ]);
    expect(
      layoutRows(
        [],
        () => true,
        () => 1,
      ),
    ).toEqual([]);
  });

  it('pairs cards two to a row without leaving one alone in half a row', () => {
    expect(pairHalves([true, true, true, true])).toEqual([true, true, true, true]);
    expect(pairHalves([true, true, true])).toEqual([true, true, false]);
    expect(pairHalves([true, false, true, true, false, true])).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
    expect(pairHalves([])).toEqual([]);
  });

  it('treats long prose, tables and code as needing the full width', () => {
    expect(isCompact('A short paragraph.', 100)).toBe(true);
    expect(isCompact('x'.repeat(101), 100)).toBe(false);
    expect(isCompact('| a | b |\n| --- | --- |\n| 1 | 2 |', 1000)).toBe(false);
    expect(isCompact('Text\n\n```ts\nconst a = 1;\n```', 1000)).toBe(false);
  });

  it('tells dark backgrounds from light ones', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#0d1117')).toBeLessThan(0.1);
    expect(luminance('rgb(34, 39, 46)')).toBeLessThan(0.4);
    expect(luminance('#fff')).toBeCloseTo(1);
    expect(luminance('')).toBeNull();
  });
});
