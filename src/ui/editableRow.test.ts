import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ratio, resolve, ruleFor } from './contrastKit.ts';

/**
 * The editable row (docs/design/vibrant-canvas.html, the kit): a record and the inputs that change it, on
 * one line, on ground that recedes below its card so a column of them reads as a list.
 *
 * Everything on it is measured against the shipped tokens and stylesheet, in both themes. axe measures the
 * text on a real page; this is where the ground itself, the field edges and the target sizes are pinned.
 */

describe.each(['light', 'dark'] as const)('the inset ground, in the %s theme', (theme) => {
  const inset = resolve(theme, '--inset');
  const surface = resolve(theme, '--surface');

  it('is darker than the card it sits on, which is what makes it recede', () => {
    // Contrast against the card is not the point; which is darker is. White against a luminance
    // comparison: the lower of the two reads as the hollow.
    const lum = (hex: string): number => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(c[0] as number) + 0.7152 * lin(c[1] as number) + 0.0722 * lin(c[2] as number);
    };
    expect(lum(inset)).toBeLessThan(lum(surface));
  });

  it('is darker than --surface-2 as well, because a holding card is on that and a form opens inside it', () => {
    const lum = (hex: string): number => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(c[0] as number) + 0.7152 * lin(c[1] as number) + 0.0722 * lin(c[2] as number);
    };
    expect(lum(inset)).toBeLessThan(lum(resolve(theme, '--surface-2')));
  });

  it.each(['--ink', '--ink-2', '--muted'])('holds %s text at 4.5:1 on it', (token) => {
    expect(ratio(resolve(theme, token), inset), token).toBeGreaterThanOrEqual(4.5);
  });

  it('holds the border of a field on it at 3:1, since that edge is what marks the field', () => {
    expect(ratio(resolve(theme, '--line-strong'), inset)).toBeGreaterThanOrEqual(3);
  });

});

describe('the row action', () => {
  const rule = ruleFor('.row-action');
  const face = ruleFor('.row-action-face');

  it('is a 44px target around a 34px face: the visible button is small and the thing to hit is not', () => {
    expect(rule).toMatch(/height:\s*2\.75rem/);
    expect(rule).toMatch(/width:\s*2\.75rem/);
    expect(face).toMatch(/height:\s*2\.125rem/);
    expect(face).toMatch(/width:\s*2\.125rem/);
  });

  it('has a border on its face, so it is still a button where a tint is dropped', () => {
    expect(face).toMatch(/border:\s*1px solid/);
  });

  it('holds its glyph at 3:1 against the face, both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(ratio(resolve(theme, '--muted'), resolve(theme, '--surface')), theme).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the editable row’s layout', () => {
  it('keeps the action on the first line at phone width, with the fields under the name', () => {
    const rule = ruleFor('.edit-row');
    expect(rule).toMatch(/grid-template-areas:\s*\n?\s*'name act'\s*\n?\s*'fields fields'/);
  });

  it('puts the name, the fields and the action on one line from 40rem up, and only then', () => {
    const wide = /@media \(min-width: 40rem\) \{\s*\.edit-row \{([\s\S]*?)\}/.exec(
      readFileSync('src/styles/base.css', 'utf8'),
    )?.[1];
    expect(wide, 'a rule for .edit-row from 40rem').toBeDefined();
    expect(wide).toMatch(/grid-template-areas:\s*'name fields act'/);
    // The phone layout is the base rule, so it is not behind a query that a narrow screen would miss.
    expect(ruleFor('.edit-row')).not.toMatch(/'name fields act'/);
  });
});
