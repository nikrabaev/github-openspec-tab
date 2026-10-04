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
    // Scroll into the card: GitHub fixes its own pull request header to the top of the
    // window, and the section's header and the card's own must stay in view below it, which
    // GitHub's page could prevent (a clipping ancestor, its header painted over ours).
    await firstCard.evaluate((card) => {
      window.scrollTo({ top: window.scrollY + card.getBoundingClientRect().top - 20 });
    });
    await page.waitForTimeout(300);
    const fixed = await page.evaluate(() => {
      const header = document.querySelector('[class*="StickyPullRequestHeader-module__prHeader"]');
      const rect = header?.getBoundingClientRect();
      return rect && rect.top === 0 ? Math.round(rect.bottom) : 0;
    });
    check(`GitHub's pull request header stays at the top of the window (${fixed}px)`, fixed > 0);
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
    // The title in GitHub's header links to "#top", which must not replace the tab's hash.
    await page
      .locator('[class*="StickyPullRequestHeader-module__prHeader"] a[href="#top"]')
      .click();
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

  check(`no page errors (${problems.length})`, problems.length === 0);
  for (const problem of problems) console.log(`   ${problem}`);
} finally {
  await context.close();
}
console.log(`Screenshots: ${out}`);
process.exit(steps.every(([, ok]) => ok) ? 0 : 1);
