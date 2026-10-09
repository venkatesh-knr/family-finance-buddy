/**
 * An asset class, in one place: what it is called, which slot of the chart ramp it owns, and the
 * glyph on its tile.
 *
 * These were three separate maps (a label, a colour, and now a tile) keyed by the same strings, and
 * three maps keyed alike is how one of them gets a class the others do not. So the class is the
 * unit and the rest are properties of it. The ramp slot in particular is a property of the class
 * and not a position in a list: `ramp: 3` means Bonds is the third step of `--c1…--c7` whatever is
 * drawn beside it, whatever order the rows come in, and however large the class is. Coloured by
 * position, a class is one colour when it is third largest and another when it is second
 * (`docs/tokens.md` §6).
 *
 * What the classes ARE, and which exist, belongs to `INSTRUMENT_KINDS` in the repository layer; a
 * test holds this list to exactly that set, so a kind added there fails here until it has a tile.
 *
 * Pure data. The glyphs are path strings and the tile that draws them is `AssetTile.tsx`, so
 * "every kind has a tile" is something a unit test can assert without a DOM.
 */

/** Which glyph. Named for what it is drawn as, not for the class that uses it. */
export type Glyph = 'bars' | 'grid' | 'pie' | 'certificate' | 'bank' | 'dots';

/**
 * Each glyph as SVG path data on a 24-unit square, to be stroked, not filled: 1.75 wide, round caps
 * and joins, in the class colour. Simple shapes that stay legible at 16px, and different enough in
 * outline that the class does not depend on its colour to be told apart, which is §2's rule for
 * everything else on these screens.
 */
export const GLYPHS: Record<Glyph, readonly string[]> = {
  // Shares: bars that rise.
  bars: ['M6 20v-6', 'M12 20V9', 'M18 20V4'],
  // An ETF: a basket of holdings.
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  // A mutual fund: a pool, divided. A slice pulled out, which is what stops it reading as a clock.
  pie: ['M12 12V3a9 9 0 1 0 9 9z', 'M14 10V1a9 9 0 0 1 9 9z'],
  // A bond: the certificate, with its seal.
  certificate: ['M5 3h14v18H5z', 'M9 8h6', 'M9 12h6', 'M12 17.5h.01'],
  // A deposit: the bank.
  bank: ['M3 9l9-5 9 5z', 'M6 12v6', 'M10 12v6', 'M14 12v6', 'M18 12v6', 'M4 20h16'],
  // Anything else: a ring and an ellipsis. A real mark, so an unclassified holding is not a blank.
  dots: ['M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0z', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01'],
};

export interface AssetClassSpec {
  /** The stored value of `instrument.kind`. */
  readonly kind: string;
  /** What a person reads. */
  readonly label: string;
  /**
   * The class's own slot of the chart ramp, 1 to 7. Slot 5 is the prototype's crypto slot and stays
   * empty until a class needs it, rather than lent to something and taken back.
   */
  readonly ramp: 1 | 2 | 3 | 4 | 6 | 7;
  readonly glyph: Glyph;
}

/** In the order the classes are listed on a screen that lists them all. */
export const ASSET_CLASSES: readonly AssetClassSpec[] = [
  { kind: 'mutual_fund', label: 'Mutual funds', ramp: 1, glyph: 'pie' },
  { kind: 'equity', label: 'Equity', ramp: 2, glyph: 'bars' },
  { kind: 'bond', label: 'Bonds', ramp: 3, glyph: 'certificate' },
  { kind: 'etf', label: 'ETF', ramp: 4, glyph: 'grid' },
  { kind: 'deposit', label: 'Deposits', ramp: 6, glyph: 'bank' },
  { kind: 'other', label: 'Other', ramp: 7, glyph: 'dots' },
];

const OTHER = ASSET_CLASSES[ASSET_CLASSES.length - 1] as AssetClassSpec;

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
