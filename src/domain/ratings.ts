/**
 * A bond's rating, and whether a change in it was a downgrade.
 *
 * "Rating changes are logged so a downgrade doesn't pass unnoticed" (docs/blueprint.md,
 * Bonds & fixed income). The log is a table the database writes; this is the reading of
 * it: which way a change went, and whether one is recent enough to be called out.
 *
 * It reads the grade and nothing else. Each agency prints its own prefix (CRISIL, ICRA,
 * CARE, IND, BWR) and some an outlook or a structure suffix ("AA (Stable)", "AAA(SO)"),
 * and none of that is the grade. A short-term rating (A1+) is on a different scale and
 * is not read at all, rather than ranked against a long-term one it cannot be compared
 * with. A change between two things it cannot rank is "unknown", which is a different
 * thing from "unchanged".
 *
 * Pure, and the date is passed in.
 */

import type { IsoDate } from '../lib/dates.ts';

/** Best first. A plus is above its grade and a minus below. */
const SCALE = [
  'AAA',
  'AA+',
  'AA',
  'AA-',
  'A+',
  'A',
  'A-',
  'BBB+',
  'BBB',
  'BBB-',
  'BB+',
  'BB',
  'BB-',
  'B+',
  'B',
  'B-',
  'CCC',
  'CC',
  'C',
  'D',
] as const;

/** A downgrade is called out for this long; the history on the bond keeps it for good. */
export const DOWNGRADE_NOTICE_DAYS = 180;

/** The grade's place on the scale, 0 the best; null if it is not a long-term grade. */
export function ratingRank(rating: string | null | undefined): number | null {
  if (rating === null || rating === undefined) return null;
  // ICRA wraps its name in brackets, [ICRA]AA+, so the brackets are only separators. Then
  // cut an outlook or a structure suffix: "AA (Stable)", "AA/Stable", "AAA(SO)".
  const head = rating.replace(/[[\]]/g, ' ').split(/[/(]/)[0] ?? '';
  const tokens = head.trim().toUpperCase().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const index = (SCALE as readonly string[]).indexOf(tokens[i] ?? '');
    if (index >= 0) return index;
  }
  return null;
}

export type RatingMove = 'upgrade' | 'downgrade' | 'same-grade' | 'first' | 'withdrawn' | 'unknown';

export function ratingMove(from: string | null, to: string | null): RatingMove {
  if (from === null && to !== null) return 'first';
  if (from !== null && to === null) return 'withdrawn';
  const a = ratingRank(from);
  const b = ratingRank(to);
  if (a === null || b === null) return 'unknown';
  if (a === b) return 'same-grade';
  return b > a ? 'downgrade' : 'upgrade';
}

export interface RatingChangeInput {
  /** The order the changes were made in. */
  readonly seq: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly changedOn: IsoDate;
}

const dayNumber = (date: IsoDate): number =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

/** A change as it should be judged: against the last rating that was set, not only its own row. */
export interface JudgedChange {
  readonly seq: number;
  /** The rating it moved from: the last one set before it, even if one was cleared in between. */
  readonly from: string | null;
  readonly to: string | null;
  readonly changedOn: IsoDate;
  readonly move: RatingMove;
}

/**
 * Each change, in the order it was made, judged against the last rating that was set.
 *
 * A row says what it went from and to, and that is not enough: clearing a rating and then
 * entering a lower one is two rows, "AA to nothing" and "nothing to BB", and neither alone
 * is a downgrade. Judged against the last rating that was set, the second is AA to BB. Which
 * is also what makes "first" mean the first rating a bond ever had, and not any that follows a
 * gap.
 */
export function ratingMoves(changes: readonly RatingChangeInput[]): readonly JudgedChange[] {
  let lastSet: string | null = null;
  return [...changes]
    .sort((a, b) => a.seq - b.seq)
    .map((change) => {
      const from = change.from ?? lastSet;
      const move: RatingMove =
        change.to === null ? 'withdrawn' : from === null ? 'first' : ratingMove(from, change.to);
      if (change.to !== null) lastSet = change.to;
      return { seq: change.seq, from, to: change.to, changedOn: change.changedOn, move };
    });
}

export interface RatingWatch {
  /** `unclear` is a change the app could not rank, which is said and not skipped. */
  readonly kind: 'downgrade' | 'unclear' | 'withdrawn';
  readonly from: string | null;
  readonly to: string | null;
  readonly changedOn: IsoDate;
}

/**
 * What to call out about a bond's rating: a downgrade, a change that could not be judged, or
 * a rating that was removed and has not come back, if recent.
 *
 * The latest change that says something is the one that stands. An upgrade clears what was
 * before it; a change of agency or outlook at the same grade, and a first rating, say nothing
 * and are passed over. It is dropped from view after `days`, and not before: the rating
 * history on the bond keeps it for good, and an alarm that never stops is not one.
 */
export function ratingWatch(
  changes: readonly RatingChangeInput[],
  today: IsoDate,
  days: number,
): RatingWatch | null {
  for (const judged of [...ratingMoves(changes)].reverse()) {
    if (judged.move === 'upgrade') return null;
    if (judged.move === 'same-grade' || judged.move === 'first') continue;
    if (dayNumber(today) - dayNumber(judged.changedOn) > days) return null;
    const kind = judged.move === 'downgrade' ? 'downgrade' : judged.move === 'withdrawn' ? 'withdrawn' : 'unclear';
    return { kind, from: judged.from, to: judged.to, changedOn: judged.changedOn };
  }
  return null;
}
