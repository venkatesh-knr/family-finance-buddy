/**
 * An asset class, in one place: what it is called, which colour it carries, and the glyph on its tile.
 *
 * These were three separate maps (a label, a colour, and now a tile) keyed by the same strings, and
 * three maps keyed alike is how one of them gets a class the others do not. So the class is the
 * unit and the rest are properties of it. The ramp slot is a property of the class and not a
 * position in a list: `ramp: 3` means Bonds is the third step of `--c1…--c7` whatever is drawn
 * beside it, whatever order the rows come in, and however large the class is. Coloured by position,
 * a class is one colour when it is third largest and another when it is second (`docs/tokens.md` §6).
 *
 * Glyph shape and which kind gets which is `docs/design/icons.md`; colour and radius are
 * `docs/tokens.md`. Where they disagree, tokens.md is right.
 *
 * What the classes ARE, and which exist, belongs to `INSTRUMENT_KINDS` in the repository layer; a
 * test holds this list to exactly that set, so a kind added there fails here until it has a tile.
 *
 * Pure data. The glyphs are path strings and the tile that draws them is `AssetTile.tsx`, so
 * "every kind has a tile" is something a unit test can assert without a DOM.
 */

/** Which glyph. Named for what it is drawn as, not for the class that uses it. */
export type Glyph =
  | 'trend'
  | 'bars'
  | 'basket'
  | 'certificate'
  | 'card'
  | 'ellipsis'
  | 'house'
  | 'coins'
  | 'shield'
  | 'umbrella'
  | 'minus'
  | 'globe';

/**
 * The stroke every glyph is drawn at, in the units of its 24-wide box. A glyph is 20px on a 24-unit
 * box, so this is about 1.6px on screen. Round caps and joins, never filled.
 */
export const GLYPH_STROKE = 1.9;

/**
 * Each glyph as SVG path data on a 24-unit square, to be stroked in the class colour. Simple shapes
 * that stay legible at 20px, and different enough in outline that a class does not depend on its
 * colour to be told apart, which is §2's rule for everything else on these screens.
 */
export const GLYPHS: Record<Glyph, readonly string[]> = {
  // Mutual funds: a line you watch. Rising, with an arrow tip.
  trend: ['M3 17l5-6 4 4 6-8', 'M14 7h5v5'],
  // Equity: a holding is a thing you count. Three bars on a baseline. (icons.md draws them 11, 16 and 7
  // tall, which is not the "ascending" its prose says; the geometry is followed, as drawn.)
  bars: ['M6 20V9', 'M12 20V4', 'M18 20v-7', 'M3 20h18'],
  // An ETF: a basket. A case (rect 3,8 18x12 r2) with a handle and one divider.
  basket: [
    'M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
    'M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2',
    'M3 13h18',
  ],
  // A bond: a certificate. A rect 3,7 18x12 r2 with a rule near the top.
  certificate: ['M5 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M3 11h18'],
  // A deposit: a passbook (rect 3,6 18x13 r2, a rule) with a coin (circle 12,14.5 r2).
  card: [
    'M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
    'M3 10h18',
    'M14 14.5a2 2 0 1 1-4 0a2 2 0 0 1 4 0z',
  ],
  // Anything else: three dots, horizontal and centred, and nothing else. No ring and nothing upright,
  // so that at 14px it is not the caveat marker (a circle with an i), which means something is wrong
  // when nothing is. The canvas drew a circle with an exclamation mark; that was the error.
  ellipsis: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],

  // Stage 5, drawn and not wired (UNWIRED_TILES and FOREIGN_MARKER, below).
  house: ['m3 11 9-7 9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  // Gold: a stack of coins, seen in section.
  coins: ['M19 7a7 3 0 1 1-14 0a7 3 0 0 1 14 0z', 'M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7', 'M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5'],
  shield: ['M12 3 4 6v6c0 5 3.4 8.2 8 9 4.6-.8 8-4 8-9V6Z'],
  umbrella: ['M3 12a9 9 0 0 1 18 0Z', 'M12 12v6a2.5 2.5 0 0 0 5 0'],
  // Liabilities: a circle containing a minus.
  minus: ['M20.5 12a8.5 8.5 0 1 1-17 0a8.5 8.5 0 0 1 17 0z', 'M8 12h8'],
  globe: [
    'M20.5 12a8.5 8.5 0 1 1-17 0a8.5 8.5 0 0 1 17 0z',
    'M3.5 9.5h17',
    'M3.5 14.5h17',
    'M12 3.5a15 15 0 0 0 0 17',
    'M12 3.5a15 15 0 0 1 0 17',
  ],
};

export interface AssetClassSpec {
  /** The stored value of `instrument.kind`. */
  readonly kind: string;
  /** What a person reads. */
  readonly label: string;
  /**
   * The class's own slot of the chart ramp, 1 to 7, or null for a class that is not a hue.
   * Slot 5 is the prototype's crypto slot and stays empty until a class needs it, rather than lent
   * to something and taken back. `other` has none: it is a real stored value and needs a real tile,
   * but it is not a sixth asset class and must not look like one competing for attention, so it is
   * the neutral grey (`classColour`). "The next colour in the ramp" is the wrong answer for it.
   */
  readonly ramp: 1 | 2 | 3 | 4 | 6 | null;
  readonly glyph: Glyph;
}

/** In the order the classes are listed on a screen that lists them all. */
export const ASSET_CLASSES: readonly AssetClassSpec[] = [
  { kind: 'mutual_fund', label: 'Mutual funds', ramp: 1, glyph: 'trend' },
  { kind: 'equity', label: 'Equity', ramp: 2, glyph: 'bars' },
  { kind: 'bond', label: 'Bonds', ramp: 3, glyph: 'certificate' },
  { kind: 'etf', label: 'ETF', ramp: 4, glyph: 'basket' },
  { kind: 'deposit', label: 'Deposits', ramp: 6, glyph: 'card' },
  { kind: 'other', label: 'Other', ramp: null, glyph: 'ellipsis' },
];

const OTHER: AssetClassSpec = (() => {
  const found = ASSET_CLASSES.find((c) => c.kind === 'other');
  if (found === undefined) {
    throw new Error('ASSET_CLASSES has no `other`: it is the fallback for every kind the app does not model');
  }
  return found;
})();

/**
 * The class for a stored kind. One nobody has heard of is `other`, drawn with the ellipsis, and never
 * nothing: a blank tile on a holding reads as a bug, and a holding of a kind added tomorrow is
 * better shown as "other" than not shown.
 */
export function assetClass(kind: string): AssetClassSpec {
  return ASSET_CLASSES.find((c) => c.kind === kind) ?? OTHER;
}

/** The categorical token for a ramp slot, in the form that reaches both themes. */
export function rampColour(ramp: number): string {
  return `var(--c${String(ramp)})`;
}

/** The colour a class is drawn in, wherever it is drawn: its ramp slot, or the neutral grey. */
export function classColour(spec: AssetClassSpec): string {
  return spec.ramp === null ? 'var(--muted)' : rampColour(spec.ramp);
}

/**
 * The Stage 5 tiles: drawn, and deliberately not wired to anything (docs/design/icons.md §4).
 *
 * They exist so the glyphs and colours are settled when property, gold, retirement, insurance and
 * liabilities arrive, and nothing reads them until then: not `assetClass`, not `ASSET_CLASSES`, not
 * a picker, a legend or a filter. A test fails if anything outside this file and the tests names this
 * constant.
 *
 * Liabilities is the only tile on coral, and the only one carrying a negative signal. That is the
 * reason coral is not available to any other tile: once a second class wears it, a person scanning a
 * list can no longer read coral as "this one subtracts". A test holds it to that.
 */
export const UNWIRED_TILES = {
  property: { glyph: 'house', colour: 'var(--c2)' },
  gold: { glyph: 'coins', colour: 'var(--c3)' },
  retirement: { glyph: 'shield', colour: 'var(--c1)' },
  insurance: { glyph: 'umbrella', colour: 'var(--c4)' },
  liabilities: { glyph: 'minus', colour: 'var(--c5)' },
} as const satisfies Record<string, { glyph: Glyph; colour: string }>;

/**
 * Foreign: a MARKER, and not a class (docs/design/icons.md §4).
 *
 * A foreign holding already has a kind: it is an equity or a fund that happens to be held abroad. So
 * this is deliberately not in `UNWIRED_TILES`, which is a list of things that will one day be kinds, and
 * not in `ASSET_CLASSES`: it takes no slot of the ramp, is never selectable where a kind is, and is
 * never a tile in the same row as the six. It is here only so the globe is drawn once, for the day a
 * holding is marked.
 */
export const FOREIGN_MARKER = { glyph: 'globe', colour: 'var(--c4)' } as const satisfies {
  glyph: Glyph;
  colour: string;
};
