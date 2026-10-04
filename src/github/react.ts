/**
 * Asking GitHub's React whether it has taken over a piece of the page.
 *
 * A React page arrives as server HTML, which React then walks node by node to
 * attach itself (hydration). It does that in parts, some of them only after
 * more code has loaded, and a part that finds an element it did not render is
 * thrown away and rendered again from scratch. So nothing may be added to an
 * element before React has mounted it.
 *
 * React keeps its bookkeeping in properties on the DOM nodes, which a content
 * script cannot see: it has its own view of the page's objects. `react-probe`
 * runs `answerMountedQueries` in the page's own world, and the content script
 * asks through a DOM event, the one thing both worlds share. The answer is the
 * event being cancelled, so asking is synchronous and changes nothing on the page.
 */

const QUERY = 'openspec-tab:react-mounted';
const FIBER_KEY = '__reactFiber$';

/** The fields of React's internal tree nodes that the check reads. */
interface Fiber {
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  stateNode: unknown;
}

function fiberOf(element: Element): Fiber | null {
  const key = Object.keys(element).find((name) => name.startsWith(FIBER_KEY));
  return key ? ((element as unknown as Record<string, Fiber | undefined>)[key] ?? null) : null;
}

/**
 * Whether the element belongs to the tree React has on the page. Having a
 * fiber is not enough: React gives an element its fiber while it is still
 * working through the server's HTML, and may start that work over.
 *
 * Runs in the page's world.
 */
export function isMounted(element: Element): boolean {
  const path: Fiber[] = [];
  for (let fiber = fiberOf(element); fiber; fiber = fiber.return) path.push(fiber);
  const top = path.pop();
  if (!top) return false;
  // The topmost fiber's `stateNode` is the root, whose `current` is the tree on the page.
  // React keeps two copies of every fiber and the path may run through either.
  const current = (top.stateNode as { current?: Fiber } | null)?.current;
  if (!current || (current !== top && current !== top.alternate)) return false;

  // Walk the path back down through the tree on the page. Under a part React
  // has not mounted yet that tree has no children, and the walk ends early.
  let fiber: Fiber | null = current;
  for (let next = path.pop(); fiber && next; next = path.pop()) {
    let child: Fiber | null = fiber.child;
    while (child && child !== next && child !== next.alternate) child = child.sibling;
    fiber = child;
  }
  return fiber !== null;
}

/** Page side: answer the content script's questions. */
export function answerMountedQueries(): void {
  document.addEventListener(
    QUERY,
    (event) => {
      if (event.target instanceof Element && isMounted(event.target)) event.preventDefault();
    },
    true,
  );
}

/**
 * Content script side: whether React has mounted the element. False as well
 * when the page script is not there to answer.
 */
export function isMountedByReact(element: Element): boolean {
  return !element.dispatchEvent(new CustomEvent(QUERY, { cancelable: true }));
}
