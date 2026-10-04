import type { Preferences } from '@/github/messages';

/** One file of a font that ships with the extension, in `public/fonts`. */
export interface FontFile {
  file: string;
  /** A single weight, or the range a variable font covers. */
  weight: string;
  style: 'normal' | 'italic';
  /** The characters the file has: the browser draws the others in the next font of the stack. */
  unicodeRange: string;
}

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const SUBSETS = [
  ['latin', LATIN],
  ['latin-ext', LATIN_EXT],
] as const;

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

export interface FontChoice {
  id: Exclude<Preferences['font'], 'custom'>;
  label: string;
  /** The `font-family` value. Absent: the tab keeps GitHub's own font. */
  stack?: string;
  /**
   * The name the shipped files are registered under. It is the tab's own, so a font of the
   * same name on the reader's computer, or in GitHub's page, is never mixed with these files.
   */
  family?: string;
  files?: FontFile[];
}

/** The fonts the reader can choose. The two with files work whether or not they are installed. */
export const FONTS: FontChoice[] = [
  { id: 'default', label: 'GitHub default' },
  {
    id: 'lexend',
    label: 'Lexend',
    family: 'OpenSpec Tab Lexend',
    stack: `'OpenSpec Tab Lexend', ${SANS}`,
    files: SUBSETS.map(([subset, unicodeRange]) => ({
      file: `lexend-${subset}-wght-normal.woff2`,
      weight: '100 900',
      style: 'normal',
      unicodeRange,
    })),
  },
  {
    // The 2025 revision of Atkinson Hyperlegible: the original has two weights, this one every
    // weight from 200 to 800, which the reader's weight setting needs.
    id: 'atkinson',
    label: 'Atkinson Hyperlegible Next',
    family: 'OpenSpec Tab Atkinson Hyperlegible',
    stack: `'OpenSpec Tab Atkinson Hyperlegible', ${SANS}`,
    files: SUBSETS.flatMap(([subset, unicodeRange]) =>
      (['normal', 'italic'] as const).map((style) => ({
        file: `atkinson-hyperlegible-next-${subset}-wght-${style}.woff2`,
        weight: '200 800',
        style,
        unicodeRange,
      })),
    ),
  },
  { id: 'serif', label: 'Serif', stack: "ui-serif, Charter, 'Iowan Old Style', Georgia, serif" },
];

/** A font name as CSS takes it: quoted, with nothing that could end the string. */
const quoted = (name: string) => `'${name.replace(/['"\\;{}<>\n]/g, '').trim()}'`;

/** The `font-family` for the reader's choice, or `null` to keep GitHub's. */
export function fontStack(prefs: Pick<Preferences, 'font' | 'customFont'>): string | null {
  if (prefs.font === 'custom') {
    const name = prefs.customFont.trim();
    return name ? `${quoted(name)}, ${SANS}` : null;
  }
  return FONTS.find((font) => font.id === prefs.font)?.stack ?? null;
}

const loading = new Map<string, Promise<void>>();

/**
 * Make a shipped font available to the page. The files are read as bytes and handed to the
 * browser directly. A stylesheet pointing at the extension's files would not do: an `@font-face`
 * rule inside a shadow root is ignored, and one in GitHub's page is refused by GitHub's
 * content security policy, which only lets fonts come from GitHub's own servers.
 */
export function loadFont(id: Preferences['font'], url: (file: string) => string): Promise<void> {
  const font = FONTS.find((choice) => choice.id === id);
  if (!font?.family || !font.files || typeof FontFace === 'undefined') return Promise.resolve();
  const { family, files } = font;
  let pending = loading.get(font.id);
  if (!pending) {
    pending = Promise.all(
      files.map(async (file) => {
        const response = await fetch(url(file.file));
        if (!response.ok) throw new Error(`${file.file}: ${response.status}`);
        const face = new FontFace(family, await response.arrayBuffer(), {
          weight: file.weight,
          style: file.style,
          unicodeRange: file.unicodeRange,
        });
        document.fonts.add(await face.load());
      }),
    ).then(
      () => undefined,
      (error) => {
        // The text stays in the next font of the stack. A later choice of this font tries again.
        loading.delete(font.id);
        throw error;
      },
    );
    loading.set(font.id, pending);
  }
  return pending;
}
