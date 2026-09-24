/**
 * What the household's holdings were worth, month by month.
 *
 * Built only from readings somebody recorded, and only where the sum is honest.
 * The two ways a total can be quietly wrong are both refused here:
 *
 *   * A holding nobody had read yet is not worth nothing, it is unknown. A
 *     month-end that leaves it out draws the household as poorer than it was,
 *     and then as suddenly richer the month the first reading lands. So the
 *     history starts at the first month every holding is covered, and says
 *     what stopped it going further back.
 *
 *   * A holding in another currency converts at the rate of the month it is
 *     drawn for — "Yesterday's net worth must not change because the rupee
 *     moved today" — and a month with no rate is not drawn rather than drawn at
 *     a rate from the future.
 *
 * These are assets and not net worth. Liabilities record an instalment, and
 * only some have an outstanding balance with a date to place it at, so there is
 * no dated debt to subtract; the chart is titled for what it is.
 *
 * Pure, and the as-at date is passed in.
 */

import { type IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';
import { convert, type MissingRate, type Rate } from './fx.ts';

export interface HistoryHolding {
  readonly id: string;
  readonly currency: string;
  /**
   * When it was acquired, if anybody said. Without a date it is owed a reading
   * from the very start: guessing that it began the day it was first read would
   * make the history jump on a day nothing happened.
   */
  readonly openedOn: IsoDate | null;
  readonly isArchived: boolean;
}

export interface HistoryReading {
  readonly holdingId: string;
  readonly date: IsoDate;
  readonly amount: Money;
}

export interface HistoryPoint {
  readonly date: IsoDate;
  readonly total: Money;
}

/** Why the history does not reach further back than it does. */
export type HistoryLimit =
  | { readonly reason: 'unread'; readonly at: IsoDate; readonly holdingIds: readonly string[] }
  | { readonly reason: 'rate'; readonly at: IsoDate; readonly missing: readonly MissingRate[] };

export type AssetHistory =
  | {
      readonly ok: true;
      /** Oldest first; the last is the as-at date. At least two. */
      readonly points: readonly HistoryPoint[];
      /** Null when nothing stopped it: the history begins where the readings do. */
      readonly limitedBy: HistoryLimit | null;
    }
  | { readonly ok: false; readonly reason: 'nothing' }
  | { readonly ok: false; readonly reason: 'short' }
  | { readonly ok: false; readonly reason: 'unread'; readonly holdingIds: readonly string[] }
  | { readonly ok: false; readonly reason: 'rate'; readonly missing: readonly MissingRate[] };

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The last calendar day of every month from the one `from` is in through `to`,
 * keeping only those that fall on or before `to`.
 *
 * Calendar dates throughout, so there is no timezone to be wrong in: month-end
 * in IST is the last day of the month, and these are already IST dates.
 */
export function monthEndsThrough(from: IsoDate, to: IsoDate): IsoDate[] {
  const ends: IsoDate[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7)); // 1-12
  for (;;) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const end = `${String(year)}-${pad(month)}-${pad(lastDay)}`;
    if (end > to) break;
    if (end >= from) ends.push(end);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return ends;
}

/** A limit before it has been given a date. */
type Cause =
  | { readonly reason: 'unread'; readonly holdingIds: readonly string[] }
  | { readonly reason: 'rate'; readonly missing: readonly MissingRate[] };

type Total =
  | { readonly ok: true; readonly total: Money }
  | { readonly ok: false; readonly limit: Cause };

export function assetHistory(options: {
  readonly holdings: readonly HistoryHolding[];
  readonly readings: readonly HistoryReading[];
  readonly rates: readonly Rate[];
  /** The currency the line is drawn in. */
  readonly display: string;
  readonly asOf: IsoDate;
}): AssetHistory {
  const { rates, display, asOf } = options;
  const holdings = options.holdings.filter((h) => !h.isArchived);
  if (holdings.length === 0) return { ok: false, reason: 'nothing' };

  const byHolding = new Map<string, HistoryReading[]>();
  for (const held of holdings) byHolding.set(held.id, []);
  for (const r of options.readings) byHolding.get(r.holdingId)?.push(r);

  const totalOn = (date: IsoDate): Total => {
    const unread: string[] = [];
    const missing = new Map<string, MissingRate>();
    let sum = 0n;
    for (const held of holdings) {
      let latest: HistoryReading | null = null;
      for (const r of byHolding.get(held.id) ?? []) {
        if (r.date <= date && (latest === null || r.date > latest.date)) latest = r;
      }
      if (latest === null) {
        // Not owed a reading before it was opened; owed one from then on.
        if (held.openedOn === null || held.openedOn <= date) unread.push(held.id);
        continue;
      }
      const converted = convert(latest.amount, display, rates, date);
      if (converted.ok) sum += converted.amount.minor;
      else missing.set(`${converted.missing.base}/${converted.missing.quote}`, converted.missing);
    }
    // Unread is the more basic of the two: a rate cannot be asked of a figure
    // that is not there.
    if (unread.length > 0) return { ok: false, limit: { reason: 'unread', holdingIds: unread } };
    if (missing.size > 0) return { ok: false, limit: { reason: 'rate', missing: [...missing.values()] } };
    return { ok: true, total: money(sum, display) };
  };

  // The as-at figure first. If it cannot be stated there is no history to draw
  // the end of, and the reason is the one to give.
  const now = totalOn(asOf);
  if (!now.ok) return { ok: false, ...now.limit };

  let earliest: IsoDate | null = null;
  for (const held of holdings) {
    for (const r of byHolding.get(held.id) ?? []) {
      if (r.date <= asOf && (earliest === null || r.date < earliest)) earliest = r.date;
    }
  }
  // now.ok means every holding was read, so a reading exists.
  if (earliest === null) return { ok: false, reason: 'nothing' };

  const dates = monthEndsThrough(earliest, asOf);
  if (dates[dates.length - 1] !== asOf) dates.push(asOf);

  // The longest run of good months ending now. Walking back and stopping at the
  // first failure, rather than skipping it, because a line with a hole in it
  // joins two months it has no business joining.
  const points: HistoryPoint[] = [];
  let limitedBy: HistoryLimit | null = null;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const date = dates[i];
    if (date === undefined) continue;
    const total = totalOn(date);
    if (!total.ok) {
      limitedBy = { ...total.limit, at: date };
      break;
    }
    points.unshift({ date, total: total.total });
  }

  if (points.length < 2) return { ok: false, reason: 'short' };
  return { ok: true, points, limitedBy };
}
