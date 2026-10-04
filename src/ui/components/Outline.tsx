import { type RefObject, useEffect, useRef } from 'react';
import type { Preferences } from '@/github/messages';
import { useComments } from '../comments';
import { useReview } from '../context';
import {
  BookIcon,
  CheckIcon,
  CommentIcon,
  FileIcon,
  HomeIcon,
  PencilIcon,
  QuestionIcon,
  SearchIcon,
  SpecIcon,
  SyncIcon,
  TasksIcon,
} from '../icons';
import type { OutlineItem } from '../outline';
import { OpDot, ProgressBar, plural } from './common';
import { ReviewBar } from './Discussion';

const ICONS = {
  proposal: BookIcon,
  design: PencilIcon,
  spec: SpecIcon,
  tasks: TasksIcon,
  change: HomeIcon,
  files: FileIcon,
} as const;

const VIEWS: Array<{ value: Preferences['diffView']; label: string; hint: string }> = [
  { value: 'inline', label: 'Inline', hint: 'Changes marked in the text (1)' },
  { value: 'split', label: 'Side by side', hint: 'Old against new (2)' },
  { value: 'new', label: 'New only', hint: 'The new version, without marks (3)' },
];

export function Outline(props: {
  items: OutlineItem[];
  current: string | null;
  filter: string;
  onFilter(value: string): void;
  filterRef: RefObject<HTMLInputElement | null>;
  onSelect(id: string): void;
  view: Preferences['diffView'];
  onView(view: Preferences['diffView']): void;
  progress: { read: number; total: number; stale: number };
  onHelp(): void;
}) {
  const review = useReview();
  const comments = useComments();
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the current item in view inside the outline, without scrolling the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the current item changes, which it finds through the DOM
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !active) return;
    const top = active.offsetTop - list.offsetTop;
    if (top < list.scrollTop + 8) list.scrollTop = Math.max(0, top - 8);
    else if (top + active.offsetHeight > list.scrollTop + list.clientHeight - 8) {
      list.scrollTop = top + active.offsetHeight - list.clientHeight + 8;
    }
  }, [props.current]);

  return (
    <nav className="outline" aria-label="OpenSpec outline">
      <div className="outline-progress">
        <div className="outline-progress-text">
          <strong>
            {props.progress.read} of {props.progress.total}
          </strong>{' '}
          read
          {props.progress.stale > 0 && (
            <span className="stale-note"> · {props.progress.stale} changed since</span>
          )}
        </div>
        <ProgressBar
          done={props.progress.read}
          total={props.progress.total}
          label="Review progress"
        />
      </div>

      <ReviewBar />

      <fieldset className="segmented">
        <legend className="sr-only">How modified requirements are shown</legend>
        {VIEWS.map((view) => (
          <label
            key={view.value}
            title={view.hint}
            className={props.view === view.value ? 'is-selected' : undefined}
          >
            <input
              type="radio"
              name="openspec-diff-view"
              value={view.value}
              checked={props.view === view.value}
              onChange={() => props.onView(view.value)}
            />
            {view.label}
          </label>
        ))}
      </fieldset>

      <label className="filter">
        <SearchIcon size={14} />
        <span className="sr-only">Filter the outline</span>
        <input
          ref={props.filterRef}
          type="search"
          placeholder="Filter"
          value={props.filter}
          onChange={(event) => props.onFilter(event.target.value)}
        />
        <kbd data-key="/" />
      </label>

      <div className="outline-list" ref={listRef}>
        {props.items.length === 0 && <p className="muted outline-empty">Nothing matches.</p>}
        <ul>
          {props.items.map((item) => {
            const Icon = item.icon ? ICONS[item.icon] : null;
            const status = item.hash ? review.statusOf(item.id, item.hash) : null;
            const open = comments.placement.openByItem.get(item.id) ?? 0;
            return (
              <li key={item.id}>
                <a
                  href={`#openspec/${item.id}`}
                  className={`outline-item depth-${item.depth}${status === 'read' ? ' is-read' : ''}`}
                  aria-current={props.current === item.id ? 'true' : undefined}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                      return;
                    event.preventDefault();
                    props.onSelect(item.id);
                  }}
                >
                  {item.op ? <OpDot op={item.op} /> : Icon ? <Icon size={14} /> : null}
                  <span className="outline-label">{item.label}</span>
                  {open > 0 && (
                    <span
                      className="outline-comments"
                      title={`${plural(open, 'open review thread')}`}
                    >
                      <CommentIcon size={12} />
                      {open}
                    </span>
                  )}
                  {item.meta && <span className="outline-meta">{item.meta}</span>}
                  {status === 'read' && (
                    <span className="outline-read" role="img" aria-label="Read">
                      <CheckIcon size={12} />
                    </span>
                  )}
                  {status === 'stale' && (
                    <span
                      className="outline-stale"
                      role="img"
                      aria-label="Changed since you read it"
                    >
                      <SyncIcon size={12} />
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </div>

      <button type="button" className="outline-help" onClick={props.onHelp}>
        <QuestionIcon size={14} />
        Keyboard shortcuts
        <kbd data-key="?" />
      </button>
    </nav>
  );
}
