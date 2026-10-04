/**
 * Copy the fonts the tab ships with (see src/ui/fonts.ts) from their npm packages to
 * public/fonts, each with its licence: the SIL Open Font License asks for it to travel
 * with the files.
 */
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FONTS } from '../src/ui/fonts';

const root = join(import.meta.dirname, '..');
const out = join(root, 'public', 'fonts');
const PACKAGES: Record<string, string> = {
  lexend: '@fontsource-variable/lexend',
  atkinson: '@fontsource-variable/atkinson-hyperlegible-next',
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const font of FONTS) {
  const name = PACKAGES[font.id];
  if (!font.files || !name) continue;
  const source = join(root, 'node_modules', name);
  for (const { file } of font.files) await copyFile(join(source, 'files', file), join(out, file));
  await copyFile(join(source, 'LICENSE'), join(out, `${font.id}-LICENSE.txt`));
}
