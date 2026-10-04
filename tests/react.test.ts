// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { answerMountedQueries, isMounted, isMountedByReact } from '../src/github/react';
import { attach, copy, fiber, link, mount, root } from './helpers/fibers';

let element: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="list"></div>';
  element = document.querySelector('#list') as HTMLElement;
});

describe('whether React has mounted an element', () => {
  it('has not when the element has no fiber', () => {
    expect(isMounted(element)).toBe(false);
  });

  it('has when the element is in the tree on the page', () => {
    mount(element);
    expect(isMounted(element)).toBe(true);
  });

  it('has not while React is still taking over the server HTML', () => {
    // On the page: a boundary whose content React has not attached itself to.
    const page = root();
    const boundary = fiber();
    link(page.current, boundary);
    // In progress: a copy of the tree in which the boundary has its content.
    const working = copy(page.current);
    const hydrating = copy(boundary);
    link(working, link(hydrating, attach(element, fiber())));
    expect(isMounted(element)).toBe(false);

    // React commits: the copy it worked on is the tree on the page now.
    page.current = working;
    expect(isMounted(element)).toBe(true);
  });

  it('has not during the very first render of a root', () => {
    const page = root();
    link(copy(page.current), attach(element, fiber()));
    expect(isMounted(element)).toBe(false);
  });

  it('still has after React rendered again and the path runs through old copies', () => {
    const page = mount(element);
    const parent = page.current.child as NonNullable<typeof page.current.child>;
    // A later render: new copies of the root and the parent become current,
    // while the element's fiber keeps pointing up at the old ones.
    const newTop = copy(page.current);
    const newParent = copy(parent);
    newTop.child = newParent;
    newParent.return = newTop;
    page.current = newTop;
    expect(isMounted(element)).toBe(true);
  });

  it('has not when the fiber is not connected to a root', () => {
    link(fiber(), attach(element, fiber()));
    expect(isMounted(element)).toBe(false);
  });
});

describe('asking from the content script', () => {
  it('gets no for an answer while the page script is not there', () => {
    mount(element);
    expect(isMountedByReact(element)).toBe(false);
  });

  it('gets the page script’s answer', () => {
    answerMountedQueries();
    expect(isMountedByReact(element)).toBe(false);
    mount(element);
    expect(isMountedByReact(element)).toBe(true);
  });
});
