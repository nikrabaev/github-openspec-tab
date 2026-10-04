/** Render the extension icon (public/icon/icon.svg) to the PNG sizes browsers ask for. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dir = join(import.meta.dirname, '..', 'public', 'icon');
const svg = await readFile(join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 96, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: join(dir, `${size}.png`), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
