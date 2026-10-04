// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  alignWithHeader,
  ensureTab,
  findBoundary,
  findTabNav,
  hideNativeContent,
  removeTab,
  setTabCount,
  setTabSelected,
  showNativeContent,
} from '../src/github/dom';

/**
 * Markup written for these tests, shaped like GitHub's two pull request tab
 * bars: the React one (hashed class names, `aria-current`, an id on the Files
 * tab, the fixed header and its marker after the tab bar) and the classic one
 * (`.tabnav-tab.selected`, `.Counter`).
 */
const REACT_PAGE = `
<main><turbo-frame id="repo-content-turbo-frame"><div id="app" style="min-height: 800px">
  <header>
    <nav class="TabNav_x1" aria-label="Pull request navigation" data-turbo="false"><div class="List_x2">
      <a class="Link_x3 selected_x4" aria-current="page" href="/o/r/pull/7"><svg class="octicon octicon-comment-discussion"><path d="M0 0"></path></svg>Conversation</a>
      <a class="Link_x3" id="prs-commits-anchor-tab" href="/o/r/pull/7/commits"><svg class="octicon octicon-git-commit"><path d="M0 0"></path></svg>Commits<span aria-hidden="true" data-component="CounterLabel" class="Counter_x5">4</span><span class="prc-VisuallyHidden-x6"> (4)</span></a>
      <a class="Link_x3" href="/o/r/pull/7/checks"><svg class="octicon octicon-checklist"><path d="M0 0"></path></svg>Checks</a>
      <a class="Link_x3" href="/o/r/pull/7/files" id="prs-files-anchor-tab" data-discover="true"><svg class="octicon octicon-file-diff"><path d="M0 0"></path></svg>Files changed</a>
    </div></nav>
    <div class="PageHeader_x7 StickyPullRequestHeader-module__prHeader__x8" style="display: none; height: 60px">Open, the title</div>
    <div class="StickyPullRequestHeader-module__stickyHeaderActivationThreshold__x9"></div>
  </header>
  <div class="content">native content</div>
</div></turbo-frame></main>`;

const CLASSIC_PAGE = `
<main><turbo-frame id="repo-content-turbo-frame"><div id="bucket">
  <div class="tabnav"><nav class="tabnav-tabs" aria-label="Pull request tabs">
    <a href="/o/r/pull/7" class="tabnav-tab flex-shrink-0">
      <svg class="octicon octicon-comment-discussion"><path d="M0 0"></path></svg>
      Conversation
      <span id="conversation_tab_counter" title="2" class="Counter">2</span>
    </a>
    <a href="/o/r/pull/7/files" class="tabnav-tab flex-shrink-0 selected" aria-current="page">
      <svg class="octicon octicon-file-diff"><path d="M0 0"></path></svg>
      Files changed
      <span id="files_tab_counter" title="10" class="Counter">10</span>
    </a>
  </nav></div>
  <div class="diff">diff content</div>
</div></turbo-frame></main>`;

function setup(html: string, url: string) {
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom's test-only API
  (window as any).happyDOM.setURL(url);
  document.body.innerHTML = html;
  const nav = findTabNav();
  if (!nav) throw new Error('no tab bar');
  return nav;
}

const noop = () => {};
const labels = (nav: HTMLElement) =>
  [...nav.querySelectorAll('a')].map((a) => a.textContent?.replace(/\s+/g, ' ').trim());

describe('tab injection: React tab bar', () => {
  let nav: HTMLElement;
  beforeEach(() => {
    nav = setup(REACT_PAGE, 'https://github.com/o/r/pull/7');
  });

  it('adds the tab right after "Files changed", looking like a native unselected tab', () => {
    const tab = ensureTab(nav, '/o/r/pull/7#openspec', noop);
    expect(labels(nav)).toEqual([
      'Conversation',
      'Commits4 (4)',
      'Checks',
      'Files changed',
      'OpenSpec',
    ]);
    expect(tab?.className).toBe('Link_x3');
    expect(tab?.id).toBe('');
    expect(tab?.getAttribute('href')).toBe('/o/r/pull/7#openspec');
    expect(tab?.hasAttribute('aria-current')).toBe(false);
    expect(tab?.querySelector('svg')?.getAttribute('class')).toBe('octicon');
    expect(document.querySelectorAll('#prs-files-anchor-tab')).toHaveLength(1);
  });

  it('is idempotent and keeps the link current', () => {
    const first = ensureTab(nav, '/o/r/pull/7#openspec', noop);
    const second = ensureTab(nav, '/o/r/pull/7/commits#openspec', noop);
    expect(second).toBe(first);
    expect(nav.querySelectorAll('a[data-openspec-tab]')).toHaveLength(1);
    expect(second?.getAttribute('href')).toBe('/o/r/pull/7/commits#openspec');
  });

  it('borrows a counter from another tab and fills it in', () => {
    const tab = ensureTab(nav, '#openspec', noop) as HTMLElement;
    const counter = tab.querySelector<HTMLElement>('[data-openspec-count]');
    expect(counter?.className).toBe('Counter_x5');
    expect(counter?.hidden).toBe(true);
    setTabCount(tab, 14, 'OpenSpec: 14 requirement changes');
    expect(counter?.textContent).toBe('14');
    expect(counter?.hidden).toBe(false);
    expect(tab.getAttribute('aria-label')).toBe('OpenSpec: 14 requirement changes');
    setTabCount(tab, null, 'OpenSpec');
    expect(counter?.hidden).toBe(true);
  });

  it('moves the selected look to our tab and back', () => {
    const tab = ensureTab(nav, '#openspec', noop) as HTMLElement;
    const conversation = nav.querySelector('a') as HTMLElement;
    setTabSelected(nav, tab, true);
    setTabSelected(nav, tab, true);
    expect(tab.className).toBe('Link_x3 selected_x4');
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(conversation.className).toBe('Link_x3');
    expect(conversation.hasAttribute('aria-current')).toBe(false);

    setTabSelected(nav, tab, false);
    expect(tab.className).toBe('Link_x3');
    expect(tab.hasAttribute('aria-current')).toBe(false);
    expect(conversation.className).toBe('Link_x3 selected_x4');
    expect(conversation.getAttribute('aria-current')).toBe('page');
  });

  it('does not re-select the old tab after GitHub navigated to another one', () => {
    const tab = ensureTab(nav, '#openspec', noop) as HTMLElement;
    const conversation = nav.querySelector('a') as HTMLElement;
    setTabSelected(nav, tab, true);
    // GitHub navigates to Commits and marks it itself.
    // biome-ignore lint/suspicious/noExplicitAny: happy-dom's test-only API
    (window as any).happyDOM.setURL('https://github.com/o/r/pull/7/commits');
    const commits = nav.querySelector('#prs-commits-anchor-tab') as HTMLElement;
    commits.classList.add('selected_x4');
    commits.setAttribute('aria-current', 'page');
    setTabSelected(nav, tab, false);
    expect(conversation.className).toBe('Link_x3');
    expect(commits.getAttribute('aria-current')).toBe('page');
  });

  it('hides what follows the tab bar, keeps our host, and puts everything back', () => {
    const boundary = findBoundary(nav);
    expect(boundary.tagName).toBe('TURBO-FRAME');
    const host = document.createElement('openspec-tab');
    boundary.append(host);
    hideNativeContent(nav, boundary, host);
    const hidden = [...document.querySelectorAll('[data-openspec-hidden]')].map((e) => e.className);
    // GitHub's fixed header and the marker it watches follow the tab bar too, and stay.
    expect(hidden).toEqual(['content']);
    expect(host.hasAttribute('data-openspec-hidden')).toBe(false);
    expect(document.querySelector('#app')?.hasAttribute('data-openspec-compact')).toBe(true);
    expect(nav.closest('header')?.hasAttribute('data-openspec-hidden')).toBe(false);

    showNativeContent();
    expect(
      document.querySelectorAll('[data-openspec-hidden], [data-openspec-compact]'),
    ).toHaveLength(0);
    removeTab();
    expect(nav.querySelector('a[data-openspec-tab]')).toBeNull();
  });

  it("leaves room for GitHub's fixed header before it shows, and none when it is hidden", () => {
    const host = document.createElement('openspec-tab');
    findBoundary(nav).append(host);
    alignWithHeader(host);
    expect(host.style.getPropertyValue('--openspec-sticky-top')).toBe('60px');

    document.querySelector('header')?.setAttribute('data-openspec-hidden', '');
    alignWithHeader(host);
    expect(host.style.getPropertyValue('--openspec-sticky-top')).toBe('0px');
  });
});

describe('tab injection: classic tab bar', () => {
  it('clones the Files changed tab without its selected state, id or count', () => {
    const nav = setup(CLASSIC_PAGE, 'https://github.com/o/r/pull/7/files');
    const tab = ensureTab(nav, '/o/r/pull/7/files#openspec', noop) as HTMLElement;
    expect(labels(nav)).toEqual(['Conversation 2', 'Files changed 10', 'OpenSpec']);
    expect(tab.className).toBe('tabnav-tab flex-shrink-0');
    expect(tab.hasAttribute('aria-current')).toBe(false);
    expect(tab.querySelector('[data-openspec-count]')?.id).toBe('');
    expect(document.querySelectorAll('#files_tab_counter')).toHaveLength(1);

    setTabCount(tab, 0, 'OpenSpec: no changes in this pull request');
    expect(tab.textContent?.replace(/\s+/g, ' ').trim()).toBe('OpenSpec 0');

    setTabSelected(nav, tab, true);
    expect(tab.classList.contains('selected')).toBe(true);
    expect(nav.querySelectorAll('.selected')).toHaveLength(1);
    setTabSelected(nav, tab, false);
    expect(nav.querySelector('.selected')?.textContent).toContain('Files changed');
  });

  it('leaves no room at the top on a page without the fixed header', () => {
    setup(CLASSIC_PAGE, 'https://github.com/o/r/pull/7/files');
    const host = document.createElement('openspec-tab');
    document.body.append(host);
    alignWithHeader(host);
    expect(host.style.getPropertyValue('--openspec-sticky-top')).toBe('0px');
  });
});
