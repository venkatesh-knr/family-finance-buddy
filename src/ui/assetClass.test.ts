import { describe, expect, it } from 'vitest';
import { INSTRUMENT_KINDS } from '../repo/types.ts';
import { ASSET_CLASSES, GLYPHS, assetClass, rampColour } from './assetClass.ts';
import { INSTRUMENT_KIND_COLOUR, INSTRUMENT_KIND_LABEL, kindColour, kindLabel } from './labels.ts';

describe('the asset classes', () => {
  it('cover exactly the kinds the repository knows, so none is added in one place and not the other', () => {
    expect(ASSET_CLASSES.map((c) => c.kind).sort()).toEqual([...INSTRUMENT_KINDS].sort());
  });

  it('give every built kind a tile: a glyph that is actually drawn', () => {
    for (const kind of INSTRUMENT_KINDS) {
      const { glyph } = assetClass(kind);
      expect(GLYPHS[glyph], `${kind} points at a glyph that does not exist`).toBeDefined();
      expect(GLYPHS[glyph].length, `${kind} has an empty glyph`).toBeGreaterThan(0);
      for (const d of GLYPHS[glyph]) expect(d.trim().length).toBeGreaterThan(0);
    }
  });

  it('give no two kinds the same glyph, because the shape and not the colour is what tells them apart', () => {
    const glyphs = ASSET_CLASSES.map((c) => c.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('draw other as a real glyph of its own, not a blank and not another class', () => {
    const other = assetClass('other');
    expect(other.glyph).toBe('dots');
    expect(GLYPHS[other.glyph].length).toBeGreaterThan(0);
    for (const kind of INSTRUMENT_KINDS.filter((k) => k !== 'other')) {
      expect(assetClass(kind).glyph).not.toBe(other.glyph);
    }
  });

  it('resolve a kind nobody has heard of to other, and never to nothing', () => {
    expect(assetClass('crypto')).toBe(assetClass('other'));
    expect(assetClass('')).toBe(assetClass('other'));
    expect(GLYPHS[assetClass('crypto').glyph]).toBeDefined();
  });

  it('name every class', () => {
    for (const c of ASSET_CLASSES) expect(c.label.trim().length).toBeGreaterThan(0);
  });
});

describe('the chart ramp as a property of the class', () => {
  it('is an index from 1 to 7 on each class, and the colour follows from it', () => {
    for (const c of ASSET_CLASSES) {
      expect(Number.isInteger(c.ramp)).toBe(true);
      expect(c.ramp).toBeGreaterThanOrEqual(1);
      expect(c.ramp).toBeLessThanOrEqual(7);
      expect(rampColour(c.ramp)).toBe(`var(--c${String(c.ramp)})`);
      expect(kindColour(c.kind)).toBe(rampColour(c.ramp));
    }
  });

  it('never gives two classes one slot', () => {
    const ramps = ASSET_CLASSES.map((c) => c.ramp);
    expect(new Set(ramps).size).toBe(ramps.length);
  });

  it('leaves slot 5 empty: it is the prototype crypto slot, held until a class needs it', () => {
    expect(ASSET_CLASSES.map((c) => c.ramp)).not.toContain(5);
  });

  it('keeps each class where it was, so no figure on any screen changed colour', () => {
    const was = {
      mutual_fund: 1,
      equity: 2,
      bond: 3,
      etf: 4,
      deposit: 6,
      other: 7,
    };
    for (const [kind, ramp] of Object.entries(was)) expect(assetClass(kind).ramp).toBe(ramp);
  });

  it('does not depend on how large a class is or where it is listed', () => {
    const reversed = [...ASSET_CLASSES].reverse();
    for (const c of reversed) expect(kindColour(c.kind)).toBe(rampColour(c.ramp));
  });
});

describe('labels and colours stay one map', () => {
  it('are derived from the same classes the tiles are', () => {
    for (const c of ASSET_CLASSES) {
      expect(INSTRUMENT_KIND_LABEL[c.kind]).toBe(c.label);
      expect(kindLabel(c.kind)).toBe(c.label);
      expect(INSTRUMENT_KIND_COLOUR[c.kind]).toBe(rampColour(c.ramp));
    }
  });
});
