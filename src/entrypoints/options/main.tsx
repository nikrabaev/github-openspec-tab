import './options.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { TOKEN_KEY } from '@/github/messages';

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; text: string }
  | { kind: 'bad'; text: string };

/** Ask GitHub whether a token works, without touching any repository. */
async function checkToken(token: string): Promise<Status> {
  try {
    const response = await fetch('https://api.github.com/rate_limit', {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (response.status === 401) {
      return {
        kind: 'bad',
        text: 'GitHub rejected this token. Check that it was copied in full and has not expired.',
      };
    }
    if (!response.ok)
      return { kind: 'bad', text: `GitHub answered ${response.status}. Try again in a moment.` };
    const limit = Number(response.headers.get('x-ratelimit-limit') ?? 0);
    return {
      kind: 'ok',
      text: `GitHub accepted the token (${limit.toLocaleString('en')} requests an hour). Open a pull request and choose the OpenSpec tab.`,
    };
  } catch {
    return { kind: 'bad', text: 'Could not reach api.github.com to check the token.' };
  }
}

function Options() {
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    browser.storage.local.get(TOKEN_KEY).then((stored) => setSaved(Boolean(stored[TOKEN_KEY])));
  }, []);

  const save = async () => {
    const token = value.trim();
    if (!token) return;
    setStatus({ kind: 'checking' });
    const result = await checkToken(token);
    if (result.kind === 'ok') {
      await browser.storage.local.set({ [TOKEN_KEY]: token });
      setSaved(true);
      setValue('');
    }
    setStatus(result);
  };

  const remove = async () => {
    await browser.storage.local.remove(TOKEN_KEY);
    setSaved(false);
    setStatus({ kind: 'idle' });
  };

  return (
    <main>
      <h1>OpenSpec Tab</h1>
      <p className="muted">Settings for the OpenSpec tab on GitHub pull requests.</p>

      <h2>Access token</h2>
      <p>
        Public repositories work without a token. For <strong>private repositories</strong> the tab
        needs a token, because it asks GitHub's API which OpenSpec files a pull request changes. A
        token is also what lets you <strong>comment, reply and resolve threads</strong> from the
        tab, on any repository; without one, review comments are shown but not written.
      </p>
      <ol>
        <li>
          Open{' '}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
          >
            GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
          </a>
          .
        </li>
        <li>
          Under <strong>Resource owner</strong>, pick the user or organisation that owns the
          repositories. Under <strong>Repository access</strong>, pick the repositories you review.
        </li>
        <li>
          Under <strong>Repository permissions</strong>, set <code>Contents</code> to{' '}
          <strong>Read-only</strong>, and <code>Pull requests</code> to{' '}
          <strong>Read and write</strong> to comment from the tab, or <strong>Read-only</strong> to
          only read. Nothing else is needed. Resolving threads from the tab is the exception: GitHub
          allows it only with <code>Contents</code> set to <strong>Read and write</strong>, which
          also lets the token push code. Without that, the tab links to the thread on GitHub.
        </li>
        <li>
          Generate the token and paste it below. An organisation may have to approve it first.
        </li>
      </ol>

      <label htmlFor="token">{saved ? 'Replace the saved token' : 'Token'}</label>
      <div className="row">
        <input
          id="token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={saved ? 'A token is saved. Paste a new one to replace it.' : 'github_pat_…'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
        />
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={!value.trim() || status.kind === 'checking'}
        >
          {status.kind === 'checking' ? 'Checking…' : 'Check and save'}
        </button>
        {saved && (
          <button type="button" onClick={remove}>
            Remove
          </button>
        )}
      </div>

      <div aria-live="polite">
        {status.kind === 'ok' && <p className="status ok">{status.text}</p>}
        {status.kind === 'bad' && <p className="status bad">{status.text}</p>}
        {status.kind === 'idle' && saved && (
          <p className="status neutral">A token is saved in this browser.</p>
        )}
      </div>

      <div className="card">
        <strong>Where the token goes</strong>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          It is kept in this browser's extension storage and attached, by the extension's background
          worker, to requests to <code>api.github.com</code> only. It is never placed in a URL,
          never written to a log and never handed to a web page. File contents are read from
          github.com with your normal signed-in session.
        </p>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Options />
    </StrictMode>,
  );
}
