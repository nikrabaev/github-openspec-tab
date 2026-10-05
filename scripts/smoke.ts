/**
 * Manual smoke test against the live site: loads the built extension in
 * Chromium, opens a public pull request and exercises the tab. Not part of
 * `pnpm test`, because it depends on GitHub's current markup and on network.
 *
 *   pnpm build && pnpm exec tsx scripts/smoke.ts [pull request URL] [output dir]
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://github.com/Fission-AI/OpenSpec/pull/2012';
const out = process.argv[3] ?? mkdtempSync(join(tmpdir(), 'openspec-tab-smoke-'));
mkdirSync(out, { recursive: true });
const extension = join(import.meta.dirname, '..', '.output', 'chrome-mv3');

const context = await chromium.launchPersistentContext(
  mkdtempSync(join(tmpdir(), 'openspec-tab-profile-')),
  {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  },
);

const steps: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => {
  steps.push([name, ok]);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
};

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && /openspec/i.test(message.text()))
      problems.push(message.text());
  });

  // In the page: how often the tab is added, and what GitHub had on the page when it first was
  // (everything that follows the tab bar, the way the tab hides it).
  // (Kept free of named inner functions: tsx wraps those in a helper the page does not have.)
  await page.addInitScript(() => {
    const seen = { added: 0, content: [] as Element[] };
    (window as unknown as { openspecSmoke: typeof seen }).openspecSmoke = seen;
    new MutationObserver((records) => {
      for (const node of records.flatMap((record) => [...record.addedNodes])) {
        if (!(node instanceof Element)) continue;
        const added = node.matches('a[data-openspec-tab]')
          ? node
          : node.querySelector('a[data-openspec-tab]');
        if (!added || ++seen.added > 1) continue;
        for (
          let element = added.closest('nav');
          element && !element.matches('turbo-frame, main');
          element = element.parentElement
        ) {
          for (let next = element.nextElementSibling; next; next = next.nextElementSibling)
            seen.content.push(next);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const tab = page.locator('a[data-openspec-tab]');
  await tab.waitFor({ timeout: 20_000 });
  check('tab is added to the pull request tab bar', true);
  const previous = await tab.evaluate(
    (element) => element.previousElementSibling?.textContent?.trim() ?? '',
  );
  check(
    `tab sits right after "Files changed" (after: ${previous.slice(0, 30)})`,
    /Files changed/.test(previous),
  );
  await page.screenshot({ path: join(out, '1-conversation.png') });

  // A tab added before GitHub's React has taken over the server's HTML makes React throw the
  // page content away and render it again. Give React time to get there, then look.
  await page.waitForFunction(
    () => {
      const list = document.querySelector('a[data-openspec-tab]')?.parentElement;
      return (
        !list?.closest('react-app, react-partial') ||
        Object.keys(list).some((key) => key.startsWith('__reactFiber$'))
      );
    },
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => {
    const { added, content } = (
      window as unknown as { openspecSmoke: { added: number; content: Element[] } }
    ).openspecSmoke;
    return { added, total: content.length, kept: content.filter((e) => e.isConnected).length };
  });
  check(
    `page content is not re-added after the tab is inserted (${seen.kept} of ${seen.total} elements kept, tab added ${seen.added}×)`,
    seen.total > 0 && seen.kept === seen.total && seen.added === 1,
  );

  const counter = tab.locator('[data-openspec-count]');
  await counter.filter({ hasText: /\d/ }).waitFor({ timeout: 30_000 });
  check(`tab shows a count (${await counter.textContent()})`, true);

  await tab.click();
  await page.locator('openspec-tab').waitFor({ timeout: 15_000 });
  await page
    .locator('openspec-tab .overview, openspec-tab .blank')
    .first()
    .waitFor({ timeout: 30_000 });
  check('clicking the tab shows the reading view', true);
  check('URL carries the tab in its hash', page.url().endsWith('#openspec'));
  check('our tab is marked current', (await tab.getAttribute('aria-current')) === 'page');
  const hidden = await page.locator('[data-openspec-hidden]').count();
  check(`native content is hidden (${hidden} elements)`, hidden > 0);
  // The stylesheet is bundled into the content script; this fails if it did not reach the tab.
  const display = await page
    .locator('openspec-tab .layout')
    .evaluate((element) => getComputedStyle(element).display);
  check(`the tab is styled (layout is ${display})`, display === 'grid');
  await page.screenshot({ path: join(out, '2-openspec-tab.png') });

  // The loading skeleton has a layout, an outline and cards too: this is the reading view only.
  const view = 'openspec-tab .layout:not([aria-busy])';

  // The outline's edge is dragged to resize it, and the background script keeps the width.
  const outlineWidth = () =>
    page
      .locator(`${view} .outline`)
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));
  const edge = await page.locator('openspec-tab .outline-resizer').boundingBox();
  const before = await outlineWidth();
  if (edge) {
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + 90, edge.y + 240, { steps: 5 });
    await page.mouse.up();
  }
  const resized = await outlineWidth();
  check(`dragging the outline's edge resizes it (${before} → ${resized})`, resized === before + 90);

  // Review comments are read without a token here (a public repository, through REST).
  await page.waitForTimeout(2500);
  const missing = await page.getByText('Review comments are missing').count();
  const threads = await page.locator('openspec-tab .thread').count();
  check(`review comments were read (${threads} threads shown)`, missing === 0);
  if (threads > 0) {
    await page.locator('openspec-tab .thread').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, '2b-review-threads.png') });
    const writable = await page.locator('openspec-tab .comment-trigger').count();
    check('without a token nothing offers to write', writable === 0);
  }

  const firstCard = page.locator('openspec-tab .req').first();
  if (await firstCard.count()) {
    await firstCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, '3-requirements.png') });
    // Scroll into the card: the tab's pull request header is fixed to the top of the window,
    // and the section's header and the card's own must stay in view below it, which GitHub's
    // page could prevent (a clipping ancestor, a bar of its own painted over ours).
    await firstCard.evaluate((card) => {
      window.scrollTo({ top: window.scrollY + card.getBoundingClientRect().top - 20 });
    });
    await page.waitForTimeout(300);
    const fixed = await page.locator('openspec-tab .pull-head').evaluate((header) => {
      const rect = header.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + 40, rect.top + rect.height / 2);
      return rect.top === 0 && top?.tagName === 'OPENSPEC-TAB' ? Math.round(rect.bottom) : 0;
    });
    const header = (await page.locator('openspec-tab .pull-head').innerText()).replace(/\s+/g, ' ');
    check(
      `the pull request header stays at the top of the window (${header.slice(0, 60)}…)`,
      fixed > 0,
    );
    // GitHub's own compact header is part of the page the tab replaces.
    const native = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="StickyPullRequestHeader-module__prHeader"]')].some(
        (element) => getComputedStyle(element).display !== 'none',
      ),
    );
    check("GitHub's own compact header does not show as well", !native);

    // The toolbar is part of that header. A font that ships with the extension is read from
    // its files, which GitHub's content security policy would refuse to a stylesheet.
    await page.locator('openspec-tab .tools-head .tool-button').click();
    await page.locator('openspec-tab .tools-head .settings select').selectOption('lexend');
    const loaded = await page
      .waitForFunction(
        () =>
          [...document.fonts].some(
            (face) => face.family.includes('Lexend') && face.status === 'loaded',
          ),
        null,
        { timeout: 5000 },
      )
      .then(
        () => true,
        () => false,
      );
    const family = await page
      .locator('openspec-tab .content')
      .evaluate((content) => getComputedStyle(content).fontFamily);
    check(
      `the reading settings in the header load a shipped font (${family.slice(0, 24)}…)`,
      loaded && family.includes('Lexend'),
    );
    await page.screenshot({ path: join(out, '3a-reading-settings.png') });
    await page.locator('openspec-tab .tools-head .settings-reset').click();
    await page.keyboard.press('Escape');
    // Where a header sits, and "covered" when something of GitHub's is painted over it.
    // (Kept free of inner functions: tsx wraps those in a helper the page does not have.)
    const place = (selector: string) =>
      firstCard.evaluate((card, query) => {
        const element =
          query === '.section-head'
            ? card.closest('.section')?.querySelector(query)
            : card.querySelector(query);
        if (!element) return 'missing';
        const rect = element.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + 40, rect.top + rect.height / 2);
        return `${Math.round(rect.top)}${top?.tagName === 'OPENSPEC-TAB' ? '' : ' covered'}`;
      }, selector);
    const heads = { section: await place('.section-head'), head: await place('.req-head') };
    check(
      `headers stay in view below it while scrolling (section at ${heads.section}, requirement at ${heads.head})`,
      heads.section === String(fixed) && /^\d+$/.test(heads.head) && Number(heads.head) > fixed,
    );
    await page.screenshot({ path: join(out, '3b-sticky-headers.png') });
    await page.locator('openspec-tab .pull-head-title button').click();
    // GitHub scrolls smoothly, so the top is reached a moment later.
    const atTop = await page
      .waitForFunction(() => window.scrollY === 0, undefined, { timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
    check(
      'the title in the header goes to the top and stays in the tab',
      atTop &&
        page.url().includes('#openspec') &&
        (await page.locator('openspec-tab').count()) === 1,
    );
    const comment = page.locator('openspec-tab .req a.icon-button.has-label').first();
    check(
      `requirement links to its source (${(await comment.getAttribute('href'))?.split('#')[1]?.slice(0, 16)}…)`,
      true,
    );
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page
    .locator('openspec-tab .overview, openspec-tab .blank')
    .first()
    .waitFor({ timeout: 30_000 });
  check('reload restores the tab from the URL', true);
  const restored = await outlineWidth();
  check(`and the outline is as wide as it was left (${restored})`, restored === resized);

  await page.goBack();
  await page.waitForTimeout(1000);
  check(
    'back leaves the tab',
    (await page.locator('openspec-tab').count()) === 0 && !page.url().includes('#openspec'),
  );
  check('native content is back', (await page.locator('[data-openspec-hidden]').count()) === 0);
  await page.goForward();
  await page
    .locator('openspec-tab .overview, openspec-tab .blank')
    .first()
    .waitFor({ timeout: 30_000 });
  check('forward returns to the tab', true);

  // Soft navigation to another native tab and back to ours.
  await page.locator('nav[aria-label^="Pull request"] a', { hasText: 'Commits' }).first().click();
  await page.waitForURL(/\/commits/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  check('a native tab takes over when clicked', (await page.locator('openspec-tab').count()) === 0);
  await tab.waitFor({ timeout: 20_000 });
  check('our tab survives the soft navigation', true);
  await page.screenshot({ path: join(out, '4-after-soft-nav.png') });
  await tab.click();
  await page
    .locator('openspec-tab .overview, openspec-tab .blank')
    .first()
    .waitFor({ timeout: 30_000 });
  check('the tab opens again from the Commits page', true);
  await page.screenshot({ path: join(out, '5-from-commits.png') });

  // "Files changed" is a page of its own with no compact header from GitHub: ours must be there.
  await page.goto(`${url.replace(/[#?].*$/, '')}/files#openspec`, {
    waitUntil: 'domcontentloaded',
  });
  // Unchanged requirements sit in a closed <details>, so they are never visible: skip them.
  const lastCard = page.locator(`${view} .req:not(.req-unchanged)`).last();
  await lastCard.waitFor({ timeout: 30_000 });
  await lastCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const onFiles = await page.locator('openspec-tab .pull-head').evaluate((header) => {
    const rect = header.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + 40, rect.top + rect.height / 2);
    return rect.top === 0 && rect.height > 0 && top?.tagName === 'OPENSPEC-TAB';
  });
  check('the pull request header is there on the Files changed page too', onFiles);
  await page.screenshot({ path: join(out, '6-from-files.png') });

  check(`no page errors (${problems.length})`, problems.length === 0);
  for (const problem of problems) console.log(`   ${problem}`);
} finally {
  await context.close();
}
console.log(`Screenshots: ${out}`);
process.exit(steps.every(([, ok]) => ok) ? 0 : 1);
