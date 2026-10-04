import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import type { CommentMode, CommentTarget, ReviewComment, ReviewEvent } from '@/github/comments';
import { isOpen, type PlacedThread, regionKey } from '@/github/placement';
import { diffLineUrl } from '@/github/route';
import { plural } from '@/openspec/text';
import { useComments } from '../comments';
import { usePull } from '../context';
import { ChevronIcon, CloseIcon, CommentIcon, ExternalIcon } from '../icons';
import { Markdown, MarkdownProvider } from '../markdown/Markdown';

/** Comments are people's words, not spec text: no glossary, no SHALL styling, no path chips. */
const PLAIN = {};

const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 hours ago" for something recent, the date for anything older. */
export function when(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const age = now - then;
  if (age < 60_000) return 'just now';
  if (age < 60 * 60_000) return `${plural(Math.floor(age / 60_000), 'minute')} ago`;
  if (age < DAY) return `${plural(Math.floor(age / (60 * 60_000)), 'hour')} ago`;
  if (age < 7 * DAY) return `${plural(Math.floor(age / DAY), 'day')} ago`;
  // Spelled out here: the month names a browser gives vary with its version.
  const date = new Date(then);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function Avatar({ comment }: { comment: ReviewComment }) {
  const { login, avatarUrl } = comment.author;
  return avatarUrl ? (
    <img className="avatar" src={avatarUrl} alt="" width={24} height={24} loading="lazy" />
  ) : (
    <span className="avatar avatar-initial" aria-hidden="true">
      {login.slice(0, 1).toUpperCase()}
    </span>
  );
}

function CommentView({ comment }: { comment: ReviewComment }) {
  return (
    <li className="comment">
      <Avatar comment={comment} />
      <div className="comment-main">
        <div className="comment-meta">
          <span className="comment-author">{comment.author.login}</span>
          <a className="comment-when" href={comment.url} title={comment.createdAt}>
            {when(comment.createdAt)}
          </a>
          {comment.pending && (
            <span className="tag tag-changed" title="Only you see it until you submit your review">
              Pending
            </span>
          )}
        </div>
        <Markdown source={comment.body} className="comment-body" />
      </div>
    </li>
  );
}

/**
 * Where a comment is typed. With no review in progress it can be published at
 * once or start one; while one is in progress, everything joins it.
 */
export function Composer(props: {
  placeholder: string;
  onSubmit(body: string, mode: CommentMode): Promise<void>;
  onCancel(): void;
}) {
  const { reviewing } = useComments();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const submit = async (mode: CommentMode) => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit(text, mode);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The comment could not be posted.');
      setBusy(false);
    }
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(reviewing ? 'review' : 'single');
      }}
    >
      <textarea
        ref={field}
        value={body}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        rows={4}
        disabled={busy}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit(reviewing ? 'review' : 'single');
          } else if (event.key === 'Escape' && !body.trim()) {
            props.onCancel();
          }
        }}
      />
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      <div className="composer-actions">
        <span className="composer-hint">
          {reviewing
            ? 'Joins your pending review: only you see it until you submit the review.'
            : 'Markdown works.'}
        </span>
        <button type="button" className="button" onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
        {!reviewing && (
          <button
            type="button"
            className="button"
            disabled={busy || !body.trim()}
            title="Keep this comment private until you submit your review"
            onClick={() => void submit('review')}
          >
            Start a review
          </button>
        )}
        <button type="submit" className="button button-primary" disabled={busy || !body.trim()}>
          {busy ? 'Posting…' : reviewing ? 'Add review comment' : 'Comment'}
        </button>
      </div>
    </form>
  );
}

function ThreadView({ placed }: { placed: PlacedThread }) {
  const { thread, on } = placed;
  const comments = useComments();
  const { data } = usePull();
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = thread.comments[0];
  if (!first) return null;

  const where: ReactNode =
    thread.line !== null ? (
      <a
        href={diffLineUrl(data.pull, thread.path, thread.line, thread.side === 'LEFT' ? 'L' : 'R')}
        title={`Line ${thread.line} of ${thread.path} in Files changed`}
      >
        {on ? `${on} · ` : ''}line {thread.line}
      </a>
    ) : thread.outdated ? (
      'On an earlier version of this file'
    ) : (
      'On the file as a whole'
    );

  const toggleResolved = async () => {
    setBusy(true);
    setError(null);
    try {
      await comments.setResolved(thread.id, !thread.resolved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work.');
    }
    setBusy(false);
  };

  return (
    <details
      className={thread.resolved ? 'thread is-resolved' : 'thread'}
      open={!thread.resolved && !thread.outdated}
    >
      <summary className="thread-head">
        <ChevronIcon className="chev" />
        <span className="thread-where">{where}</span>
        {thread.resolved && <span className="tag tag-added">Resolved</span>}
        {thread.outdated && <span className="tag">Outdated</span>}
        <span className="thread-count">
          {first.author.login} · {plural(thread.comments.length, 'comment')}
        </span>
        <span className="grow" />
        {comments.canWrite &&
          thread.canResolve &&
          (comments.resolveBlocked ? (
            <a className="icon-button has-label" href={first.url} title={comments.resolveBlocked}>
              {thread.resolved ? 'Unresolve' : 'Resolve'} on GitHub <ExternalIcon size={12} />
            </a>
          ) : (
            <button
              type="button"
              className="icon-button has-label"
              disabled={busy}
              onClick={(event) => {
                // The button sits in the summary: do not fold the thread as well.
                event.preventDefault();
                void toggleResolved();
              }}
            >
              {thread.resolved ? 'Unresolve' : 'Resolve'}
            </button>
          ))}
      </summary>
      <ul className="thread-comments">
        {thread.comments.map((comment) => (
          <CommentView key={comment.id} comment={comment} />
        ))}
      </ul>
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      <div className="thread-foot">
        {replying ? (
          <Composer
            placeholder={`Reply to ${first.author.login}`}
            onCancel={() => setReplying(false)}
            onSubmit={async (body, mode) => {
              await comments.reply(thread.id, body, mode);
              setReplying(false);
            }}
          />
        ) : comments.canWrite && thread.canReply ? (
          <button type="button" className="reply-box" onClick={() => setReplying(true)}>
            Reply…
          </button>
        ) : (
          <a className="quiet-link" href={first.url}>
            Reply on GitHub <ExternalIcon size={12} />
          </a>
        )}
      </div>
    </details>
  );
}

/** The review threads of one place in the tab, and the comment being written there. */
export function Discussion({ region }: { region: string }) {
  const comments = useComments();
  const placed = comments.placement.byRegion.get(region) ?? [];
  const composing = comments.composing?.region === region ? comments.composing : null;
  const notice = comments.notice?.region === region ? comments.notice.text : null;
  if (placed.length === 0 && !composing && !notice) return null;
  // Threads that are settled, or were left on text that has since changed, fold into one line.
  const open = placed.filter((entry) => isOpen(entry.thread));
  const closed = placed.filter((entry) => !isOpen(entry.thread));
  const kinds = [
    closed.some((entry) => entry.thread.resolved) && 'resolved',
    closed.some((entry) => !entry.thread.resolved) && 'outdated',
  ].filter(Boolean);
  return (
    <MarkdownProvider options={PLAIN}>
      <div className="discussion">
        {open.map((entry) => (
          <ThreadView key={entry.thread.id} placed={entry} />
        ))}
        {closed.length > 0 && (
          <details className="thread-archive">
            <summary>
              <ChevronIcon className="chev" />
              {closed.length} {kinds.join(' or ')} {closed.length === 1 ? 'thread' : 'threads'}
            </summary>
            <div className="discussion">
              {closed.map((entry) => (
                <ThreadView key={entry.thread.id} placed={entry} />
              ))}
            </div>
          </details>
        )}
        {notice && (
          <p className="discussion-note">
            {notice}
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss"
              onClick={comments.dismissNotice}
            >
              <CloseIcon size={12} />
            </button>
          </p>
        )}
        {composing && (
          <div className="thread thread-new">
            <div className="thread-head">
              <CommentIcon size={14} />
              <span className="thread-where">
                {composing.target.subject}
                {composing.target.line !== null && ` · line ${composing.target.line}`}
              </span>
            </div>
            <div className="thread-foot">
              <Composer
                placeholder="Leave a comment"
                onCancel={comments.cancel}
                onSubmit={(body, mode) => comments.addThread(composing.target, body, mode)}
              />
            </div>
          </div>
        )}
      </div>
    </MarkdownProvider>
  );
}

/** Opens the composer for `target` in `region`. Renders nothing where comments cannot be written. */
export function CommentTrigger(props: { region: string; target: CommentTarget; label?: string }) {
  const comments = useComments();
  if (!comments.canWrite) return null;
  return (
    <button
      type="button"
      className={
        props.label ? 'icon-button has-label comment-trigger' : 'icon-button comment-trigger'
      }
      title={`Comment on ${props.target.subject}`}
      aria-label={props.label ? undefined : `Comment on ${props.target.subject}`}
      onClick={(event) => {
        // Often inside a <summary>: do not fold what the comment is about.
        event.preventDefault();
        comments.compose(props.region, props.target);
      }}
    >
      <CommentIcon />
      {props.label && <span>{props.label}</span>}
    </button>
  );
}

/** The document (proposal, design or tasks) the blocks inside belong to. */
export const DocContext = createContext<{ id: string; path: string } | null>(null);

/** A comment button for the block of a document that starts at `line`. */
export function BlockComment({ line, subject }: { line: number; subject: string }) {
  const doc = useContext(DocContext);
  if (!doc || line <= 0) return null;
  return (
    <CommentTrigger
      region={regionKey.block(doc.id, line)}
      target={{ path: doc.path, line, side: 'RIGHT', subject }}
    />
  );
}

/** The threads left on the block of a document that starts at `line`. */
export function BlockDiscussion({ line }: { line: number }) {
  const doc = useContext(DocContext);
  if (!doc || line <= 0) return null;
  return <Discussion region={regionKey.block(doc.id, line)} />;
}

/** A block's heading, with the button to comment on the block. */
export function BlockHead(props: { title: ReactNode; line: number; subject: string }) {
  return (
    <div className="block-head">
      <h4>{props.title}</h4>
      <BlockComment line={props.line} subject={props.subject} />
    </div>
  );
}

const VERDICTS: Array<{ event: ReviewEvent; label: string; hint: string }> = [
  { event: 'COMMENT', label: 'Comment', hint: 'General feedback, without explicit approval.' },
  { event: 'APPROVE', label: 'Approve', hint: 'Feedback, and approval to merge.' },
  {
    event: 'REQUEST_CHANGES',
    label: 'Request changes',
    hint: 'Feedback that must be addressed before merging.',
  },
];

/** The dialog that submits the review in progress: a summary, a verdict, the pending comments. */
export function FinishReview({ onClose }: { onClose(): void }) {
  const comments = useComments();
  const ref = useRef<HTMLDialogElement>(null);
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await comments.submitReview(event, body);
      ref.current?.close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The review could not be submitted.');
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="help review-dialog"
      aria-labelledby="openspec-review-title"
      onClose={onClose}
    >
      <header>
        <h2 id="openspec-review-title">Finish your review</h2>
        <button
          type="button"
          className="icon-button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </header>
      <form
        className="help-body review-form"
        onSubmit={(submitted) => {
          submitted.preventDefault();
          void submit();
        }}
      >
        <p className="muted">
          {comments.pending > 0
            ? `${plural(comments.pending, 'pending comment')} will be published, on every file of the pull request.`
            : 'Your review has no pending comments.'}
        </p>
        <textarea
          value={body}
          rows={4}
          placeholder="Leave a summary (optional)"
          aria-label="Summary"
          disabled={busy}
          onChange={(change) => setBody(change.target.value)}
        />
        <fieldset className="verdicts">
          <legend className="sr-only">Verdict</legend>
          {VERDICTS.map((verdict) => (
            <label key={verdict.event}>
              <input
                type="radio"
                name="openspec-review-verdict"
                checked={event === verdict.event}
                onChange={() => setEvent(verdict.event)}
              />
              <span>
                <strong>{verdict.label}</strong>
                <span className="muted">{verdict.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="composer-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-actions">
          <span className="grow" />
          <button
            type="button"
            className="button"
            onClick={() => ref.current?.close()}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
