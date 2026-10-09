import type { Screen } from './useScreen.ts';

/**
 * The glyph above each label in the bottom bar, as stroked path data on a 24-unit square.
 *
 * These were text characters (a bullseye, a rupee sign, a half-filled square, a section sign, a
 * triangle), which take whatever weight and shape the platform's font gives them and do not sit on the
 * same optical grid as the stroke icons everywhere else (docs/design/icons.md: 1.9 stroke, round caps
 * and joins). Drawn here the same way, from docs/design/vibrant-canvas.html, which is where the set
 * was settled.
 *
 * The glyph is for the bottom bar on a phone, where a label alone is too small to aim at. It never
 * appears without its word: an icon on its own is a guess.
 */

export interface NavGlyphPart {
  readonly d: string;
  /** Painted solid, with no stroke: the one dot in the Overview glyph. */
  readonly filled?: true;
}

type NavScreen = Extract<Screen, 'overview' | 'summary' | 'expenses' | 'holdings' | 'tax' | 'fire'>;

const OVERVIEW: readonly NavGlyphPart[] = [
  { d: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0z' },
  { d: 'M15.2 12a3.2 3.2 0 1 1-6.4 0a3.2 3.2 0 0 1 6.4 0z', filled: true },
];

export const NAV_GLYPHS: Record<NavScreen, readonly NavGlyphPart[]> = {
  overview: OVERVIEW,
  // The Summary is what Overview is to a role that cannot see the household, so it wears the same mark.
  summary: OVERVIEW,
  // A rupee: two rules, a bowl and a tail.
  expenses: [
    { d: 'M6 4h11' },
    { d: 'M6 9h11' },
    { d: 'M6 14h6' },
    { d: 'M8 4c4 0 6 2 6 5s-2 5-6 5' },
    { d: 'm11 14 6 6' },
  ],
  // A ledger spread: a case with a spine.
  holdings: [{ d: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z' }, { d: 'M11 5v14' }],
  tax: [{ d: 'M8 4h8' }, { d: 'M12 4v16' }, { d: 'M6 20h12' }],
  fire: [{ d: 'm12 4 8 15H4Z' }],
};
