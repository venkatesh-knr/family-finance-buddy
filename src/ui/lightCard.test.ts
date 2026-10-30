import { describe, expect, it } from 'vitest';
import { gradientStops, resolve } from './contrastKit.ts';
import { base } from './contrastKit.ts';

/**
 * In the light theme a card is off-white, never #FFFFFF (docs/tokens.md section 1, the Mist palette): the brightest thing on a
 * light screen should be its content, not the background of every card. A tidy-up that sets --surface back to pure white
 * fails here and not in a review.
 */

describe('the light theme has no pure white card', () => {
  it.each(['--surface', '--surface-2', '--surface-3', '--inset', '--bg'])('%s is not #FFFFFF', (token) => {
    expect(resolve('light', token).toUpperCase()).not.toBe('#FFFFFF');
  });

  it('the lifted card’s light has no white stop', () => {
    for (const stop of gradientStops('light', '--surface-lift')) expect(stop.toUpperCase()).not.toBe('#FFFFFF');
  });

  it('no rule in the stylesheet paints a fill of literal white', () => {
    expect(base).not.toMatch(/background(-color)?:\s*(#fff(fff)?|white)\b/i);
  });
});
