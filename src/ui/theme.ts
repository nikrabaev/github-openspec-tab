import { type RefObject, useEffect, useState } from 'react';

/** Perceived brightness of a CSS colour, 0 (black) to 1 (white); null when it cannot be read. */
export function luminance(color: string): number | null {
  const value = color.trim();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) {
    rgb = [...hex.slice(0, 3)].map((digit) => Number.parseInt(digit + digit, 16));
  } else if (hex && (hex.length === 6 || hex.length === 8)) {
    rgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  } else {
    const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
    if (match) rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const [r, g, b] = rgb ?? [];
  if (r === undefined || g === undefined || b === undefined) return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Whether the page is in a dark theme, read from the background colour GitHub
 * resolves for it rather than from a theme name, so dimmed and high-contrast
 * themes are covered too.
 */
export function useIsDark(ref: RefObject<HTMLElement | null>): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => {
      const element = ref.current;
      if (!element) return;
      const value = luminance(getComputedStyle(element).getPropertyValue('--bgColor-default'));
      setDark(value !== null && value < 0.4);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode', 'data-light-theme', 'data-dark-theme', 'class'],
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', read);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', read);
    };
  }, [ref]);
  return dark;
}
