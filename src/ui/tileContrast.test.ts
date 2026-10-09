import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_CLASSES, FOREIGN_MARKER, UNWIRED_TILES, classColour } from './assetClass.ts';

/**
 * What a tile has to measure (docs/design/icons.md §5), measured against the stylesheet that ships.
 *
 * The glyph sits beside its own label, so it is redundant and 3:1 is the bar. The 1px border is held
 * to the same 3:1 as any border that is the sole marker of a shape. A single tint percentage across
 * seven hues does not give one ratio, so every kind is measured in both themes, and the percentages
 * are read out of `base.css` and not restated here: change the rule and this measures the change.
 */

const tokens = readFileSync('src/styles/tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const base = readFileSync('src/styles/base.css', 'utf8');

const hexOf = (block: string, name: string): string | undefined =>
  new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block)?.[1];

const darkAt = tokens.indexOf('@media (prefers-color-scheme: dark)');
const lightBlock = tokens.slice(0, darkAt);
const darkBlock = tokens.slice(darkAt, tokens.indexOf(":root[data-theme='dark']"));

const resolve = (theme: 'light' | 'dark', token: string): string => {
  const name = /var\((--[a-z0-9-]+)\)/.exec(token)?.[1] ?? token;
  const found = (theme === 'dark' ? hexOf(darkBlock, name) : undefined) ?? hexOf(lightBlock, name);
  if (found === undefined) throw new Error(`no ${theme} value for ${name}`);
  return found;
};

const rule = /\.asset-tile \{[\s\S]*?\n {2}\}/.exec(base)?.[0] ?? '';
const percent = (property: string): number => {
  const m = new RegExp(`${property}:[^;]*color-mix\\(in srgb, var\\(--tile\\) (\\d+)%, var\\(--surface\\)\\)`).exec(rule);
  if (m?.[1] === undefined) throw new Error(`.asset-tile has no tinted ${property}`);
  return Number(m[1]) / 100;
};
const FILL = percent('background');
const EDGE = percent('border');

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h: string): number => {
  const [r, g, b] = rgb(h) as [number, number, number];
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** `color-mix(in srgb, X p%, Y)`: the channels, gamma-encoded, mixed linearly. */
const mix = (x: string, y: string, p: number): string =>
  '#' +
  rgb(x)
    .map((c, i) => Math.round(c * p + (rgb(y)[i] as number) * (1 - p)).toString(16).padStart(2, '0'))
    .join('');

const tiles: [string, string][] = [
  ...ASSET_CLASSES.map((c): [string, string] => [c.kind, classColour(c)]),
  ...Object.entries(UNWIRED_TILES).map(([k, t]): [string, string] => [k, t.colour]),
  ['foreign', FOREIGN_MARKER.colour],
];

describe.each(['light', 'dark'] as const)('a tile in the %s theme', (theme) => {
  const surface = resolve(theme, '--surface');

  it('reads the percentages from the shipped rule', () => {
    expect(FILL).toBeGreaterThan(0);
    expect(EDGE).toBeGreaterThan(FILL);
  });

  it.each(tiles)('holds its glyph at 3:1 against its own fill: %s', (_kind, colour) => {
    const glyph = resolve(theme, colour);
    expect(ratio(glyph, mix(glyph, surface, FILL))).toBeGreaterThanOrEqual(3);
  });

  it.each(tiles)('holds its 1px border at 3:1 against what is behind it: %s', (_kind, colour) => {
    const glyph = resolve(theme, colour);
    expect(ratio(mix(glyph, surface, EDGE), surface)).toBeGreaterThanOrEqual(3);
  });
});
