import { describe, expect, it } from 'vitest';
import { ASSET_CLASSES, FOREIGN_MARKER, UNWIRED_TILES, classColour } from './assetClass.ts';
import { mix, ratio, resolve, ruleFor } from './contrastKit.ts';

/**
 * What a tile has to measure (docs/design/icons.md §5), measured against the stylesheet that ships.
 *
 * The glyph sits beside its own label, so it is redundant and 3:1 is the bar. The 1px border is held
 * to the same 3:1 as any border that is the sole marker of a shape. A single tint percentage across
 * seven hues does not give one ratio, so every kind is measured in both themes, and the percentages
 * are read out of `base.css` and not restated here: change the rule and this measures the change.
 */

const rule = ruleFor('.asset-tile');
const percent = (property: string): number => {
  const m = new RegExp(`${property}:[^;]*color-mix\\(in srgb, var\\(--tile\\) (\\d+)%, var\\(--surface\\)\\)`).exec(rule);
  if (m?.[1] === undefined) throw new Error(`.asset-tile has no tinted ${property}`);
  return Number(m[1]) / 100;
};
const FILL = percent('background');
const EDGE = percent('border');

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
