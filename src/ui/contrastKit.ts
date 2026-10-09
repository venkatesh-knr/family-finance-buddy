import { readFileSync } from 'node:fs';

/**
 * What a test needs to measure a colour pair the way the shipped stylesheet will paint it.
 *
 * The token values are read out of `src/styles/tokens.css` and the rules out of `base.css`, so a test
 * built on this measures what ships and not a restatement of it: change a token and the ratio moves.
 * axe cannot do this for a gradient or a tint, which is why these tests exist (docs/tokens.md §2).
 *
 * Used by tests only. Nothing in the app imports it.
 */

const tokens = readFileSync('src/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
export const base = readFileSync('src/styles/base.css', 'utf8');

const hexOf = (block: string, name: string): string | undefined =>
  new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block)?.[1];

const darkAt = tokens.indexOf('@media (prefers-color-scheme: dark)');
const lightBlock = tokens.slice(0, darkAt);
const darkBlock = tokens.slice(darkAt, tokens.indexOf(":root[data-theme='dark']"));

export type Theme = 'light' | 'dark';

/** A token, as `var(--x)` or `--x`, to the hex it has in a theme. */
export function resolve(theme: Theme, token: string): string {
  const name = /var\((--[a-z0-9-]+)\)/.exec(token)?.[1] ?? token;
  const found = (theme === 'dark' ? hexOf(darkBlock, name) : undefined) ?? hexOf(lightBlock, name);
  if (found === undefined) throw new Error(`no ${theme} value for ${name}`);
  return found;
}

/** The body of the first rule for a selector in base.css, or an empty string. */
export function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped} \\{[\\s\\S]*?\\n {2}\\}`).exec(base)?.[0] ?? '';
}

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h: string): number => {
  const [r, g, b] = rgb(h) as [number, number, number];
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG contrast ratio of two hex colours. */
export function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, X p%, Y)`: the channels, gamma-encoded, mixed linearly. */
export function mix(x: string, y: string, p: number): string {
  return (
    '#' +
    rgb(x)
      .map((c, i) => Math.round(c * p + (rgb(y)[i] as number) * (1 - p)).toString(16).padStart(2, '0'))
      .join('')
  );
}
