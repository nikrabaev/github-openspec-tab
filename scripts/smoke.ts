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
  await page.screenshot({ path: join(out, '2-openspec-tab.png') });

  const firstCard = page.locator('openspec-tab .req').first();
  if (await firstCard.count()) {
    await firstCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, '3-requirements.png') });
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
