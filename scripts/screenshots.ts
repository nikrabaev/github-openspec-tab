/**
 * Take screenshots of every view of the tab, in light and dark, from the dev
 * harness (fixture data). Run with `pnpm screenshots`; needs Playwright's
 * Chromium (`pnpm exec playwright install chromium`).
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';

/** Every view in light and dark. Generated on demand, not committed. */
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots');
/** The few pictures the README shows, at double density. Committed. */
const README = join(import.meta.dirname, '..', 'docs', 'readme');
const GROUP_RIDES = 'c/bks-142-group-rides';
const LONG = 'c/bks-150-refunds-from-receipts';

interface Shot {
  name: string;
  fixture?: string;
  /** Hide the harness controls. */
  clean?: boolean;
  /** Take the picture in a full-width window this many pixels wide. */
  wide?: number;
  state?: string;
  /** What the reader can do with review comments: see `?comments=` in the harness. */
  comments?: 'read' | 'review' | 'off';
  view?: 'inline' | 'split' | 'new';
  /** Item the page is scrolled to. */
  target?: string;
  /** Extra steps before the picture is taken. */
  prepare?(page: Page): Promise<void>;
  /** Also taken at double density for the README, in these themes. */
  hero?: Array<'light' | 'dark'>;
}

const SHOTS: Shot[] = [
  // The page from the top: the tab in the tab bar, the outline and the overview of one change.
  { name: 'hero', fixture: 'focus', clean: true, hero: ['light', 'dark'] },
  { name: 'overview', target: `${GROUP_RIDES}/overview`, hero: ['light'] },
  { name: 'proposal', target: `${GROUP_RIDES}/proposal` },
  { name: 'design', target: `${GROUP_RIDES}/design`, hero: ['light'] },
  {
    name: 'design-decisions',
    target: `${GROUP_RIDES}/design`,
    async prepare(page) {
      await page.getByText('Alternatives considered').first().click();
      await page.getByRole('heading', { name: 'Decisions' }).scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 420);
    },
  },
  {
    name: 'diagram-zoom',
    target: `${GROUP_RIDES}/design`,
    async prepare(page) {
      await page.getByRole('button', { name: /Zoom diagram/ }).click();
    },
  },
  {
    name: 'modified-inline',
    view: 'inline',
    target: `${GROUP_RIDES}/spec/ride-unlock/unlock-by-qr-code`,
    hero: ['light', 'dark'],
  },
  {
    name: 'modified-split',
    view: 'split',
    target: `${GROUP_RIDES}/spec/ride-unlock/unlock-by-qr-code`,
    hero: ['light', 'dark'],
  },
  {
    name: 'modified-new',
    view: 'new',
    target: `${GROUP_RIDES}/spec/ride-unlock/unlock-by-qr-code`,
  },
  {
    name: 'added-removed-renamed',
    target: `${GROUP_RIDES}/spec/ride-unlock/group-bikes-come-from-one-station`,
  },
  { name: 'new-capability', target: `${GROUP_RIDES}/spec/group-rides` },
  {
    // Review threads on the requirement they were left on, one of them on a scenario.
    name: 'comments',
    target: `${GROUP_RIDES}/spec/ride-unlock/unlock-by-qr-code`,
    hero: ['light'],
    async prepare(page) {
      await page.mouse.move(800, 400);
      await page.mouse.wheel(0, 330);
    },
  },
  {
    name: 'comments-compose',
    target: `${GROUP_RIDES}/spec/ride-unlock/group-bikes-come-from-one-station`,
    async prepare(page) {
      const card = page.locator(
        `[data-item="${GROUP_RIDES}/spec/ride-unlock/group-bikes-come-from-one-station"]`,
      );
      await card.getByRole('button', { name: 'Comment', exact: true }).click();
      await page.keyboard.type('Should this also cover a bike returned to another dock?');
    },
  },
  {
    // A review in progress: a pending reply, and the dialog that submits the review.
    name: 'comments-review',
    comments: 'review',
    target: `${GROUP_RIDES}/proposal`,
    async prepare(page) {
      await page.getByRole('button', { name: 'Finish review' }).click();
    },
  },
  { name: 'comments-read-only', comments: 'read', target: `${GROUP_RIDES}/design` },
  {
    // Scrolled into a card: the section's header and the card's own header stay at the top.
    name: 'sticky-headers',
    target: `${GROUP_RIDES}/spec/ride-unlock/unlock-by-qr-code`,
    async prepare(page) {
      await page.mouse.move(800, 400);
      await page.mouse.wheel(0, 260);
    },
  },
  {
    name: 'unchanged-requirements',
    target: `${GROUP_RIDES}/spec/ride-billing/daily-fare-cap`,
    async prepare(page) {
      const fold = page.locator(
        `[data-item="${GROUP_RIDES}/spec/ride-billing"] .unchanged > summary`,
      );
      await fold.click();
      await fold.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 260);
    },
  },
  { name: 'tasks', target: `${GROUP_RIDES}/tasks`, hero: ['light'] },
  { name: 'archived-change', target: 'c/2026-09-28-bks-131-dock-reservations/overview' },
  {
    name: 'archived-spec',
    target: 'c/2026-09-28-bks-131-dock-reservations/spec/dock-availability',
  },
  { name: 'direct-edits', target: 'specs' },
  {
    name: 'glossary',
    target: `${GROUP_RIDES}/spec/ride-billing/group-ride-charges`,
    async prepare(page) {
      await page
        .locator(`[data-item="${GROUP_RIDES}/spec/ride-billing/group-ride-charges"] .term`)
        .nth(1)
        .hover();
    },
  },
  {
    name: 'review-progress',
    target: `${GROUP_RIDES}/spec/group-rides`,
    async prepare(page) {
      for (const section of ['proposal', 'design']) {
        await page.locator(`[data-item="${GROUP_RIDES}/${section}"] .section-head .read`).click();
      }
      const cards = page.locator(`[data-item="${GROUP_RIDES}/spec/group-rides"] .req .read`);
      await cards.nth(0).click();
      await cards.nth(1).click();
    },
  },
  {
    name: 'outline-filter',
    target: `${GROUP_RIDES}/overview`,
    async prepare(page) {
      await page.getByPlaceholder('Filter').fill('unlock');
    },
  },
  {
    name: 'help',
    target: `${GROUP_RIDES}/overview`,
    async prepare(page) {
      await page.keyboard.press('?');
    },
  },
  { name: 'problems', fixture: 'problems', target: 'c/fix-unlock-timeouts/spec/ride-unlock' },
  { name: 'problems-fallback', fixture: 'problems', target: 'c/fix-unlock-timeouts/overview' },
  { name: 'wide-overview', fixture: 'focus', clean: true, wide: 1920 },
  {
    name: 'wide-requirements',
    wide: 1920,
    target: `${GROUP_RIDES}/spec/ride-unlock/unlock-by-qr-code`,
  },
  { name: 'wide-long-proposal', fixture: 'longform', wide: 1920, target: `${LONG}/proposal` },
  { name: 'wide-long-design', fixture: 'longform', wide: 1920, target: `${LONG}/design` },
  {
    name: 'wide-long-decisions',
    fixture: 'longform',
    wide: 1920,
    target: `${LONG}/design`,
    async prepare(page) {
      await page.getByRole('heading', { name: 'Decisions' }).scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 640);
    },
  },
  { name: 'wide-long-tasks', fixture: 'longform', wide: 1920, target: `${LONG}/tasks` },
  { name: 'long-proposal', fixture: 'longform', target: `${LONG}/proposal` },
  { name: 'long-design', fixture: 'longform', target: `${LONG}/design` },
  { name: 'empty', fixture: 'empty' },
  { name: 'loading', state: 'loading' },
  { name: 'error-needs-token', state: 'error:needs-token' },
  { name: 'error-bad-token', state: 'error:bad-token:authenticated' },
  { name: 'error-no-access', state: 'error:no-access:authenticated' },
  { name: 'error-rate-limited', state: 'error:rate-limited' },
];

const THEMES = ['light', 'dark'] as const;

async function capture(page: Page, base: string, shot: Shot, theme: string, file: string) {
  const query = new URLSearchParams({ fixture: shot.fixture ?? 'showcase', theme });
  if (shot.clean) query.set('clean', '1');
  if (shot.wide) {
    query.set('wide', '1');
    await page.setViewportSize({ width: shot.wide, height: 1200 });
  }
  if (shot.state) query.set('state', shot.state);
  if (shot.comments) query.set('comments', shot.comments);
  if (shot.view) query.set('view', shot.view);
  await page.goto(`${base}/?${query}${shot.target ? `#openspec/${shot.target}` : '#openspec'}`);
  await page.locator('#openspec-tab-host .openspec-tab').waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (shot.target) {
    // Deep links scroll on load; give layout a moment to settle.
    await page.locator(`[data-item="${shot.target}"]`).waitFor();
    await page.waitForTimeout(150);
  }
  await shot.prepare?.(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, animations: 'disabled' });
}

const server = await createServer({
  configFile: join(import.meta.dirname, '..', 'harness', 'vite.config.ts'),
  server: { port: 5198, strictPort: false },
  logLevel: 'error',
});
await server.listen();
const address = server.httpServer?.address();
const base = `http://localhost:${typeof address === 'object' && address ? address.port : 5198}`;

for (const dir of [OUT, README]) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}
const browser = await chromium.launch();
try {
  for (const scale of [1, 2]) {
    for (const theme of THEMES) {
      // A fresh context per pass: no review state or preferences carry over.
      const context = await browser.newContext({
        viewport: scale === 2 ? { width: 1280, height: 800 } : { width: 1360, height: 860 },
        deviceScaleFactor: scale,
        colorScheme: theme === 'dark' ? 'dark' : 'light',
        reducedMotion: 'reduce',
      });
      for (const shot of SHOTS) {
        if (scale === 2 && !shot.hero?.includes(theme)) continue;
        const page = await context.newPage();
        // Comment dates read "2 days ago": pin the clock so the pictures do not change by the day.
        await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
        const file = join(scale === 2 ? README : OUT, `${shot.name}-${theme}.png`);
        await capture(page, base, shot, theme, file);
        await page.evaluate(() => localStorage.clear());
        await page.close();
        console.log(`✓ ${scale === 2 ? 'readme/' : ''}${shot.name}-${theme}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
