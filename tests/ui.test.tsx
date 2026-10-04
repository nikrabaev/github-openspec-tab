import type React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LoadedPull } from '../src/github/load';
import { parseGlossary } from '../src/openspec';
import { App } from '../src/ui/App';
import { isCompact, pairHalves } from '../src/ui/components/common';
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

  it('keeps long decisions, and statements with a table, at full width', () => {
    const long = render('longform');
    expect(long).toContain('class="decisions"');
    expect(long).toContain('class="req-body is-stacked"');
    expect(long).toContain('class="task-groups"');
    const short = render('showcase');
    expect(short).toContain('class="decisions is-compact"');
    expect(short).not.toContain('is-stacked');
    expect(short).toContain('class="task-groups is-compact"');
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

  it('pairs sections two to a row without leaving one alone in half a row', () => {
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
