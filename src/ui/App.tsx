import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadError, LoadedPull } from '@/github/load';
import { DEFAULT_PREFERENCES, type Preferences, type ReviewState } from '@/github/messages';
import { blobUrl, diffFileUrl, pullKey } from '@/github/route';
import { buildGlossaryIndex } from '@/openspec';
import { CommentsContext, useCommentsState } from './comments';
import { CapabilitySection } from './components/Capability';
import { Callout } from './components/common';
import { DesignSection } from './components/Design';
import { HelpDialog } from './components/Help';
import { Outline } from './components/Outline';
import { OverviewCard } from './components/Overview';
import { ProposalSection } from './components/Proposal';
import { EmptyState, ErrorState, LoadingState } from './components/States';
import { TasksSection } from './components/Tasks';
import {
  DiffViewContext,
  PullContext,
  type PullContextValue,
  ReviewContext,
  type ReviewContextValue,
  type Services,
} from './context';
import { AlertIcon } from './icons';
import { MarkdownProvider } from './markdown/Markdown';
import { useMarkdownOptions } from './markdownOptions';
import { buildOutline, filterOutline } from './outline';
import { useIsDark } from './theme';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: LoadedPull }
  | { status: 'error'; error: LoadError | Error };

export interface AppProps {
  state: LoadState;
  repo: string;
  /** Item the URL points at, if any. */
  target: string | null;
  services: Services;
}

const isEditable = (element: EventTarget | undefined) =>
  element instanceof HTMLElement &&
  (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

function SpecText({ path, children }: { path: string; children: React.ReactNode }) {
  const options = useMarkdownOptions(path, { keywords: true });
  return <MarkdownProvider options={options}>{children}</MarkdownProvider>;
}

function Ready({
  data,
  target,
  services,
}: {
  data: LoadedPull;
  target: string | null;
  services: Services;
}) {
  const { model } = data;
  const root = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [help, setHelp] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [review, setReview] = useState<ReviewState>({ items: {} });
  const key = pullKey(data.pull);

  useEffect(() => {
    let cancelled = false;
    services.loadPreferences().then((loaded) => !cancelled && setPrefs(loaded));
    services.loadReview(key).then((loaded) => !cancelled && setReview(loaded ?? { items: {} }));
    return () => {
      cancelled = true;
    };
  }, [services, key]);

  const setView = useCallback(
    (diffView: Preferences['diffView']) => {
      setPrefs((previous) => {
        const next = { ...previous, diffView };
        void services.savePreferences(next);
        return next;
      });
    },
    [services],
  );

  const reviewValue = useMemo<ReviewContextValue>(
    () => ({
      statusOf(id, hash) {
        const entry = review.items[id];
        if (!entry) return 'unread';
        return entry.hash === hash ? 'read' : 'stale';
      },
      toggle(id, hash) {
        setReview((previous) => {
          const items = { ...previous.items };
          if (items[id]?.hash === hash) delete items[id];
          else items[id] = { hash, at: Date.now() };
          const next = { items };
          void services.saveReview(key, next);
          return next;
        });
      },
    }),
    [review, services, key],
  );

  const comments = useCommentsState(model, services.comments);
  const outline = useMemo(() => buildOutline(model), [model]);
  const visibleOutline = useMemo(() => filterOutline(outline, filter), [outline, filter]);
  const progress = useMemo(() => {
    const reviewable = outline.filter((item) => item.hash);
    let read = 0;
    let stale = 0;
    for (const item of reviewable) {
      const entry = review.items[item.id];
      if (entry?.hash === item.hash) read++;
      else if (entry) stale++;
    }
    return { read, stale, total: reviewable.length };
  }, [outline, review]);

  const find = useCallback(
    (id: string) =>
      root.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`) ?? null,
    [],
  );
  // The item last jumped to stays "current" while it is on screen, even when it
  // cannot reach the top of the window (the end of the page), so j and k never stall.
  const pinned = useRef<{ id: string; at: number } | null>(null);
  const scrollTo = useCallback(
    (id: string, smooth = true) => {
      const element = find(id);
      if (!element) return false;
      pinned.current = { id, at: Date.now() };
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({ behavior: smooth && !calm ? 'smooth' : 'auto', block: 'start' });
      element.setAttribute('tabindex', '-1');
      element.focus({ preventScroll: true });
      setCurrent(id);
      return true;
    },
    [find],
  );
  const goTo = useCallback(
    (id: string) => {
      services.navigate(id);
      scrollTo(id);
    },
    [services, scrollTo],
  );

  // Follow the URL: a deep link on load, back/forward afterwards.
  const lastTarget = useRef<string | null>(null);
  useEffect(() => {
    if (target && target !== lastTarget.current) scrollTo(target, lastTarget.current !== null);
    lastTarget.current = target;
  }, [target, scrollTo]);

  // Highlight the section being read.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const items = root.current?.querySelectorAll<HTMLElement>('[data-nav]');
      if (!items?.length) return;
      if (pinned.current) {
        const rect = find(pinned.current.id)?.getBoundingClientRect();
        const onScreen = rect && rect.bottom > 0 && rect.top < window.innerHeight;
        // Still on its way there (smooth scrolling), or arrived and visible.
        if (onScreen || Date.now() - pinned.current.at < 1000) return;
        pinned.current = null;
      }
      let active = items[0];
      for (const item of items) {
        // An item counts once it is near where a jump would put it: under the window's top
        // edge, or under the sticky header of the section it is in.
        const line = (Number.parseFloat(getComputedStyle(item).scrollMarginTop) || 0) + 32;
        if (item.getBoundingClientRect().top <= line) active = item;
        else break;
      }
      setCurrent(active?.dataset.item ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Scrolling by hand hands the highlight back to the scroll position.
    const release = (event: Event) => {
      if (event instanceof KeyboardEvent && !/^(Arrow|Page|Home|End| )/.test(event.key)) return;
      pinned.current = null;
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    for (const type of ['wheel', 'touchmove', 'keydown'])
      window.addEventListener(type, release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      for (const type of ['wheel', 'touchmove', 'keydown'])
        window.removeEventListener(type, release);
    };
  }, [find]);

  // Keyboard: handled before GitHub's own shortcuts see the key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const origin = event.composedPath()[0];
      if (isEditable(origin)) {
        if (
          event.key === 'Escape' &&
          origin instanceof HTMLElement &&
          root.current?.getRootNode().contains(origin)
        ) {
          origin.blur();
        }
        return;
      }
      // An open dialog (help, a zoomed diagram) has the keyboard to itself.
      const scope = root.current?.getRootNode() as Document | ShadowRoot | undefined;
      if (scope?.querySelector('dialog[open]')) return;
      const items = [...(root.current?.querySelectorAll<HTMLElement>('[data-nav]') ?? [])];
      const index = items.findIndex((item) => item.dataset.item === current);
      const move = (step: number) => {
        const next = items[Math.min(items.length - 1, Math.max(0, index + step))];
        if (next?.dataset.item) goTo(next.dataset.item);
      };
      switch (event.key) {
        case 'j':
          move(1);
          break;
        case 'k':
          move(-1);
          break;
        case 'm': {
          const item = outline.find((entry) => entry.id === current);
          if (item?.hash) reviewValue.toggle(item.id, item.hash);
          break;
        }
        case '1':
          setView('inline');
          break;
        case '2':
          setView('split');
          break;
        case '3':
          setView('new');
          break;
        case '/':
          filterRef.current?.focus();
          break;
        case '?':
          setHelp(true);
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [current, goTo, outline, reviewValue, setView]);

  const pullValue = useMemo<PullContextValue>(
    () => ({ data, glossary: buildGlossaryIndex(data.glossary), services, goTo }),
    [data, services, goTo],
  );

  if (model.isEmpty) {
    return <EmptyState repo={`${data.pull.owner}/${data.pull.repo}`} root={model.root} />;
  }

  return (
    <PullContext.Provider value={pullValue}>
      <ReviewContext.Provider value={reviewValue}>
        <CommentsContext.Provider value={comments}>
          <DiffViewContext.Provider value={prefs.diffView}>
            <div className="layout" ref={root}>
              <Outline
                items={visibleOutline}
                current={current}
                filter={filter}
                onFilter={setFilter}
                filterRef={filterRef}
                onSelect={goTo}
                view={prefs.diffView}
                onView={setView}
                progress={progress}
                onHelp={() => setHelp(true)}
              />
              <main className={`content view-${prefs.diffView}`}>
                {data.warnings.map((warning) => (
                  <Callout key={warning} tone="attention" icon={<AlertIcon />} title="Incomplete">
                    <p>{warning}</p>
                  </Callout>
                ))}
                {comments.status === 'error' && (
                  <Callout
                    tone="attention"
                    icon={<AlertIcon />}
                    title="Review comments are missing"
                  >
                    <p>{comments.loadError}</p>
                  </Callout>
                )}

                {model.changes.map((change) => (
                  <article key={change.id} className="change" aria-label={change.label.label}>
                    <OverviewCard change={change} />
                    {change.proposal && <ProposalSection change={change} doc={change.proposal} />}
                    {change.design && <DesignSection change={change} doc={change.design} />}
                    {change.capabilities.map((capability) => (
                      <SpecText
                        key={capability.id}
                        path={capability.deltaPath ?? capability.specPath}
                      >
                        <CapabilitySection view={capability} />
                      </SpecText>
                    ))}
                    {change.tasks && (
                      <TasksSection doc={change.tasks} doneAtBase={change.tasks.doneAtBase} />
                    )}
                    {change.otherFiles.length > 0 && (
                      <p className="other-files muted">
                        Also in this change:{' '}
                        {change.otherFiles.map((file) => (
                          <a
                            key={file.path}
                            className="chip chip-path"
                            href={blobUrl(data.pull, data.facts.headSha, file.path)}
                          >
                            {file.rel}
                          </a>
                        ))}
                      </p>
                    )}
                  </article>
                ))}

                {model.directEdits.length > 0 && (
                  <article className="change" aria-label="Specs edited directly">
                    <header className="overview overview-direct" data-item="specs" data-nav="">
                      <div className="overview-top">
                        <span className="pill pill-neutral">No change folder</span>
                      </div>
                      <h2>Specs edited directly</h2>
                      <p className="lead">
                        These specs differ from what the changes in this pull request account for.
                        Each requirement is compared with the spec on the base branch.
                      </p>
                    </header>
                    {model.directEdits.map((capability) => (
                      <SpecText key={capability.id} path={capability.specPath}>
                        <CapabilitySection view={capability} />
                      </SpecText>
                    ))}
                  </article>
                )}

                {model.otherFiles.length > 0 && (
                  <section className="section" data-item="files" data-nav="">
                    <header className="section-head">
                      <h3>Other OpenSpec files</h3>
                    </header>
                    <ul className="file-list">
                      {model.otherFiles.map((file) => (
                        <li key={file.path}>
                          <span
                            className={`tag tag-${file.status === 'modified' ? 'changed' : file.status}`}
                          >
                            {file.status}
                          </span>
                          <a href={diffFileUrl(data.pull, file.path)}>{file.path}</a>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </main>
            </div>
            {help && <HelpDialog onClose={() => setHelp(false)} />}
          </DiffViewContext.Provider>
        </CommentsContext.Provider>
      </ReviewContext.Provider>
    </PullContext.Provider>
  );
}

/** The whole tab: loading, failure, nothing to show, or the reading view. */
export function App({ state, repo, target, services }: AppProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = useIsDark(ref);
  return (
    <div className="openspec-tab" ref={ref} data-dark={dark ? '' : undefined}>
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && (
        <ErrorState
          error={state.error}
          repo={repo}
          onRetry={services.reload}
          onOptions={services.openOptions}
        />
      )}
      {state.status === 'ready' && <Ready data={state.data} target={target} services={services} />}
    </div>
  );
}
