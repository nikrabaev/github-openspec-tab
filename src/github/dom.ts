/**
 * The few places where the extension touches GitHub's own DOM: finding the
 * pull request tab bar, adding a tab to it and hiding the page content while
 * our tab is open.
 *
 * GitHub serves two tab bars today, a React one and the classic one. Both are
 * found by their accessible name, which is the most stable thing about them
 * (Refined GitHub keys on the same labels), and the new tab is a clone of a
 * native one, so it picks up whatever class names that build of GitHub uses.
 */

const TAB_ATTRIBUTE = 'data-openspec-tab';
const COUNT_ATTRIBUTE = 'data-openspec-count';
const HIDDEN_ATTRIBUTE = 'data-openspec-hidden';
const COMPACT_ATTRIBUTE = 'data-openspec-compact';
const WAS_SELECTED = 'data-openspec-was-selected';
const STYLE_ID = 'openspec-tab-page-style';

const NAV_SELECTOR = [
  'nav[aria-label^="Pull request navigation"]',
  'nav[aria-label="Pull request tabs"]',
].join(', ');
const COUNTER_SELECTOR = '[data-component="CounterLabel"], .Counter';
const SELECTED_SELECTOR = '[aria-current="page"], .selected';

const ICON_PATHS = [
  'M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5ZM2 1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25V1.75Z',
  'M5 4.75A.75.75 0 0 1 5.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 4.75Zm0 3A.75.75 0 0 1 5.75 7h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 7.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z',
];

/** Rules that must apply to GitHub's page itself, outside our shadow root. */
export function ensurePageStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${HIDDEN_ATTRIBUTE}] { display: none !important; }
    /* GitHub reserves the height of the content we hide; give it back so the tab sits under the header. */
    [${COMPACT_ATTRIBUTE}] { min-height: 0 !important; }
    /* The classic sticky PR header would sit on top of the tab's own sticky outline. */
    html[data-openspec-active] .gh-header-sticky { display: none !important; }
  `;
  (document.head ?? document.documentElement).append(style);
}

/** The pull request tab bar, in either of GitHub's two page versions. */
export function findTabNav(): HTMLElement | null {
  return document.querySelector<HTMLElement>(NAV_SELECTOR);
}

const nativeTabs = (nav: HTMLElement) =>
  [...nav.querySelectorAll<HTMLAnchorElement>('a')].filter((a) => !a.hasAttribute(TAB_ATTRIBUTE));

/** Class names a selected tab has that an unselected one does not. */
function selectedClasses(nav: HTMLElement): string[] {
  const tabs = nativeTabs(nav);
  const selected = tabs.find((tab) => tab.matches(SELECTED_SELECTOR));
  const other = tabs.find((tab) => !tab.matches(SELECTED_SELECTOR));
  if (!selected || !other) return [];
  return [...selected.classList].filter((name) => !other.classList.contains(name));
}

function createTab(nav: HTMLElement): HTMLAnchorElement | null {
  const tabs = nativeTabs(nav);
  const filesTab =
    nav.querySelector<HTMLAnchorElement>('a#prs-files-anchor-tab') ??
    tabs.find((tab) => /\/(files|changes)$/.test(new URL(tab.href, location.href).pathname)) ??
    tabs[tabs.length - 1];
  if (!filesTab) return null;

  const tab = filesTab.cloneNode(true) as HTMLAnchorElement;
  tab.setAttribute(TAB_ATTRIBUTE, '');
  tab.removeAttribute('id');
  tab.removeAttribute('aria-current');
  tab.removeAttribute('data-discover');
  tab.removeAttribute('data-hotkey');
  tab.classList.remove(...selectedClasses(nav));
  for (const element of tab.querySelectorAll('[id]')) element.removeAttribute('id');
  // Screen-reader-only duplicates of the counter: the tab gets its own label instead.
  for (const element of tab.querySelectorAll('[class*="VisuallyHidden"], .sr-only'))
    element.remove();

  // The label: reuse the first text node so the spacing around it stays native.
  const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
  let labelled = false;
  const stray: Text[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data.trim() || node.parentElement?.closest(COUNTER_SELECTOR)) continue;
    if (labelled) stray.push(node);
    else {
      node.data = node.data.replace(/\S(?:[\s\S]*\S)?/, 'OpenSpec');
      labelled = true;
    }
  }
  for (const node of stray) node.remove();
  if (!labelled) tab.append('OpenSpec');

  const svg = tab.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute(
      'class',
      (svg.getAttribute('class') ?? '').replace(/octicon-[\w-]+/g, '').trim(),
    );
    svg.replaceChildren(
      ...ICON_PATHS.map((d) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        return path;
      }),
    );
  }

  // The counter: keep the cloned one, or borrow the look of another tab's.
  let counter = tab.querySelector<HTMLElement>(COUNTER_SELECTOR);
  for (const extra of [...tab.querySelectorAll(COUNTER_SELECTOR)].slice(1)) extra.remove();
  if (!counter) {
    const model = nav.querySelector<HTMLElement>(COUNTER_SELECTOR);
    counter =
      (model?.cloneNode(false) as HTMLElement | undefined) ?? document.createElement('span');
    if (!model) counter.className = 'Counter';
    counter.removeAttribute('id');
    counter.removeAttribute('title');
    tab.append(' ', counter);
  }
  counter.removeAttribute('id');
  counter.removeAttribute('title');
  counter.setAttribute(COUNT_ATTRIBUTE, '');
  counter.setAttribute('aria-hidden', 'true');
  counter.textContent = '';
  counter.hidden = true;

  filesTab.after(tab);
  return tab;
}

/** The OpenSpec tab, created right after "Files changed" when it is not there yet. */
export function ensureTab(nav: HTMLElement, href: string, onClick: (event: MouseEvent) => void) {
  let tab = nav.querySelector<HTMLAnchorElement>(`a[${TAB_ATTRIBUTE}]`);
  if (!tab) {
    tab = createTab(nav);
    tab?.addEventListener('click', onClick);
  }
  if (tab && tab.getAttribute('href') !== href) tab.setAttribute('href', href);
  return tab;
}

/** Show a number on the tab, or hide the counter while it is not known. */
export function setTabCount(tab: HTMLElement, count: number | null, description: string): void {
  const counter = tab.querySelector<HTMLElement>(`[${COUNT_ATTRIBUTE}]`);
  const text = count === null ? '' : String(count);
  if (counter && counter.textContent !== text) counter.textContent = text;
  if (counter && counter.hidden !== (count === null)) counter.hidden = count === null;
  if (tab.title !== description) tab.title = description;
  if (tab.getAttribute('aria-label') !== description) tab.setAttribute('aria-label', description);
}

const samePath = (href: string) => new URL(href, location.href).pathname === location.pathname;

/** Make our tab look selected and the native one not, or put things back. */
export function setTabSelected(nav: HTMLElement, tab: HTMLElement, selected: boolean): void {
  if (selected) {
    const classes = selectedClasses(nav);
    if (classes.length > 0) tab.dataset.openspecSelected = classes.join(' ');
    for (const native of nativeTabs(nav)) {
      if (!native.matches(SELECTED_SELECTOR)) continue;
      native.setAttribute(WAS_SELECTED, classes.join(' '));
      native.classList.remove(...classes);
      native.removeAttribute('aria-current');
    }
    const own = (tab.dataset.openspecSelected ?? 'selected').split(' ').filter(Boolean);
    if (!own.every((name) => tab.classList.contains(name))) tab.classList.add(...own);
    if (tab.getAttribute('aria-current') !== 'page') tab.setAttribute('aria-current', 'page');
    return;
  }

  if (tab.hasAttribute('aria-current')) {
    tab.classList.remove(
      ...(tab.dataset.openspecSelected ?? 'selected').split(' ').filter(Boolean),
    );
    tab.removeAttribute('aria-current');
  }
  for (const native of nav.querySelectorAll<HTMLAnchorElement>(`a[${WAS_SELECTED}]`)) {
    const classes = (native.getAttribute(WAS_SELECTED) ?? '').split(' ').filter(Boolean);
    native.removeAttribute(WAS_SELECTED);
    // Only when the page under our tab is still this tab's page. After a real
    // navigation GitHub has already marked the right tab itself.
    if (
      samePath(native.href) &&
      !nativeTabs(nav).some((other) => other.matches(SELECTED_SELECTOR))
    ) {
      native.classList.add(...classes);
      native.setAttribute('aria-current', 'page');
    }
  }
}

/** The container whose content our tab replaces: the Turbo frame of the repository page. */
export function findBoundary(nav: HTMLElement): HTMLElement {
  return (
    nav.closest<HTMLElement>('turbo-frame') ?? nav.closest<HTMLElement>('main') ?? document.body
  );
}

/**
 * Hide everything that follows the tab bar inside the boundary: the native tab
 * content, whatever its markup. Elements are only hidden, never removed, so
 * GitHub's own scripts keep working and everything comes back untouched.
 */
export function hideNativeContent(
  nav: HTMLElement,
  boundary: HTMLElement,
  keep: Element | null,
): void {
  for (
    let element: HTMLElement | null = nav;
    element && element !== boundary;
    element = element.parentElement
  ) {
    if (element !== nav && !element.hasAttribute(COMPACT_ATTRIBUTE))
      element.setAttribute(COMPACT_ATTRIBUTE, '');
    for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (sibling === keep || sibling.hasAttribute(HIDDEN_ATTRIBUTE)) continue;
      if (/^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(sibling.tagName)) continue;
      sibling.setAttribute(HIDDEN_ATTRIBUTE, '');
    }
  }
}

export function showNativeContent(): void {
  for (const element of document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)) {
    element.removeAttribute(HIDDEN_ATTRIBUTE);
  }
  for (const element of document.querySelectorAll(`[${COMPACT_ATTRIBUTE}]`)) {
    element.removeAttribute(COMPACT_ATTRIBUTE);
  }
}

export function removeTab(): void {
  for (const tab of document.querySelectorAll(`a[${TAB_ATTRIBUTE}]`)) tab.remove();
}

/**
 * Line the tab up with the tab bar above it. GitHub centres some pull request
 * pages in a fixed-width column and lets others (Files changed) use the full
 * width; taking the gutters from the tab bar follows whichever is in use.
 */
export function alignWithNav(nav: HTMLElement, host: HTMLElement): void {
  const rect = nav.getBoundingClientRect();
  if (rect.width === 0) return;
  const start = `${Math.max(0, Math.round(rect.left))}px`;
  const end = `${Math.max(0, Math.round(document.documentElement.clientWidth - rect.right))}px`;
  if (
    host.style.getPropertyValue('--openspec-gutter-start') === start &&
    host.style.getPropertyValue('--openspec-gutter-end') === end
  ) {
    return;
  }
  host.style.setProperty('--openspec-gutter-start', start);
  host.style.setProperty('--openspec-gutter-end', end);
  host.style.setProperty('--openspec-max-width', 'none');
}
