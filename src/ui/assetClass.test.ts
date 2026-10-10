import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTRUMENT_KINDS } from '../repo/types.ts';
import {
  ASSET_CLASSES,
  FOREIGN_MARKER,
  GLYPHS,
  GLYPH_STROKE,
  UNWIRED_TILES,
  assetClass,
  classColour,
  rampColour,
} from './assetClass.ts';
import { INSTRUMENT_KIND_COLOUR, INSTRUMENT_KIND_LABEL, kindColour, kindLabel } from './labels.ts';

describe('the asset classes', () => {
  it('cover exactly the kinds the repository knows, so none is added in one place and not the other', () => {
    expect(ASSET_CLASSES.map((c) => c.kind).sort()).toEqual([...INSTRUMENT_KINDS].sort());
  });

  it('IC-R3 — give every value a kind can hold a tile: a glyph that is actually drawn', () => {
    // Iterates the enum, not a list of the five that exist: a kind added without a glyph fails here
    // and does not render blank.
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

  it('draw each class as docs/design/icons.md assigns it', () => {
    // A fund is a line you watch; a holding is a discrete thing you count. Mutual funds and equity
    // are the pair that gets swapped, so the line/bars split is held in this direction.
    expect(assetClass('mutual_fund').glyph).toBe('trend');
    expect(assetClass('equity').glyph).toBe('bars');
    expect(assetClass('etf').glyph).toBe('basket');
    expect(assetClass('bond').glyph).toBe('certificate');
    expect(assetClass('deposit').glyph).toBe('card');
    expect(assetClass('other').glyph).toBe('ellipsis');
  });

  it('IC-R9 — draw each glyph to the geometry icons.md gives, with its rectangles as rounded-corner paths', () => {
    expect(GLYPHS.trend).toEqual(['M3 17l5-6 4 4 6-8', 'M14 7h5v5']);
    expect(GLYPHS.bars).toEqual(['M6 20V9', 'M12 20V4', 'M18 20v-7', 'M3 20h18']);
    // etf: rect 3,8 18x12 r2; handle; M3 13h18
    expect(GLYPHS.basket).toEqual([
      'M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
      'M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2',
      'M3 13h18',
    ]);
    // bond: rect 3,7 18x12 r2; M3 11h18
    expect(GLYPHS.certificate).toEqual([
      'M5 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
      'M3 11h18',
    ]);
    // deposit: rect 3,6 18x13 r2; M3 10h18; circle 12,14.5 r2
    expect(GLYPHS.card).toEqual([
      'M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
      'M3 10h18',
      'M14 14.5a2 2 0 1 1-4 0a2 2 0 0 1 4 0z',
    ]);
  });

  it('colour each class by its hue: periwinkle, emerald, violet, gold, cyan', () => {
    expect(kindColour('mutual_fund')).toBe('var(--c1)');
    expect(kindColour('equity')).toBe('var(--c2)');
    expect(kindColour('etf')).toBe('var(--c4)');
    expect(kindColour('bond')).toBe('var(--c3)');
    expect(kindColour('deposit')).toBe('var(--c6)');
  });

  it('name every class', () => {
    for (const c of ASSET_CLASSES) expect(c.label.trim().length).toBeGreaterThan(0);
  });
});

describe('other', () => {
  const other = ASSET_CLASSES.find((c) => c.kind === 'other');

  it('IC-R4 — is a class of its own in the list, found by name: a missing-case fallback looks identical on screen', () => {
    // If `other` were deleted from the list and the fallback quietly drew something that looked like
    // it, nothing visible would change. So it is asserted by name, and the fallback must be this entry.
    expect(other).toBeDefined();
    expect(other?.label).toBe('Other');
    expect(assetClass('other')).toBe(other);
    expect(assetClass('a kind added tomorrow')).toBe(other);
  });

  it('is a real tile, with a glyph of its own, and not a blank', () => {
    expect(other?.glyph).toBe('ellipsis');
    expect(GLYPHS.ellipsis.length).toBe(3);
    for (const kind of INSTRUMENT_KINDS.filter((k) => k !== 'other')) {
      expect(assetClass(kind).glyph).not.toBe('ellipsis');
    }
  });

  it('IC-R4 — is neutral grey and not a hue: it is not a sixth asset class and must not compete for attention', () => {
    expect(other?.ramp).toBeNull();
    expect(kindColour('other')).toBe('var(--muted)');
    expect(classColour(assetClass('other'))).toBe('var(--muted)');
    for (const slot of [1, 2, 3, 4, 5, 6, 7]) expect(kindColour('other')).not.toBe(rampColour(slot));
  });

  it('IC-R6 — is never drawn as anything that could be taken for the caveat marker', () => {
    // The caveat is a circle with an i, and means something is wrong. Nothing is wrong with a holding
    // whose kind this app does not model, so no ring around anything and nothing standing upright. A dot
    // is a circle too, so a circle is allowed when it is small enough to be solid once stroked: with the
    // stroke on, its hole must be under a unit across, which is no ring at all.
    for (const d of GLYPHS.ellipsis) {
      expect(d, 'a vertical stroke is an i or an exclamation mark').not.toMatch(/[vV]/);
      expect(d, 'one dot, centred on the middle line').toMatch(
        /^M\d+ 12a(\d+(?:\.\d+)?) \1 0 1 1-\d+ 0a\1 \1 0 0 1 \d+ 0z$/,
      );
      const r = Number(/a(\d+(?:\.\d+)?) /.exec(d)?.[1]);
      expect(2 * (r - GLYPH_STROKE / 2), 'a hole is a ring').toBeLessThan(1);
      expect(2 * (r + GLYPH_STROKE / 2), 'wide enough to cover whole pixels at 1x').toBeGreaterThanOrEqual(3.5);
    }
  });

  it('draws a kind nobody has heard of the same way, never as nothing', () => {
    expect(GLYPHS[assetClass('crypto').glyph]).toBeDefined();
    expect(kindColour('crypto')).toBe(kindColour('other'));
    expect(assetClass('')).toBe(other);
  });
});

describe('the chart ramp as a property of the class', () => {
  const hued = ASSET_CLASSES.filter((c) => c.ramp !== null);

  it('is an index from 1 to 7 on each hued class, and the colour follows from it', () => {
    for (const c of hued) {
      const ramp = c.ramp as number;
      expect(Number.isInteger(ramp)).toBe(true);
      expect(ramp).toBeGreaterThanOrEqual(1);
      expect(ramp).toBeLessThanOrEqual(7);
      expect(rampColour(ramp)).toBe(`var(--c${String(ramp)})`);
      expect(kindColour(c.kind)).toBe(rampColour(ramp));
    }
  });

  it('never gives two classes one slot', () => {
    const ramps = hued.map((c) => c.ramp);
    expect(new Set(ramps).size).toBe(ramps.length);
  });

  it('does not depend on how large a class is or where it is listed', () => {
    for (const c of [...ASSET_CLASSES].reverse()) expect(kindColour(c.kind)).toBe(classColour(c));
  });
});

describe('coral is reserved to liabilities', () => {
  it('IC-R5 — is on no class, no marker and no other tile: the moment a second class wears it, coral stops meaning "subtracts"', () => {
    const coral = 'var(--c5)';
    expect(ASSET_CLASSES.filter((c) => classColour(c) === coral)).toEqual([]);
    expect(ASSET_CLASSES.filter((c) => (c.ramp as number | null) === 5)).toEqual([]);
    expect(FOREIGN_MARKER.colour).not.toBe(coral);
    const wearers = Object.entries(UNWIRED_TILES)
      .filter(([, t]) => t.colour === coral)
      .map(([kind]) => kind);
    expect(wearers).toEqual(['liabilities']);
  });
});

describe('the geometry', () => {
  it('strokes at 1.9, which the component reads from here and does not hardcode', () => {
    expect(GLYPH_STROKE).toBe(1.9);
  });
});

describe('the Stage 5 tiles: drawn, and not wired', () => {
  const kinds = Object.keys(UNWIRED_TILES).sort();

  it('are the five icons.md lists, each with a glyph that is drawn', () => {
    expect(kinds).toEqual(['gold', 'insurance', 'liabilities', 'property', 'retirement']);
    for (const kind of kinds) {
      const tile = UNWIRED_TILES[kind as keyof typeof UNWIRED_TILES];
      expect(GLYPHS[tile.glyph], `${kind} points at a glyph that does not exist`).toBeDefined();
      expect(GLYPHS[tile.glyph].length).toBeGreaterThan(0);
    }
    expect(UNWIRED_TILES.liabilities.glyph).toBe('minus');
  });

  it('carry the colours the design gives them', () => {
    expect(UNWIRED_TILES.property.colour).toBe('var(--c2)'); // emerald, a house
    expect(UNWIRED_TILES.gold.colour).toBe('var(--c3)'); // gold, a coin stack
    expect(UNWIRED_TILES.retirement.colour).toBe('var(--c1)'); // periwinkle, a shield
    expect(UNWIRED_TILES.insurance.colour).toBe('var(--c4)'); // violet, an umbrella
    expect(UNWIRED_TILES.liabilities.colour).toBe('var(--c5)'); // coral, a circle with a minus
  });

  it('are not asset classes: none is in the class list, resolves as one, or is a kind the repository stores', () => {
    for (const kind of kinds) {
      expect(ASSET_CLASSES.map((c) => c.kind)).not.toContain(kind);
      expect(INSTRUMENT_KINDS as readonly string[]).not.toContain(kind);
      // An unknown kind is drawn as other, which is what keeps an unwired tile from leaking in.
      expect(assetClass(kind)).toBe(assetClass('other'));
    }
  });
});

describe('foreign is a marker, not a class', () => {
  it('IC-R7 — is excluded from the class list entirely, and is not among the tiles either', () => {
    expect(ASSET_CLASSES.map((c) => c.kind)).not.toContain('foreign');
    expect(Object.keys(UNWIRED_TILES)).not.toContain('foreign');
    expect(INSTRUMENT_KINDS as readonly string[]).not.toContain('foreign');
    expect(assetClass('foreign')).toBe(assetClass('other'));
    expect(INSTRUMENT_KIND_LABEL['foreign']).toBeUndefined();
  });

  it('IC-R7 — takes no slot of the ramp and is not selectable where a kind is', () => {
    expect(ASSET_CLASSES.map((c) => c.ramp)).not.toContain(FOREIGN_MARKER);
    expect(INSTRUMENT_KIND_COLOUR['foreign']).toBeUndefined();
    expect(FOREIGN_MARKER.glyph).toBe('globe');
  });
});

describe('what is unwired stays unwired', () => {
  it('IC-R8 — is referenced by nothing in the app: only this module and its tests may name it', () => {
    const offenders = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(path, 'utf8');
          if (text.includes('UNWIRED_TILES') || text.includes('FOREIGN_MARKER')) {
            offenders.add(path.replace(/\\/g, '/'));
          }
        }
      }
    };
    walk('src');
    expect([...offenders].sort()).toEqual([
      'src/ui/assetClass.test.ts',
      'src/ui/assetClass.ts',
      'src/ui/tileContrast.test.ts',
    ]);
  });
});

describe('labels and colours stay one map', () => {
  it('are derived from the same classes the tiles are', () => {
    for (const c of ASSET_CLASSES) {
      expect(INSTRUMENT_KIND_LABEL[c.kind]).toBe(c.label);
      expect(kindLabel(c.kind)).toBe(c.label);
      expect(INSTRUMENT_KIND_COLOUR[c.kind]).toBe(classColour(c));
    }
  });
});
