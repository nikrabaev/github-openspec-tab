/** Render the logo (assets/logo.png, 1024 px) to the icon sizes browsers ask for. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = join(import.meta.dirname, '..');
const logo = `data:image/png;base64,${(await readFile(join(root, 'assets', 'logo.png'))).toString('base64')}`;
const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 96, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${logo}" alt="">`,
    );
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    await page.screenshot({
      path: join(root, 'public', 'icon', `${size}.png`),
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
