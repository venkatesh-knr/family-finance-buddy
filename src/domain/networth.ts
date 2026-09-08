/**
 * What the household owns, and what it has not been told.
 *
 * Everything here is per currency and never across currencies. There is no
 * `fx_rate` table yet, so there is no honest way to add a dollar to a rupee —
 * and "every amount carries a currency; never overwrite the original figure
 * with a converted one" is not a rule that bends for a nicer headline. A single
 * net-worth number would mean inventing a rate at the display edge, which is
 * the one place this app must never do arithmetic on money it was not given.
 *
 * The second absence is louder. `liability` records an instalment, not an
 * outstanding balance, so debt cannot be subtracted from anything. Until it
 * can, these are asset totals and must be called that. Labelling them "net
 * worth" would be a figure that is wrong by exactly the size of the mortgage.
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
  /** value − investedValued. Negative is a loss and is shown as one. */
  readonly gain: Money;
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
    { value: bigint; invested: bigint; investedValued: bigint; unvalued: number }
  >();

  for (const holding of options.holdings) {
    if (holding.isArchived) continue;

    const bucket = buckets.get(holding.currency) ?? {
      value: 0n,
      invested: 0n,
      investedValued: 0n,
      unvalued: 0,
    };

    const reading = latest.get(holding.id);
    const cost = holding.cost?.minor ?? 0n;
    bucket.invested += cost;

    if (reading === undefined) {
      bucket.unvalued += 1;
    } else {
      bucket.value += reading.amount.minor;
      bucket.investedValued += cost;
    }

    buckets.set(holding.currency, bucket);
  }

  return [...buckets.entries()]
    .map(([currency, b]) => ({
      currency,
      value: money(b.value, currency),
      invested: money(b.invested, currency),
      investedValued: money(b.investedValued, currency),
      gain: money(b.value - b.investedValued, currency),
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
  /** value − invested. Negative is a loss, and shown as one. */
  readonly gain: Money;
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
  const byKind = new Map<string, { value: bigint; invested: bigint }>();
  let total = 0n;

  for (const holding of options.holdings) {
    if (holding.isArchived || holding.currency !== options.currency) continue;
    const reading = latest.get(holding.id);
    if (reading === undefined) continue;

    const bucket = byKind.get(holding.kind) ?? { value: 0n, invested: 0n };
    bucket.value += reading.amount.minor;
    bucket.invested += holding.cost?.minor ?? 0n;
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
      gain: money(b.value - b.invested, options.currency),
      returnOnCost: b.invested === 0n ? null : Number(b.value - b.invested) / Number(b.invested),
    }))
    .sort((a, b) => b.share - a.share);
}

export interface ReadingGaps {
  /** Named months of the year that finished with no reading anywhere. */
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
 * Which months of a calendar year were never read.
 *
 * The calendar year, not the tax year: foreign-asset disclosure runs January to
 * December while the ledger runs April to March, and confusing the two puts a
 * reading in the wrong disclosure.
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

  const live = holdings.filter((h) => !h.isArchived);
  const liveIds = new Set(live.map((h) => h.id));
  const inYear = valuations.filter(
    (v) => Number(v.date.slice(0, 4)) === year && liveIds.has(v.holdingId),
  );

  const readMonths = new Set(inYear.map((v) => Number(v.date.slice(5, 7))));

  // The last month that has fully finished, as at `today`.
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  const lastComplete = thisYear > year ? 12 : thisYear < year ? 0 : thisMonth - 1;

  const missingMonths: string[] = [];
  for (let month = 1; month <= lastComplete; month++) {
    if (!readMonths.has(month)) missingMonths.push(MONTHS[month - 1] as string);
  }

  const everRead = new Set(valuations.map((v) => v.holdingId));
  const neverRead = live.filter((h) => !everRead.has(h.id)).map((h) => h.id);

  return { missingMonths, neverRead };
}
