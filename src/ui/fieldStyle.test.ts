import { describe, expect, it } from 'vitest';
import { gradientStops, ratio, resolve, ruleFor } from './contrastKit.ts';

/**
 * The underline field (docs/design/simple-layout.md section 3): no box, one underline that marks the field, a 2px accent underline when
 * focused and a 2px amber one in error. The underline is the only thing that says where the field is, so it is held to 3:1 against every
 * ground a field can stand on, in both themes, by measuring the shipped tokens and the shipped rule.
 */

/** The grounds a field stands on, outside the lifted surface, and the stops of the lifted surface, where the underline is --muted. */
const grounds = (theme: 'light' | 'dark'): string[] => [resolve(theme, '--bg'), resolve(theme, '--surface'), resolve(theme, '--surface-2')];
const lifted = (theme: 'light' | 'dark'): string[] => gradientStops(theme, '--surface-lift');

describe.each(['light', 'dark'] as const)('SL-I4 — a field’s underline holds 3:1 against its ground, in the %s theme', (theme) => {
  it('holds --line-strong at 3:1 against the page and the card, which are the grounds a field stands on', () => {
    for (const ground of grounds(theme)) {
      expect(ratio(resolve(theme, '--line-strong'), ground), `against ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('holds the underline on the lifted surface, which is --muted there, at 3:1 against every stop of it', () => {
    for (const ground of lifted(theme)) {
      expect(ratio(resolve(theme, '--muted'), ground), `against ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('holds the focused underline (the accent) at 3:1 against the same grounds and the lifted surface', () => {
    for (const ground of [...grounds(theme), ...lifted(theme)]) {
      expect(ratio(resolve(theme, '--brass'), ground), `against ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('holds the error underline (amber) at 3:1 against the same grounds and the lifted surface', () => {
    for (const ground of [...grounds(theme), ...lifted(theme)]) {
      expect(ratio(resolve(theme, '--c7'), ground), `against ${ground}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('SL-I4 — the shipped rule is an underline and not a box', () => {
  const field = ruleFor('.field');

  it('has no border but the bottom one, which is 1px in --line-strong, and no fill', () => {
    expect(field).toMatch(/border:\s*0;/);
    expect(field).toMatch(/border-bottom:\s*1px solid var\(--line-strong\)/);
    expect(field).toMatch(/background:\s*transparent/);
    expect(field).toMatch(/border-radius:\s*0/);
  });

  it('is 2px in the accent when focused: the 1px border and a 1px shadow, so that nothing moves', () => {
    const focus = ruleFor('.field:focus-visible');
    expect(focus).toMatch(/border-bottom-color:\s*var\(--brass\)/);
    expect(focus).toMatch(/box-shadow:\s*0 1px 0 0 var\(--brass\)/);
    // The base underline is 1px and the shadow adds 1px: two in all, and the box does not grow.
    expect(field).toMatch(/border-bottom:\s*1px solid/);
  });

  it('is 2px amber in error', () => {
    const error = ruleFor(".field[aria-invalid='true']");
    expect(error).toMatch(/border-bottom-color:\s*var\(--c7\)/);
    expect(error).toMatch(/box-shadow:\s*0 1px 0 0 var\(--c7\)/);
  });
});

describe('SL-I5 — a field’s box is at least 44px tall, though only its line is drawn', () => {
  it('sets a minimum height of 2.75rem on the field', () => {
    expect(ruleFor('.field')).toMatch(/min-height:\s*2\.75rem/);
  });

  it('sets the same on the text tabs and on an option in a sheet, which are fields’ neighbours and tapped as they are', () => {
    expect(ruleFor('.text-tabs > button')).toMatch(/min-height:\s*2\.75rem/);
    expect(ruleFor('.sheet-option')).toMatch(/min-height:\s*3rem/);
  });
});
