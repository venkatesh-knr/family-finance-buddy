/**
 * What the household owns, and what it has not been told.
 *
 * Everything here is per currency and never across currencies. Adding a dollar to
 * a rupee takes a dated rate (`domain/fx.ts`, from the `fx_rate` table), and
 * "every amount carries a currency; never overwrite the original figure with a
 * converted one" is not a rule that bends for a nicer headline. These totals stay
 * in each currency's own units; the screen converts, with the rates it was given
 * and a refusal where it was given none.
 *
 * These are asset totals and are called that. Debt is held in `domain/debt.ts` and
 * is subtracted by the screen, which says so when it cannot.
 *
 * Pure, and the date is passed in. A gap that depended on the clock would
 * change while somebody was reading it.
 */

import { money, type Money } from '../lib/money.ts';
import type { IsoDate } from '../lib/dates.ts';

export interface HoldingInput {
  readonly id: string;
  readonly memberId: string;
  readonly memberName: string;
  readonly kind: string;
  /** The instrument's own currency. Totals are grouped by it. */
  readonly currency: string;
  /** What it cost, if that was ever recorded. */
  readonly cost: Money | null;
  readonly isArchived: boolean;
  /** When it was acquired, if anybody said. Without it, it is owed a reading from January. */
  readonly openedOn: IsoDate | null;
  /** The IST day it was archived, if it has been. Its months before this still count. */
  readonly archivedOn: IsoDate | null;
  /**
   * Whether that cost covers only part of the units being valued.
   *
   * Required rather than defaulted: a caller that forgot it would read as "the
   * cost is complete", which is the claim this flag exists to withhold. True
   * when a statement's closing balance and the recorded purchases disagree —
   * see `domain/position.ts`.
   */
  readonly costIsShort: boolean;
}

export interface ValuationInput {
  readonly holdingId: string;
  readonly date: IsoDate;
  readonly amount: Money;
}

/**
 * The most recent reading for each holding.
 *
 * A holding absent from the result has never been read, and that is a fact to
 * carry rather than a zero to substitute — the difference between "worth
 * nothing" and "nobody looked" is the whole subject of §606.
 */
export function latestValuationPerHolding(
  valuations: readonly ValuationInput[],
): ReadonlyMap<string, ValuationInput> {
  const latest = new Map<string, ValuationInput>();
  for (const valuation of valuations) {
    const held = latest.get(valuation.holdingId);
    // Dates are ISO, so a string comparison is a date comparison.
    if (held === undefined || valuation.date > held.date) {
      latest.set(valuation.holdingId, valuation);
    }
  }
  return latest;
}

export interface CurrencyTotal {
  readonly currency: string;
  /** The sum of the latest readings. Holdings never read are not in it. */
  readonly value: Money;
  /** What was paid for everything, read or not. */
  readonly invested: Money;
  /** What was paid for the part that has been valued — the only fair base for `gain`. */
  readonly investedValued: Money;
  /**
   * value − investedValued. Negative is a loss and is shown as one.
   *
   * Null where a valued holding's cost is short or missing: the difference would be
   * a number that never happened, and printing it would be worse than saying
   * there is none. The value, and `invested`, are still true and still here.
   */
  readonly gain: Money | null;
  /** How many valued holdings have a cost covering only part of their units. */
  readonly costShort: number;
  /**
   * How many valued holdings have no cost recorded at all. A cost nobody recorded is
   * not a cost of zero: counted as one it would turn a gain into a larger gain, so
   * the gain is refused, for the same reason it is where the cost is short.
   */
  readonly costMissing: number;
  /** How many holdings have never been read. A total with these in it is short. */
  readonly unvalued: number;
}

export function assetTotals(options: {
  readonly holdings: readonly HoldingInput[];
  readonly valuations: readonly ValuationInput[];
}): readonly CurrencyTotal[] {
  const latest = latestValuationPerHolding(options.valuations);
  const buckets = new Map<
    string,
    {
      value: bigint;
      invested: bigint;
      investedValued: bigint;
      unvalued: number;
      costShort: number;
      costMissing: number;
    }
  >();

  for (const holding of options.holdings) {
    if (holding.isArchived) continue;

    const bucket = buckets.get(holding.currency) ?? {
      value: 0n,
      invested: 0n,
      investedValued: 0n,
      unvalued: 0,
      costShort: 0,
      costMissing: 0,
    };

    const reading = latest.get(holding.id);
    const cost = holding.cost?.minor ?? 0n;
    bucket.invested += cost;

    if (reading === undefined) {
      bucket.unvalued += 1;
    } else {
      bucket.value += reading.amount.minor;
      bucket.investedValued += cost;
      // Only once it has been read: an unvalued holding is on neither side of
      // the comparison, so its short cost is not a reason to refuse it.
      if (holding.costIsShort) bucket.costShort += 1;
      if (holding.cost === null) bucket.costMissing += 1;
    }

    buckets.set(holding.currency, bucket);
  }

  return [...buckets.entries()]
    .map(([currency, b]) => ({
      currency,
      value: money(b.value, currency),
      invested: money(b.invested, currency),
      investedValued: money(b.investedValued, currency),
      gain: b.costShort > 0 || b.costMissing > 0 ? null : money(b.value - b.investedValued, currency),
      costShort: b.costShort,
      costMissing: b.costMissing,
      unvalued: b.unvalued,
    }))
    .sort((a, b) => (b.value.minor > a.value.minor ? 1 : b.value.minor < a.value.minor ? -1 : 0));
}

export interface AllocationRow {
  readonly kind: string;
  readonly value: Money;
  /** Of the valued total in this currency. 0…1, and never NaN. */
  readonly share: number;
  /** What was paid for the holdings in this class that have been valued. */
  readonly invested: Money;
  /** value − invested. Negative is a loss, and shown as one. Null where the cost is short or missing. */
  readonly gain: Money | null;
  /** How many holdings in this class have a cost covering only part of their units. */
  readonly costShort: number;
  /** How many valued holdings in this class have no cost recorded: see `CurrencyTotal`. */
  readonly costMissing: number;
  /**
   * Gain as a fraction of cost, or null when nothing was paid — a class with
   * no recorded cost has no return, and 0% would be a claim rather than an
   * absence.
   */
  readonly returnOnCost: number | null;
}

export function allocationByKind(options: {
  readonly holdings: readonly HoldingInput[];
  readonly valuations: readonly ValuationInput[];
  readonly currency: string;
}): readonly AllocationRow[] {
  const latest = latestValuationPerHolding(options.valuations);
  const byKind = new Map<
    string,
    { value: bigint; invested: bigint; costShort: number; costMissing: number }
  >();
  let total = 0n;

  for (const holding of options.holdings) {
    if (holding.isArchived || holding.currency !== options.currency) continue;
    const reading = latest.get(holding.id);
    if (reading === undefined) continue;

    const bucket = byKind.get(holding.kind) ?? { value: 0n, invested: 0n, costShort: 0, costMissing: 0 };
    bucket.value += reading.amount.minor;
    bucket.invested += holding.cost?.minor ?? 0n;
    if (holding.costIsShort) bucket.costShort += 1;
    if (holding.cost === null) bucket.costMissing += 1;
    byKind.set(holding.kind, bucket);
    total += reading.amount.minor;
  }

  // Nothing valued means no shares. A denominator of zero would give Infinity
  // or NaN, and a chart would draw it as though it meant something.
  if (total === 0n) return [];

  return [...byKind.entries()]
    // A kind worth nothing has no share of anything. It was read, and read as
    // zero — which is worth saying, but on the attention list rather than as a
    // 0.0% row that adds a line to a chart and no information to it.
    .filter(([, b]) => b.value !== 0n)
    .map(([kind, b]) => ({
      kind,
      value: money(b.value, options.currency),
      share: Number(b.value) / Number(total),
      invested: money(b.invested, options.currency),
      // A short cost has no return, for the same reason it has no gain: a class
      // holding one would print a percentage set against money never paid.
      gain: b.costShort > 0 || b.costMissing > 0 ? null : money(b.value - b.invested, options.currency),
      costShort: b.costShort,
      costMissing: b.costMissing,
      returnOnCost:
        b.costShort > 0 || b.costMissing > 0 || b.invested === 0n
          ? null
          : Number(b.value - b.invested) / Number(b.invested),
    }))
    .sort((a, b) => b.share - a.share);
}

export interface MonthGap {
  readonly month: string;
  /** The holdings that existed in that month and were not read in it. */
  readonly holdingIds: readonly string[];
}

export interface ReadingGaps {
  /** Months of the year that finished with some holding unread, and which. */
  readonly missing: readonly MonthGap[];
  /** The same months by name, in order. */
  readonly missingMonths: readonly string[];
  /** Holdings with no reading at all, ever. */
  readonly neverRead: readonly string[];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Which months of a calendar year some holding went unread.
 *
 * The calendar year, not the tax year: foreign-asset disclosure runs January to
 * December while the ledger runs April to March, and confusing the two puts a
 * reading in the wrong disclosure.
 *
 * Holding by holding. A peak is a figure per instrument, so a month is covered
 * only if every holding that existed in it was read in it; one fund read every
 * month must not cover for another that was read once. A holding is owed a
 * reading from the month it was opened (from January if nobody said when) until
 * the month before it was archived, because its peak may have fallen in those
 * months and the archive does not unwrite them. An archived holding with no
 * archive date cannot be placed and is owed nothing.
 *
 * A month that has not finished is not missing — it is unfinished. Calling it a
 * gap would show a permanent-looking fault every single month.
 */
export function readingGaps(options: {
  readonly holdings: readonly HoldingInput[];
  readonly valuations: readonly ValuationInput[];
  readonly year: number;
  readonly today: IsoDate;
}): ReadingGaps {
  const { holdings, valuations, year, today } = options;

  const readIn = new Map<string, Set<number>>();
  for (const v of valuations) {
    if (Number(v.date.slice(0, 4)) !== year) continue;
    const months = readIn.get(v.holdingId) ?? new Set<number>();
    months.add(Number(v.date.slice(5, 7)));
    readIn.set(v.holdingId, months);
  }

  // The last month that has fully finished, as at `today`.
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  const lastComplete = thisYear > year ? 12 : thisYear < year ? 0 : thisMonth - 1;

  // The first and last month of the year a holding is owed a reading in.
  const owedFrom = (h: HoldingInput): number => {
    if (h.openedOn === null) return 1;
    const y = Number(h.openedOn.slice(0, 4));
    return y < year ? 1 : y > year ? 13 : Number(h.openedOn.slice(5, 7));
  };
  const owedThrough = (h: HoldingInput): number => {
    if (!h.isArchived) return 12;
    if (h.archivedOn === null) return 0;
    const y = Number(h.archivedOn.slice(0, 4));
    return y < year ? 0 : y > year ? 12 : Number(h.archivedOn.slice(5, 7)) - 1;
  };

  const missing: MonthGap[] = [];
  for (let month = 1; month <= lastComplete; month++) {
    const holdingIds = holdings
      .filter((h) => month >= owedFrom(h) && month <= owedThrough(h))
      .filter((h) => readIn.get(h.id)?.has(month) !== true)
      .map((h) => h.id);
    if (holdingIds.length > 0) missing.push({ month: MONTHS[month - 1] as string, holdingIds });
  }

  const everRead = new Set(valuations.map((v) => v.holdingId));
  const neverRead = holdings.filter((h) => !h.isArchived && !everRead.has(h.id)).map((h) => h.id);

  return { missing, missingMonths: missing.map((m) => m.month), neverRead };
}

/** A reading further behind the newest than this is said to be old. */
export const STALE_AFTER_DAYS = 45;

export interface StaleReading {
  readonly holdingId: string;
  readonly lastRead: IsoDate;
}

export interface ReadingStaleness {
  /** The newest of each live holding's latest reading: the honest "as at". */
  readonly newest: IsoDate | null;
  /** The oldest of them: what the figure is partly made of. */
  readonly oldest: IsoDate | null;
  /** Live holdings whose latest reading is more than the window behind `newest`. */
  readonly stale: readonly StaleReading[];
}

const dayNumber = (d: IsoDate): number =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;

/**
 * How old is each part of a total that says "as at".
 *
 * A net worth blends the date of every holding's latest reading, and a single
 * "as at" over it is true of only the newest. This takes the date from what is in
 * the figure (live holdings only, so an archived fund's last reading cannot
 * freshen it) and names the readings far behind it. A holding never read is
 * unvalued, which is a different thing and is said elsewhere.
 */
export function readingStaleness(options: {
  readonly holdings: readonly HoldingInput[];
  readonly valuations: readonly ValuationInput[];
}): ReadingStaleness {
  const live = new Set(options.holdings.filter((h) => !h.isArchived).map((h) => h.id));
  const latest = latestValuationPerHolding(options.valuations.filter((v) => live.has(v.holdingId)));
  const reads = [...latest.values()];
  if (reads.length === 0) return { newest: null, oldest: null, stale: [] };

  const dates = reads.map((r) => r.date).sort();
  const newest = dates[dates.length - 1] as IsoDate;
  const oldest = dates[0] as IsoDate;
  const stale = reads
    .filter((r) => dayNumber(newest) - dayNumber(r.date) > STALE_AFTER_DAYS)
    .map((r) => ({ holdingId: r.holdingId, lastRead: r.date }));
  return { newest, oldest, stale };
}
