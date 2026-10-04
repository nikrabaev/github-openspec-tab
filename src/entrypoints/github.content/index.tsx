import { createRoot, type Root } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { extensionBackend, send } from '@/github/backend';
import { addReply, addThread, loadComments, setResolved, submitReview } from '@/github/comments';
import {
  alignWithNav,
  ensurePageStyle,
  ensureTab,
  findBoundary,
  findTab,
  findTabNav,
  hideNativeContent,
  isTabBarReady,
  removeTab,
  setTabCount,
  setTabSelected,
  showNativeContent,
} from '@/github/dom';
import { LoadError, loadPull } from '@/github/load';
import { DEFAULT_PREFERENCES, type Preferences } from '@/github/messages';
import {
  HASH_PREFIX,
  hashFor,
  type PullRef,
  parseHash,
  parsePullUrl,
  pullKey,
} from '@/github/route';
import { plural } from '@/openspec/text';
import { App, type LoadState } from '@/ui/App';
import type { Services } from '@/ui/context';

const ROOT = 'openspec';
const REFRESH_AFTER = 60_000;
const RECHECK_EVERY = 100;
const GIVE_UP_AFTER = 10_000;

/**
 * Not loaded yet, or assumed empty because the repository has no `openspec/`
 * directory. Either becomes a real load when the tab is opened.
 */
type Phase = { status: 'unknown' } | { status: 'assumed-empty' } | LoadState;

class Controller {
  private pull: PullRef | null = null;
  private phase: Phase = { status: 'unknown' };
  private loadedAt = 0;
  /**
   * What the reader chose last time. Read when the script starts and again with each pull
   * request, so the skeleton and the tab's first render are already laid out that way.
   */
  private preferences: Preferences = DEFAULT_PREFERENCES;
  private generation = 0;
  private target: string | null = null;
  private ui: ShadowRootContentScriptUi<Root> | null = null;
  private mounting: Promise<void> | null = null;
  private root: Root | null = null;
  private frame = 0;
  private observer = new MutationObserver(() => this.schedule());
  private observing = false;
  private recheck = 0;
  private waitingSince = new WeakMap<HTMLElement, number>();

  constructor(private readonly ctx: ContentScriptContext) {}

  start(): void {
    const schedule = () => this.schedule();
    for (const type of ['popstate', 'hashchange', 'wxt:locationchange', 'pageshow', 'resize']) {
      this.ctx.addEventListener(window, type as 'popstate', schedule);
    }
    // GitHub's soft navigations: Turbo for classic pages, its own events for React ones.
    for (const type of ['turbo:render', 'turbo:load', 'soft-nav:end', 'soft-nav:react-done']) {
      this.ctx.addEventListener(document, type as 'click', schedule);
    }
    // A token may have been added in the settings page in the meantime.
    this.ctx.addEventListener(document, 'visibilitychange', () => {
      const error = this.phase.status === 'error' ? this.phase.error : null;
      const fixable =
        error instanceof LoadError &&
        ['needs-token', 'bad-token', 'no-access', 'forbidden'].includes(error.kind);
      if (document.visibilityState === 'visible' && fixable && this.pull)
        void this.load(this.pull, true);
    });
    this.ctx.onInvalidated(() => this.teardown(true));
    void this.readPreferences();
    this.sync();
  }

  /** Coalesce bursts of DOM changes and navigation events into one pass per frame. */
  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.sync();
    });
  }

  private watch(on: boolean): void {
    if (on === this.observing) return;
    this.observing = on;
    if (on) {
      // React re-renders and Turbo frame swaps can drop the tab or bring new content back.
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-current'],
      });
    } else {
      this.observer.disconnect();
    }
  }

  /** Bring the page in line with the URL. Safe to call any number of times. */
  private sync(): void {
    if (!this.ctx.isValid) return;
    const pull = parsePullUrl(location.href);
    if (!pull) {
      this.teardown(false);
      return;
    }
    this.watch(true);
    if (!this.pull || pullKey(pull) !== pullKey(this.pull)) {
      this.pull = pull;
      this.phase = { status: 'unknown' };
      this.generation++;
      void this.load(pull, false);
    }

    const nav = findTabNav();
    if (!nav) return;
    ensurePageStyle();
    const tab =
      findTab(nav) || this.canAddTab(nav)
        ? ensureTab(nav, `${location.pathname}${location.search}${HASH_PREFIX}`, this.onTabClick)
        : null;
    if (tab) this.updateCount(tab);

    // The view itself does not wait for the tab: it sits outside GitHub's React.
    const route = parseHash(location.hash);
    if (route.active) {
      this.target = route.target;
      this.activate(nav, tab);
    } else {
      this.deactivate(nav, tab);
    }
  }

  /**
   * Whether the tab can go into the tab bar yet. On a React page that is once
   * React has mounted the tab bar, which the page script answers (see
   * `react.ts`). Nothing on the page changes at that moment, so until then
   * this asks again every little while.
   *
   * If the answer never comes (the page script is not running, or React's
   * internals changed), the tab is added anyway once the page has been loaded
   * for a while: a tab that costs GitHub a second render beats no tab.
   */
  private canAddTab(nav: HTMLElement): boolean {
    if (isTabBarReady(nav)) return true;
    if (document.readyState === 'complete') {
      const since = this.waitingSince.get(nav) ?? Date.now();
      this.waitingSince.set(nav, since);
      if (Date.now() - since > GIVE_UP_AFTER) return true;
    }
    this.recheck ||= this.ctx.setTimeout(() => {
      this.recheck = 0;
      const current = findTabNav();
      if (current && !findTab(current) && this.canAddTab(current)) this.schedule();
    }, RECHECK_EVERY);
    return false;
  }

  private onTabClick = (event: MouseEvent): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    // Keep GitHub's routers out of it: this is a same-page hash change.
    event.preventDefault();
    event.stopPropagation();
    if (!parseHash(location.hash).active) location.hash = HASH_PREFIX;
    this.sync();
  };

  private updateCount(tab: HTMLElement): void {
    const phase = this.phase;
    if (phase.status === 'ready') {
      const { requirementChanges, changes } = phase.data.model;
      const live = changes.filter(
        (change) => change.status === 'in-progress' || change.status === 'archived',
      );
      setTabCount(
        tab,
        requirementChanges,
        `OpenSpec: ${plural(requirementChanges, 'requirement change')}${live.length > 0 ? ` in ${plural(live.length, 'change')}` : ''}`,
      );
    } else if (phase.status === 'assumed-empty') {
      setTabCount(tab, 0, 'OpenSpec: no changes in this pull request');
    } else if (phase.status === 'error') {
      setTabCount(tab, null, 'OpenSpec: could not load, open the tab for details');
    } else {
      setTabCount(tab, null, 'OpenSpec');
    }
  }

  private activate(nav: HTMLElement, tab: HTMLElement | null): void {
    const boundary = findBoundary(nav);
    if (tab) setTabSelected(nav, tab, true);
    hideNativeContent(nav, boundary, this.ui?.shadowHost ?? null);
    document.documentElement.dataset.openspecActive = '';

    if (this.pull && (this.phase.status === 'unknown' || this.phase.status === 'assumed-empty')) {
      void this.load(this.pull, true);
    } else if (
      this.pull &&
      this.phase.status === 'ready' &&
      Date.now() - this.loadedAt > REFRESH_AFTER
    ) {
      // New pushes: cheap to check, since trees and blobs are cached by SHA.
      this.loadedAt = Date.now();
      void this.load(this.pull, true, true);
    }

    if (this.ui?.shadowHost.isConnected && this.ui.shadowHost.parentElement === boundary) {
      alignWithNav(nav, this.ui.shadowHost);
      this.render();
      return;
    }
    if (this.mounting) return;
    this.mounting = this.mount(boundary).finally(() => {
      this.mounting = null;
      this.schedule();
    });
  }

  private async mount(boundary: HTMLElement): Promise<void> {
    this.ui?.remove();
    // The stylesheet is bundled into this script, not fetched as a file of its own. A browser
    // keeps running the script it loaded until the extension is reloaded, but would fetch a
    // newer stylesheet at once, and the two must never be from different builds.
    const { default: tabCss } = await import('@/ui/styles.css?inline');
    const ui = await createShadowRootUi(this.ctx, {
      name: 'openspec-tab',
      position: 'inline',
      anchor: boundary,
      append: 'last',
      // The stylesheet resets inherited styles itself and relies on GitHub's CSS variables.
      inheritStyles: true,
      css: tabCss,
      // Typing in the tab must not trigger GitHub's keyboard shortcuts.
      isolateEvents: ['keydown', 'keyup', 'keypress'],
      onMount: (container) => {
        const element = document.createElement('div');
        container.append(element);
        const root = createRoot(element);
        this.root = root;
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
        this.root = null;
      },
    });
    // The URL may have moved on while the stylesheet was loading.
    if (!parseHash(location.hash).active || !boundary.isConnected) return;
    this.ui = ui;
    ui.mount();
    this.render();
    const top = ui.shadowHost.getBoundingClientRect().top + window.scrollY - 200;
    if (!this.target && window.scrollY > top) window.scrollTo({ top: Math.max(0, top) });
  }

  private deactivate(nav: HTMLElement, tab: HTMLElement | null): void {
    if (this.ui || document.documentElement.hasAttribute('data-openspec-active')) {
      delete document.documentElement.dataset.openspecActive;
      this.ui?.remove();
      this.ui = null;
      showNativeContent();
    }
    if (tab) setTabSelected(nav, tab, false);
  }

  private teardown(removeEverything: boolean): void {
    this.watch(false);
    this.pull = null;
    this.phase = { status: 'unknown' };
    this.generation++;
    this.ui?.remove();
    this.ui = null;
    if (document.documentElement.hasAttribute('data-openspec-active')) {
      delete document.documentElement.dataset.openspecActive;
      showNativeContent();
    }
    if (removeEverything) {
      cancelAnimationFrame(this.frame);
      removeTab();
      showNativeContent();
    }
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    const nav = findTabNav();
    const tab = nav && findTab(nav);
    if (tab) this.updateCount(tab);
    this.render();
  }

  /**
   * Load the pull request. Unless `force`d (the tab was opened), a repository
   * with no `openspec/` directory on its default branch is assumed to have
   * nothing to show, which costs no API request at all.
   */
  private async load(pull: PullRef, force: boolean, quiet = false): Promise<void> {
    const generation = force ? ++this.generation : this.generation;
    const current = () => this.ctx.isValid && generation === this.generation;
    const repo = `${pull.owner}/${pull.repo}`;
    try {
      if (!force) {
        let flag = await send({ type: 'repo-flag-get', repo });
        if (!flag) {
          const found = await extensionBackend.probe(pull, ROOT);
          if (found !== null) {
            flag = { hasOpenSpec: found };
            void send({ type: 'repo-flag-set', repo, hasOpenSpec: found });
          }
        }
        if (!current()) return;
        if (flag?.hasOpenSpec === false) {
          this.setPhase({ status: 'assumed-empty' });
          return;
        }
      }
      if (!quiet) this.setPhase({ status: 'loading' });
      const [data] = await Promise.all([
        loadPull(pull, extensionBackend, ROOT),
        this.readPreferences(),
      ]);
      if (!current()) return;
      this.loadedAt = Date.now();
      this.setPhase({ status: 'ready', data });
      if (data.plan.loads.length > 0) void send({ type: 'repo-flag-set', repo, hasOpenSpec: true });
    } catch (error) {
      if (!current() || quiet) return;
      this.setPhase({
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private async readPreferences(): Promise<void> {
    const stored = await send({ type: 'prefs-get' }).catch(() => null);
    if (!stored) return;
    // A background script from an older build does not know the newer preferences.
    this.preferences = { ...DEFAULT_PREFERENCES, ...stored };
    this.render();
  }

  private services: Services = {
    loadReview: (key) => send({ type: 'review-get', key }),
    saveReview: async (key, state) => {
      await send({ type: 'review-set', key, state });
    },
    preferences: () => this.preferences,
    savePreferences: async (prefs) => {
      this.preferences = prefs;
      await send({ type: 'prefs-set', prefs });
    },
    openOptions: () => void send({ type: 'open-options' }),
    navigate: (target) => {
      this.target = target;
      history.replaceState(
        history.state,
        '',
        `${location.pathname}${location.search}${hashFor(target)}`,
      );
      this.render();
    },
    reload: () => {
      if (this.pull) void this.load(this.pull, true);
    },
    comments: {
      load: () => {
        if (!this.pull) throw new Error('No pull request is open.');
        return loadComments(extensionBackend, this.pull);
      },
      addThread: (snapshot, target, body, mode) =>
        addThread(extensionBackend, snapshot, target, body, mode),
      reply: (snapshot, threadId, body, mode) =>
        addReply(extensionBackend, snapshot, threadId, body, mode),
      setResolved: (threadId, resolved) => setResolved(extensionBackend, threadId, resolved),
      submitReview: (snapshot, event, body) =>
        submitReview(extensionBackend, snapshot, event, body),
    },
  };

  private render(): void {
    if (!this.root || !this.pull) return;
    const state: LoadState =
      this.phase.status === 'unknown' || this.phase.status === 'assumed-empty'
        ? { status: 'loading' }
        : this.phase;
    this.root.render(
      <App
        state={state}
        repo={`${this.pull.owner}/${this.pull.repo}`}
        target={this.target}
        services={this.services}
      />,
    );
  }
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  // The stylesheet travels inside the script: see `mount`.
  cssInjectionMode: 'manual',
  main(ctx) {
    new Controller(ctx).start();
  },
});
