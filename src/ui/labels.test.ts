import { describe, expect, it } from 'vitest';
import { INSTRUMENT_KINDS } from '../repo/types.ts';
import { INSTRUMENT_KIND_COLOUR, INSTRUMENT_KIND_LABEL, kindColour, kindLabel } from './labels.ts';

describe('kindColour', () => {
  it('gives every class a categorical token, never a literal', () => {
    for (const kind of INSTRUMENT_KINDS) {
      expect(kindColour(kind)).toMatch(/^var\(--c[1-7]\)$/);
    }
  });

  it('gives no two classes the same colour', () => {
    const colours = INSTRUMENT_KINDS.map(kindColour);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('does not depend on how large the class is or where it is listed', () => {
    expect(kindColour('bond')).toBe('var(--c3)');
    expect(kindColour('mutual_fund')).toBe('var(--c1)');
  });

  it('draws a class it does not know as other', () => {
    expect(kindColour('crypto')).toBe(kindColour('other'));
  });

  it('covers exactly the classes that have a label', () => {
    expect(Object.keys(INSTRUMENT_KIND_COLOUR).sort()).toEqual(Object.keys(INSTRUMENT_KIND_LABEL).sort());
  });
});

describe('kindLabel', () => {
  it('falls back to the stored value', () => {
    expect(kindLabel('mutual_fund')).toBe('Mutual funds');
    expect(kindLabel('some_new')).toBe('some new');
  });
});
