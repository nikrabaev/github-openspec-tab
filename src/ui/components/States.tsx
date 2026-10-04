import type { ReactNode } from 'react';
import type { LoadError } from '@/github/load';
import { AlertIcon, ClockIcon, InboxIcon, KeyIcon, StopIcon } from '../icons';

/** Shown while the pull request is being read: the shape of what is coming. */
export function LoadingState() {
  return (
    <div className="layout" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading OpenSpec changes</span>
      <div className="outline" aria-hidden="true">
        <div className="skeleton sk-line" style={{ width: '50%' }} />
        <div className="skeleton sk-bar" />
        <div className="skeleton sk-input" />
        {[70, 45, 55, 80, 65, 75, 50, 60].map((width, index) => (
          <div
            key={index}
            className="skeleton sk-line"
            style={{ width: `${width}%`, marginInlineStart: index % 3 ? 16 : 0 }}
          />
        ))}
      </div>
      <div className="content" aria-hidden="true">
        <div className="overview">
          <div className="skeleton sk-pill" />
          <div className="skeleton sk-title" />
          <div className="skeleton sk-line" style={{ width: '92%' }} />
          <div className="skeleton sk-line" style={{ width: '78%' }} />
          <div className="sk-stats">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="skeleton sk-stat" />
            ))}
          </div>
        </div>
        {[0, 1].map((index) => (
          <div key={index} className="req">
            <div className="skeleton sk-line" style={{ width: '40%' }} />
            <div className="skeleton sk-line" style={{ width: '95%' }} />
            <div className="skeleton sk-line" style={{ width: '85%' }} />
            <div className="skeleton sk-line" style={{ width: '60%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Blank(props: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`blank${props.tone ? ` blank-${props.tone}` : ''}`}>
      <div className="blank-icon">{props.icon}</div>
      <h2>{props.title}</h2>
      <div className="blank-body">{props.children}</div>
      {props.actions && <div className="blank-actions">{props.actions}</div>}
    </div>
  );
}

export function EmptyState({ repo, root }: { repo: string; root: string }) {
  return (
    <Blank icon={<InboxIcon size={28} />} title="No OpenSpec changes in this pull request">
      <p>
        Nothing under <code>{root}/</code> is added, edited or removed here, so there is no spec to
        review.
      </p>
      <p className="muted">
        When a pull request in <strong>{repo}</strong> touches a change or a spec, it will show up
        in this tab.
      </p>
    </Blank>
  );
}

function resetText(resetAt: number | null): string {
  if (!resetAt) return 'in a while';
  const minutes = Math.max(1, Math.ceil((resetAt * 1000 - Date.now()) / 60000));
  return minutes > 90
    ? `in about ${Math.round(minutes / 60)} hours`
    : `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Each way loading can fail, with what to do about it. */
export function ErrorState(props: {
  error: LoadError | Error;
  repo: string;
  onRetry(): void;
  onOptions(): void;
}) {
  const { error } = props;
  const kind = 'kind' in error ? error.kind : 'unknown';
  const authenticated = 'detail' in error ? error.detail.authenticated : false;
  const retry = (
    <button type="button" className="button" onClick={props.onRetry}>
      Try again
    </button>
  );
  const settings = (label: string) => (
    <button type="button" className="button button-primary" onClick={props.onOptions}>
      {label}
    </button>
  );

  switch (kind) {
    case 'needs-token':
      return (
        <Blank
          icon={<KeyIcon size={28} />}
          title="This repository needs a token"
          actions={
            <>
              {settings('Add a token')}
              {retry}
            </>
          }
        >
          <p>
            GitHub's API does not show <strong>{props.repo}</strong> without signing in, which
            usually means it is private.
          </p>
          <p className="muted">
            Add a fine-grained, read-only token (Contents and Pull requests). It stays in this
            browser's extension storage and is only ever sent to api.github.com.
          </p>
        </Blank>
      );
    case 'no-access':
      return (
        <Blank
          icon={<StopIcon size={28} />}
          title="The token cannot see this repository"
          tone="danger"
          actions={
            <>
              {settings('Open settings')}
              {retry}
            </>
          }
        >
          <p>
            GitHub answered "not found" for <strong>{props.repo}</strong>. The token probably does
            not include this repository, or its organisation has not approved it yet.
          </p>
          <p className="muted">
            Check that the token's repository access includes it, with read access to Contents and
            Pull requests.
          </p>
        </Blank>
      );
    case 'bad-token':
      return (
        <Blank
          icon={<KeyIcon size={28} />}
          title="The token was rejected"
          tone="danger"
          actions={
            <>
              {settings('Replace the token')}
              {retry}
            </>
          }
        >
          <p>GitHub did not accept the saved token. It may have expired or been revoked.</p>
        </Blank>
      );
    case 'rate-limited':
      return (
        <Blank
          icon={<ClockIcon size={28} />}
          title="GitHub's API limit is used up"
          actions={
            <>
              {!authenticated && settings('Add a token')}
              {retry}
            </>
          }
        >
          <p>
            Requests are allowed again {resetText('detail' in error ? error.detail.resetAt : null)}.
          </p>
          {!authenticated && (
            <p className="muted">
              Without a token GitHub allows 60 requests an hour for your whole network. With one,
              the limit is 5,000.
            </p>
          )}
        </Blank>
      );
    case 'forbidden':
      return (
        <Blank
          icon={<StopIcon size={28} />}
          title="GitHub refused access"
          tone="danger"
          actions={
            <>
              {settings('Open settings')}
              {retry}
            </>
          }
        >
          <p>{error.message}</p>
          <p className="muted">
            Organisations can require single sign-on or approval for tokens. Authorise the token for
            the organisation, then try again.
          </p>
        </Blank>
      );
    case 'network':
      return (
        <Blank icon={<AlertIcon size={28} />} title="Could not reach GitHub" actions={retry}>
          <p>
            The request to api.github.com did not go through. Check your connection and try again.
          </p>
        </Blank>
      );
    default:
      return (
        <Blank
          icon={<AlertIcon size={28} />}
          title="Something went wrong"
          tone="danger"
          actions={retry}
        >
          <p>{error.message || 'The OpenSpec changes could not be loaded.'}</p>
        </Blank>
      );
  }
}
