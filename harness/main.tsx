import '@primer/primitives/dist/css/primitives.css';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import '@primer/primitives/dist/css/functional/themes/dark-dimmed.css';
import './shell.css';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LoadError, type LoadErrorKind, type LoadedPull } from '@/github/load';
import { DEFAULT_PREFERENCES, type Preferences, type ReviewState } from '@/github/messages';
import { hashFor, parseHash } from '@/github/route';
import { buildModel, parseGlossary, planLoads, snapshotFromFiles } from '@/openspec';
import { App, type LoadState } from '@/ui/App';
import type { Services } from '@/ui/context';
import tabCss from '@/ui/styles.css?inline';

const raw = import.meta.glob('../fixtures/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `fixture name → side → repository path → content`. */
const fixtures = new Map<string, { base: Record<string, string>; head: Record<string, string> }>();
for (const [file, content] of Object.entries(raw)) {
  const match = /^\.\.\/fixtures\/([^/]+)\/(base|head)\/(.+)$/.exec(file);
  if (!match?.[1] || !match[2] || !match[3]) continue;
  const fixture = fixtures.get(match[1]) ?? { base: {}, head: {} };
  fixture[match[2] as 'base' | 'head'][match[3]] = content;
  fixtures.set(match[1], fixture);
}
if (!fixtures.has('empty')) fixtures.set('empty', { base: {}, head: {} });

const pull = { owner: 'pedalway', repo: 'pedalway', number: 128 };

function loadFixture(name: string): LoadedPull {
  const files = fixtures.get(name) ?? { base: {}, head: {} };
  const snapshot = snapshotFromFiles(files.base, files.head);
  const plan = planLoads(snapshot.base, snapshot.head);
  return {
    pull,
    facts: { baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40), baseRef: 'main', state: 'open' },
    plan,
    model: buildModel(plan, snapshot.blobs),
    glossary: parseGlossary(files.base['docs/CONTEXT.md'] ?? ''),
    warnings: [],
    readFile: async (side, path) => files[side][path] ?? null,
  };
}

const params = new URLSearchParams(location.search);
const THEMES: Record<string, [string, string, string]> = {
  light: ['light', 'light', 'dark'],
  dark: ['dark', 'light', 'dark'],
  dimmed: ['dark', 'light', 'dark_dimmed'],
};

function applyTheme(theme: string) {
  const [mode, light, dark] = THEMES[theme] ?? ['light', 'light', 'dark'];
  const html = document.documentElement;
  html.dataset.colorMode = mode;
  html.dataset.lightTheme = light;
  html.dataset.darkTheme = dark;
}

const stored = <T,>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
};

function Harness() {
  const [fixture, setFixture] = useState(params.get('fixture') ?? 'showcase');
  const [theme, setTheme] = useState(params.get('theme') ?? 'light');
  const [stateName, setStateName] = useState(params.get('state') ?? 'ready');
  const [hash, setHash] = useState(location.hash || '#openspec');
  const [generation, setGeneration] = useState(0);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the "reload" trigger
  const data = useMemo(() => loadFixture(fixture), [fixture, generation]);
  const state: LoadState = stateName.startsWith('error')
    ? {
        status: 'error',
        error: new LoadError(
          (stateName.split(':')[1] ?? 'unknown') as LoadErrorKind,
          'Resource protected by organization SAML enforcement.',
          {
            authenticated: stateName.includes('authenticated'),
            resetAt: Math.floor(Date.now() / 1000) + 23 * 60,
            status: 403,
          },
        ),
      }
    : stateName === 'loading'
      ? { status: 'loading' }
      : { status: 'ready', data };

  const services = useMemo<Services>(
    () => ({
      loadReview: async (key) =>
        stored<ReviewState | null>(`harness:review:${fixture}:${key}`, null),
      saveReview: async (key, review) =>
        localStorage.setItem(`harness:review:${fixture}:${key}`, JSON.stringify(review)),
      loadPreferences: async () => ({
        ...stored<Preferences>('harness:prefs', DEFAULT_PREFERENCES),
        ...(params.get('view') ? { diffView: params.get('view') as Preferences['diffView'] } : {}),
      }),
      savePreferences: async (prefs) =>
        localStorage.setItem('harness:prefs', JSON.stringify(prefs)),
      openOptions: () => alert('In the extension this opens the settings page.'),
      navigate: (target) => {
        history.replaceState(history.state, '', hashFor(target));
        setHash(location.hash);
      },
      reload: () => setGeneration((value) => value + 1),
    }),
    [fixture],
  );

  const select = (
    label: string,
    value: string,
    options: string[],
    onChange: (value: string) => void,
  ) => (
    <label>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
  const count = state.status === 'ready' ? state.data.model.requirementChanges : null;

  return (
    <>
      <div className="shell-top">
        <strong>
          {pull.owner} / {pull.repo}
        </strong>
        <div className="shell-controls">
          {select('Fixture', fixture, [...fixtures.keys()].sort(), setFixture)}
          {select(
            'State',
            stateName,
            [
              'ready',
              'loading',
              'error:needs-token',
              'error:no-access',
              'error:bad-token',
              'error:rate-limited',
              'error:forbidden',
              'error:network',
            ],
            setStateName,
          )}
          {select('Theme', theme, Object.keys(THEMES), setTheme)}
        </div>
        <span className="shell-note">Dev harness: fixture data, not a real pull request</span>
      </div>
      <div className="shell-pr">
        <h1>
          Group rides: unlock and bill several bikes together <span>#{pull.number}</span>
        </h1>
        <div className="shell-meta">
          <span className="shell-state">Open</span>
          <span>
            <strong>mira</strong> wants to merge 9 commits into <code>main</code> from{' '}
            <code>bks-142-group-rides</code>
          </span>
        </div>
        <nav className="shell-tabs" aria-label="Pull request tabs">
          <span className="shell-tab">
            Conversation <span className="shell-counter">6</span>
          </span>
          <span className="shell-tab">
            Commits <span className="shell-counter">9</span>
          </span>
          <span className="shell-tab">Checks</span>
          <span className="shell-tab">
            Files changed <span className="shell-counter">312</span>
          </span>
          <span className="shell-tab" aria-current="page">
            OpenSpec {count !== null && <span className="shell-counter">{count}</span>}
          </span>
        </nav>
      </div>
      <ShadowMount>
        <App
          state={state}
          repo={`${pull.owner}/${pull.repo}`}
          target={parseHash(hash).target}
          services={services}
        />
      </ShadowMount>
    </>
  );
}

/** Mount children in a shadow root, as the extension does, so styles are tested in isolation. */
function ShadowMount({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<ReturnType<typeof createRoot> | null>(null);
  useEffect(() => {
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.replaceChildren();
    const style = document.createElement('style');
    style.textContent = tabCss;
    const container = document.createElement('div');
    shadow.append(style, container);
    const created = createRoot(container);
    setRoot(created);
    return () => {
      setRoot(null);
      setTimeout(() => created.unmount());
    };
  }, [host]);
  useEffect(() => {
    root?.render(children);
  }, [root, children]);
  return <div id="openspec-tab-host" ref={setHost} />;
}

const shell = document.getElementById('shell');
if (shell) {
  // Reuse the root when Vite re-runs this module after an edit.
  const holder = window as { harnessRoot?: ReturnType<typeof createRoot> };
  holder.harnessRoot ??= createRoot(shell);
  holder.harnessRoot.render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
