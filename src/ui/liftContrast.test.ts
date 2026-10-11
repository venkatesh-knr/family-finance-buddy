import { describe, expect, it } from 'vitest';
import { gradientStops, ratio, resolve, ruleFor, type Theme } from './contrastKit.ts';

/**
 * The lifted surface's glow may sit behind a figure, on one condition (docs/tokens.md §1, Depth): the
 * figure holds 4.5:1 against the gradient, in both themes.
 *
 * This replaces a rule that said the gradient "never crosses a figure", which was written on the design
 * side and then broken by the canvas it was meant to describe. A rule that is measured can be kept; the
 * values are read out of the stylesheet that ships, so a lighter stop or a dimmer ink moves the ratio and
 * fails the build. Every stop is measured and not only the brightest, because the worst stop depends on the
 * theme: it is the brightest in dark, where the figures are light, and the dimmest in light, where they are
 * dark.
 *
 * axe cannot do this itself. It cannot resolve a gradient and reports the text as "incomplete" rather
 * than failing it (docs/tokens.md §2), which is why this is a test of its own.
 */

const FIGURES = ['--ink', '--ink-2', '--muted'] as const;

describe.each(['light', 'dark'] as const satisfies readonly Theme[])('the lifted surface in the %s theme', (theme) => {
  const stops = gradientStops(theme, '--surface-lift');

  it('has stops to measure', () => {
    expect(stops.length).toBeGreaterThanOrEqual(2);
  });

  it.each(FIGURES)('holds %s at 4.5:1 against every stop of the glow', (token) => {
    const figure = resolve(theme, token);
    const worst = Math.min(...stops.map((stop) => ratio(figure, stop)));
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the lifted surface as the stylesheet paints it', () => {
  const rule = ruleFor('.card-lift');

  it('paints the gradient across the whole card, as the canvas does', () => {
    expect(rule).toMatch(/var\(--surface-lift\)/);
    // No band and no fade: the old rule painted the glow over the header alone and faded it out before a figure.
    expect(rule).not.toMatch(/--lift-band/);
    expect(rule).not.toMatch(/linear-gradient/);
  });
});
