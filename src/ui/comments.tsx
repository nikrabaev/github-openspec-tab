import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CommentMode, CommentsSnapshot, CommentTarget, ReviewEvent } from '@/github/comments';
import { type Placement, placeThreads, regionsOf } from '@/github/placement';
import type { PrModel } from '@/openspec';
import type { CommentServices } from './context';

/** Review comments as the tab sees them: where each thread goes, and what the reader can do. */
export interface CommentsValue {
  /** `off`: the host has no comments to offer. */
  status: 'off' | 'loading' | 'ready' | 'error';
  snapshot: CommentsSnapshot | null;
  placement: Placement;
  /** Comments can be written from the tab: a token is set and GitHub knows whose it is. */
  canWrite: boolean;
  /** The reader has a review in progress: whatever they write joins it. */
  reviewing: boolean;
  /** Comments of that review, on any file of the pull request, that nobody else sees yet. */
  pending: number;
  /** Something the reader should know about the place a comment went to. */
  notice: { region: string; text: string } | null;
  dismissNotice(): void;
  /** The comment being written, and the place of the tab it is shown in. */
  composing: { region: string; target: CommentTarget } | null;
  compose(region: string, target: CommentTarget): void;
  cancel(): void;
  addThread(target: CommentTarget, body: string, mode: CommentMode): Promise<void>;
  reply(threadId: string, body: string, mode: CommentMode): Promise<void>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
  submitReview(event: ReviewEvent, body: string): Promise<void>;
  /** Why the threads could not be read, when they could not. */
  loadError: string | null;
}

const EMPTY: Placement = { byRegion: new Map(), openByItem: new Map() };
const unavailable = () => Promise.reject(new Error('Comments are not available here.'));

const OFF: CommentsValue = {
  status: 'off',
  snapshot: null,
  placement: EMPTY,
  canWrite: false,
  reviewing: false,
  pending: 0,
  notice: null,
  dismissNotice: () => {},
  composing: null,
  compose: () => {},
  cancel: () => {},
  addThread: unavailable,
  reply: unavailable,
  setResolved: unavailable,
  submitReview: unavailable,
  loadError: null,
};

export const CommentsContext = createContext<CommentsValue>(OFF);
export const useComments = () => useContext(CommentsContext);

/** Threads read again when the reader comes back to the page after this long. */
const STALE_AFTER = 60_000;

/** Loads the review threads of the pull request and keeps them current after each write. */
export function useCommentsState(
  model: PrModel,
  services: CommentServices | undefined,
): CommentsValue {
  const [snapshot, setSnapshot] = useState<CommentsSnapshot | null>(services?.initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composing, setComposing] = useState<CommentsValue['composing']>(null);
  const [notice, setNotice] = useState<CommentsValue['notice']>(null);
  const loadedAt = useRef(0);
  const latest = useRef(snapshot);
  latest.current = snapshot;

  const refresh = useCallback(async () => {
    if (!services) return;
    try {
      const next = await services.load();
      loadedAt.current = Date.now();
      setSnapshot(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The comments could not be read.');
    }
  }, [services]);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > STALE_AFTER) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const regions = useMemo(() => regionsOf(model), [model]);
  const placement = useMemo(
    () => (snapshot ? placeThreads(regions, snapshot.threads) : EMPTY),
    [regions, snapshot],
  );

  return useMemo<CommentsValue>(() => {
    if (!services) return OFF;
    /** Runs a write against the threads as last read, then reads them again. */
    const write = async <T,>(action: (current: CommentsSnapshot) => Promise<T>): Promise<T> => {
      const current = latest.current;
      if (!current) throw new Error('The comments are still loading.');
      try {
        return await action(current);
      } finally {
        // Whether it worked or not, show what GitHub holds now.
        await refresh();
      }
    };
    return {
      status: snapshot ? 'ready' : loadError ? 'error' : 'loading',
      snapshot,
      placement,
      canWrite: Boolean(snapshot?.viewer && snapshot.pullRequestId),
      reviewing: Boolean(snapshot?.pendingReviewId),
      pending: (snapshot?.threads ?? [])
        .flatMap((thread) => thread.comments)
        .filter((comment) => comment.pending).length,
      notice,
      dismissNotice: () => setNotice(null),
      composing,
      compose: (region, target) => {
        setNotice(null);
        setComposing({ region, target });
      },
      cancel: () => setComposing(null),
      async addThread(target, body, mode) {
        const region = composing?.region;
        const { movedToFile } = await write((current) =>
          services.addThread(current, target, body, mode),
        );
        setComposing(null);
        if (movedToFile && region) {
          setNotice({
            region,
            text: 'GitHub takes a line comment only on a line of the diff, so your comment was left on the file as a whole. It is shown with the file, above.',
          });
        }
      },
      reply: (threadId, body, mode) =>
        write((current) => services.reply(current, threadId, body, mode)),
      setResolved: (threadId, resolved) => write(() => services.setResolved(threadId, resolved)),
      submitReview: (event, body) =>
        write((current) => services.submitReview(current, event, body)),
      loadError,
    };
  }, [services, snapshot, placement, composing, notice, loadError, refresh]);
}
