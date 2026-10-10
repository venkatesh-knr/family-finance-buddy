/**
 * A number typed into a field, kept only when the field is left.
 *
 * The FIRE inputs were bound straight to the stored number: every keystroke parsed, stored and wrote to the
 * household. Two things followed. "7." parsed to 7 and rendered as "7", so the point was gone before a 5
 * could follow it and 7.5 could not be typed at all. And each keystroke was an audited write that a partner
 * could load halfway through "12", as 1.
 *
 * So the field holds a draft, and this turns the draft into the number to keep, or nothing.
 */

export interface DraftRange {
  readonly min: number;
  readonly max: number;
  /** Whole numbers only: a count of years and not a rate. */
  readonly integer: boolean;
}

/** What may be typed while the draft is still being written: digits, and one point where a decimal is allowed. */
export function draftPattern(integer: boolean): RegExp {
  return integer ? /^\d*$/ : /^\d*\.?\d*$/;
}

/**
 * The figure to keep, held to its bounds, or null when the draft is not one and the field should go back
 * to what is stored. A figure out of range is held to the nearer bound and not refused: somebody typing 75
 * where 50 is the most meant a large number, not nothing.
 */
export function parseDraft(text: string, range: DraftRange): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '.') return null;
  if (!draftPattern(range.integer).test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.min(range.max, Math.max(range.min, value));
}
