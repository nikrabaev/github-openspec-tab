import { type RefObject, useEffect, useRef } from 'react';
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
import { OpDot, plural } from './common';

const ICONS = {
  proposal: BookIcon,
  design: PencilIcon,
  spec: SpecIcon,
  tasks: TasksIcon,
  change: HomeIcon,
  files: FileIcon,
} as const;

export function Outline(props: {
  items: OutlineItem[];
  current: string | null;
  filter: string;
  onFilter(value: string): void;
  filterRef: RefObject<HTMLInputElement | null>;
  onSelect(id: string): void;
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
