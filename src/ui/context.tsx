import { createContext, useContext } from 'react';
import type { CommentMode, CommentsSnapshot, CommentTarget, ReviewEvent } from '@/github/comments';
import type { LoadedPull } from '@/github/load';
import type { Preferences, ReviewState } from '@/github/messages';
import type { GlossaryIndex } from '@/openspec';

/**
 * Review comments, as the host provides them. Writes reject with an `Error`
 * whose message can be shown to the reader; after a write the tab loads the
 * threads again, so what it shows is always what GitHub holds.
 */
export interface CommentServices {
  /** Shown until `load` answers: the dev harness and the tests have the threads at hand. */
  initial?: CommentsSnapshot;
  load(): Promise<CommentsSnapshot>;
  addThread(
    snapshot: CommentsSnapshot,
    target: CommentTarget,
    body: string,
    mode: CommentMode,
  ): Promise<{ movedToFile: boolean }>;
  reply(
    snapshot: CommentsSnapshot,
    threadId: string,
    body: string,
    mode: CommentMode,
  ): Promise<void>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
  submitReview(snapshot: CommentsSnapshot, event: ReviewEvent, body: string): Promise<void>;
}

/** What the tab needs from its host: the extension in production, stubs in the harness. */
export interface Services {
  loadReview(key: string): Promise<ReviewState | null>;
  saveReview(key: string, state: ReviewState): Promise<void>;
  loadPreferences(): Promise<Preferences>;
  savePreferences(preferences: Preferences): Promise<void>;
  openOptions(): void;
  /** Point the URL at an item (or at the tab itself), without leaving the page. */
  navigate(target: string | null): void;
  /** Load the pull request again, e.g. after the token was added. */
  reload(): void;
  /** Absent where review comments are not available. */
  comments?: CommentServices;
}

export interface PullContextValue {
  data: LoadedPull;
  glossary: GlossaryIndex;
  services: Services;
  /** Jump to an item: scrolls to it and updates the URL. */
  goTo(id: string): void;
}

export const PullContext = createContext<PullContextValue | null>(null);

export function usePull(): PullContextValue {
  const value = useContext(PullContext);
  if (!value) throw new Error('PullContext is missing');
  return value;
}

export interface ReviewContextValue {
  /** `read`: marked and unchanged. `stale`: marked, but the content changed since. */
  statusOf(id: string, hash: string): 'unread' | 'read' | 'stale';
  toggle(id: string, hash: string): void;
}

export const ReviewContext = createContext<ReviewContextValue>({
  statusOf: () => 'unread',
  toggle: () => {},
});

export const useReview = () => useContext(ReviewContext);

export const DiffViewContext = createContext<Preferences['diffView']>('inline');
export const useDiffView = () => useContext(DiffViewContext);
