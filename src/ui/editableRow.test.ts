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

// The ground of an editable row is the page's own since docs/design/simple-layout.md section 3: the --inset fill and the box are gone, and
// the row is a record and its inputs divided from the next by a hairline. So the row's text and its fields are measured on the grounds a
// row can now stand on, which are the page and the card, and the box assertions give way to the underline ones in fieldStyle.test.ts.
describe.each(['light', 'dark'] as const)('the grounds of an editable row, in the %s theme', (theme) => {
  const grounds = [resolve(theme, '--bg'), resolve(theme, '--surface')];

  it.each(['--ink', '--ink-2', '--muted'])('holds %s text at 4.5:1 on each', (token) => {
    for (const ground of grounds) expect(ratio(resolve(theme, token), ground), token).toBeGreaterThanOrEqual(4.5);
  });

  it('holds the underline of a field on each at 3:1, since that line is what marks the field', () => {
    for (const ground of grounds) expect(ratio(resolve(theme, '--line-strong'), ground)).toBeGreaterThanOrEqual(3);
  });
});

describe('the editable row has no ground and no box of its own', () => {
  it('is divided by a hairline and not filled or boxed', () => {
    const rule = ruleFor('.edit-row');
    expect(rule).not.toMatch(/background:/);
    expect(rule).not.toMatch(/border-radius:/);
    expect(rule).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
  });

  it('gives a form that opens to change a record the same flat ground', () => {
    const rule = ruleFor('.inset-form');
    expect(rule).not.toMatch(/background:/);
    expect(rule).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
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
