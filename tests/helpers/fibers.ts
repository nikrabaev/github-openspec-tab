/**
 * Stand-ins for React's internal tree nodes, with the few fields the extension
 * reads. React keeps two copies of its tree (each fiber's `alternate` is its
 * other copy) and the root's `current` names the copy that is on the page.
 */
export interface Fiber {
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  stateNode: unknown;
}

export interface Root {
  current: Fiber;
}

export function fiber(stateNode: unknown = null): Fiber {
  return { return: null, child: null, sibling: null, alternate: null, stateNode };
}

/** Make `children` the children of `parent`, in order. */
export function link(parent: Fiber, ...children: Fiber[]): Fiber {
  parent.child = children[0] ?? null;
  children.forEach((child, index) => {
    child.return = parent;
    child.sibling = children[index + 1] ?? null;
  });
  return parent;
}

/** The other copy of a fiber, as React makes one when it renders again. */
export function copy(original: Fiber): Fiber {
  const other = { ...original, alternate: original };
  original.alternate = other;
  return other;
}

/** A root with nothing on the page yet. */
export function root(): Root {
  const top = fiber();
  const created: Root = { current: top };
  top.stateNode = created;
  return created;
}

/** Give the element its fiber, the way React does: as a property with a random suffix. */
export function attach(element: Element, to: Fiber): Fiber {
  (element as unknown as Record<string, Fiber>).__reactFiber$t3st = to;
  to.stateNode = element;
  return to;
}

/** A tree on the page that contains the element. */
export function mount(element: Element): Root {
  const created = root();
  link(created.current, link(fiber(), fiber(), attach(element, fiber())));
  return created;
}
