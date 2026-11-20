import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { base, gradientStops, ratio, resolve, ruleFor, type Theme } from './contrastKit.ts';

/**
 * The lifted surface's glow may sit behind a figure, on one condition (docs/tokens.md §1, Depth): the
 * figure holds 4.5:1 against the gradient, in both themes.
 *
 * This replaces a rule that said the gradient "never crosses a figure", which was written on the design
 * side and then broken by the canvas it was meant to describe. A rule that is measured can be kept; the
 * values are read out of the stylesheet that ships, so a lighter stop or a dimmer ink moves the ratio and
 * fails the build. Every stop is measured and not only the brightest, because the worst stop depends on the
 * theme: in both, the figures are light and the lift is dark, so it is the lightest stop. (Under Mist, the light
 * theme's lift was pale and its figures dark, and the worst stop was the dimmest.)
 *
 * axe cannot do this itself. It cannot resolve a gradient and reports the text as "incomplete" rather
 * than failing it (docs/tokens.md §2), which is why this is a test of its own.
 */

// What is drawn on the lift: inside it, --ink, --ink-2 and --muted are these (the card sets them), so these are what a figure is measured in.
// In Linen the lift is dark and they are light; in dark they are the page's own inks.
const FIGURES = ['--lift-ink', '--lift-ink-2', '--lift-muted'] as const;

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

/**
 * Charts on the lifted surface: the mint tray (docs/tokens.md section 1, Depth; the owner, 20 November 2026). The class colours are tuned for a light panel and read 1.0 to 1.4:1 on
 * the forest, so a strip and its legend sit on a tray where they are readable, and are never changed for the lift. Measured from the shipped values, in Linen: in dark the tray is transparent.
 */
describe('the mint tray on the lifted surface in Linen', () => {
  const tray = resolve('light', '--lift-tray');
  const CLASS_COLOURS = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8', '--c9'] as const;

  it.each(CLASS_COLOURS)('holds %s at 3:1 on the tray, as a chart mark must', (token) => {
    expect(ratio(resolve('light', token), tray)).toBeGreaterThanOrEqual(3);
  });

  it('and not on the forest it replaces: every class colour is under 3:1 on the lift’s lightest stop', () => {
    const lightest = gradientStops('light', '--surface-lift').at(-1) as string;
    for (const token of CLASS_COLOURS) expect(ratio(resolve('light', token), lightest), token).toBeLessThan(3);
  });

  it.each(['--ink', '--ink-2', '--muted'] as const)('holds the page’s %s at 4.5:1 on the tray, which is what text inside it is drawn in', (token) => {
    expect(ratio(resolve('light', token), tray)).toBeGreaterThanOrEqual(4.5);
  });

  it('fades from the lift’s lightest stop to the tray, so there is no edge where one meets the other', () => {
    const stops = gradientStops('light', '--lift-tray-fade');
    expect(stops[0]).toBe(gradientStops('light', '--surface-lift').at(-1));
    expect(stops.at(-1)).toBe(tray);
  });

  it('is transparent in dark, where no screen changes', () => {
    const darkBlock = readFileSync('src/styles/tokens.css', 'utf8').slice(readFileSync('src/styles/tokens.css', 'utf8').indexOf('@media (prefers-color-scheme: dark)'));
    expect(darkBlock.match(/--lift-tray:\s*transparent;/g)).toHaveLength(2);
    expect(darkBlock.match(/--lift-tray-fade:\s*transparent;/g)).toHaveLength(2);
  });
});

describe('the tray as the stylesheet paints it', () => {
  const fade = ruleFor('.lift-tray-fade');
  const tray = ruleFor('.lift-tray');

  it('is a 32px fade, painted from the token, and the tray takes the card’s edges and gives its padding back inside', () => {
    expect(fade).toMatch(/background:\s*var\(--lift-tray-fade\)/);
    expect(fade).toMatch(/height:\s*32px/);
    expect(tray).toMatch(/background:\s*var\(--lift-tray\)/);
    expect(tray).toMatch(/margin:\s*0 -18px -18px/);
    expect(tray).toMatch(/padding:[^;]*18px 18px/);
  });

  it('puts back the page’s inks that the lift remaps, all seven', () => {
    for (const [own, page] of [
      ['--ink', '--page-ink'],
      ['--ink-2', '--page-ink-2'],
      ['--muted', '--page-muted'],
      ['--line', '--page-line'],
      ['--line-strong', '--page-line-strong'],
      ['--surface-2', '--page-surface-2'],
      ['--surface-3', '--page-surface-3'],
    ] as const) {
      expect(tray, own).toContain(`${own}: var(${page});`);
    }
  });

  it('holds no height on the tray, which carries text: only the fade, which carries none, has one', () => {
    expect(tray).not.toMatch(/(^|\s)(height|min-height|max-height):/);
  });

  it('is flat under forced colours, where a gradient is not painted, and takes no room and no colour in dark', () => {
    expect(base).toMatch(/@media \(forced-colors: active\) \{\s*\.lift-tray-fade,\s*\.lift-tray \{\s*background: var\(--lift-tray\);/);
    expect(base).toMatch(/:root\[data-theme='dark'\] \.lift-tray-fade \{\s*display: none;/);
    expect(base).toMatch(/:root:not\(\[data-theme='light'\]\) \.lift-tray-fade \{\s*display: none;/);
  });

  it('keeps forced-color-adjust: none to Linen: both dark rules for the tray put the system colours back', () => {
    expect(base).toMatch(/:root:not\(\[data-theme='light'\]\) \.lift-tray \{[^}]*forced-color-adjust: auto;/);
    expect(base).toMatch(/:root\[data-theme='dark'\] \.lift-tray \{[^}]*forced-color-adjust: auto;/);
    expect(base.match(/forced-color-adjust: none;/g)).toHaveLength(1);
  });
});
