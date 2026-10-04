import { type KeyboardEvent, type PointerEvent, type RefObject, useRef, useState } from 'react';
import { DEFAULT_PREFERENCES } from '@/github/messages';

/** The narrowest the outline's controls still fit in, and the widest a long name needs. */
const MIN = 220;
const MAX = 600;
/** The outline takes at most this share of the page. The same number is in `.layout`'s columns. */
const SHARE = 0.4;
/** How far one press of an arrow key moves the edge. */
const STEP = 16;

/** The width the outline gets for a wanted one, on a page that is `room` pixels wide. */
export function fitOutlineWidth(wanted: number, room: number): number {
  const most = Math.max(MIN, Math.min(MAX, Math.floor(room * SHARE)));
  return Math.round(Math.max(MIN, Math.min(most, wanted)));
}

/**
 * The edge between the outline and the content. Dragging it, or the arrow keys while it has
 * the focus, make the outline wider or narrower; a double click puts it back.
 */
export function OutlineResizer(props: {
  width: number;
  /** The grid the outline is a column of: it carries the width as `--outline-width`. */
  layout: RefObject<HTMLElement | null>;
  onResize(width: number): void;
}) {
  // Where the drag started, and the width it has reached once the pointer has moved.
  const drag = useRef<{ x: number; from: number; forward: number; width: number | null } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  const fitted = (wanted: number) =>
    fitOutlineWidth(wanted, props.layout.current?.clientWidth ?? Number.POSITIVE_INFINITY);
  // While dragging, the width goes straight to the page: rendering the whole tab again on
  // every move would make the edge lag behind the pointer.
  const show = (width: number) =>
    props.layout.current?.style.setProperty('--outline-width', `${width}px`);
  /** 1 when the outline grows to the right, -1 on a right-to-left page. */
  const forward = (element: Element) => (getComputedStyle(element).direction === 'rtl' ? -1 : 1);

  const onPointerDown = (event: PointerEvent<HTMLHRElement>) => {
    if (event.button !== 0) return;
    // No text gets selected while the pointer crosses the page.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      from: fitted(props.width),
      forward: forward(event.currentTarget),
      width: null,
    };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLHRElement>) => {
    const state = drag.current;
    if (!state) return;
    state.width = fitted(state.from + (event.clientX - state.x) * state.forward);
    show(state.width);
  };

  const finish = (keep: boolean) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    setDragging(false);
    if (keep && state.width !== null) props.onResize(state.width);
    else show(props.width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    // With a modifier the arrows are the browser's: back and forward, for one.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = STEP * forward(event.currentTarget);
    const shown = fitted(props.width);
    const targets: Record<string, number> = {
      ArrowRight: shown + step,
      ArrowLeft: shown - step,
      Home: MIN,
      End: MAX,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    props.onResize(fitted(next));
  };

  return (
    <hr
      className={`outline-resizer${dragging ? ' is-dragging' : ''}`}
      aria-orientation="vertical"
      aria-label="Outline width"
      aria-valuenow={props.width}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      title="Drag to resize the outline. Double-click to reset."
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(true)}
      // Also how a drag ends when the browser takes the pointer away: the width goes back.
      onLostPointerCapture={() => finish(false)}
      onDoubleClick={() => props.onResize(DEFAULT_PREFERENCES.outlineWidth)}
      onKeyDown={onKeyDown}
    />
  );
}
