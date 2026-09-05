/**
 * The Schedule FA peak, and the honesty around it.
 *
 * Foreign-asset disclosure asks for the highest value a holding reached during
 * the calendar year — not its closing value, which is all a year-end statement
 * can tell you. The figure therefore exists only if the readings were taken,
 * and a peak computed over months that were never recorded is not merely
 * incomplete: it is too low, and too low on a tax form is a wrong number rather
 * than a missing one.
 *
 * So this returns the gaps alongside the figure, and refuses to present a
 * partial answer as a whole one. That is the same instinct as the year-end
 * pack's "list of what the app could not determine" (docs/blueprint.md §698).
 *
 * Pure, as every calculation here must be: no I/O, no queries, and the date is
 * an argument rather than a call to the clock.
 */

import type { IsoDate } from '../lib/dates.ts';
import type { Money } from '../lib/money.ts';

export interface DatedValue {
  readonly date: IsoDate;
  readonly amount: Money;
}

/** A month, as `YYYY-MM`. */
export type IsoMonth = string;

export interface CalendarYearPeak {
  readonly year: number;
  /** Null when nothing at all was recorded. Never zero — zero is a figure. */
  readonly peak: Money | null;
  readonly peakDate: IsoDate | null;
  /** Months that should have a reading and do not. */
  readonly missingMonths: readonly IsoMonth[];
  /** True when any expected month is missing, so the peak is a lower bound. */
  readonly isProvisional: boolean;
}

export interface CalendarYearPeakOptions {
  readonly values: readonly DatedValue[];
  readonly year: number;
  /** Today, in IST. Passed in, never read from the clock. */
  readonly today: IsoDate;
  /**
   * When the holding was acquired. Months before it are not gaps — they were
   * never ours to report, and counting them would cry wolf on every holding
   * bought mid-year.
   */
  readonly heldFrom?: IsoDate | null;
}

function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

function monthNumber(date: IsoDate): number {
  return Number(date.slice(5, 7));
}

export function calendarYearPeak(options: CalendarYearPeakOptions): CalendarYearPeak {
  const { values, year, today, heldFrom = null } = options;

  const inYear = values.filter((value) => yearOf(value.date) === year);

  // Comparing amounts in different currencies would silently produce a
  // meaningless maximum, which is exactly the class of error the currency-on-
  // every-amount rule exists to prevent.
  const currencies = new Set(inYear.map((value) => value.amount.currency));
  if (currencies.size > 1) {
    throw new Error(
      `Cannot take a peak across mixed currencies: ${[...currencies].sort().join(', ')}. Convert at each reading's own date first.`,
    );
  }

  let peak: Money | null = null;
  let peakDate: IsoDate | null = null;
  for (const value of inYear) {
    // `>=` so a tie resolves to the later date: of two equal peaks, the more
    // recent is the one a reader is asking about.
    if (peak === null || value.amount.minor >= peak.minor) {
      peak = value.amount;
      peakDate = value.date;
    }
  }

  // Which months should have a reading: January through December, trimmed at
  // both ends by reality — nothing before the holding existed, nothing after
  // today, since a month still running is not a month anyone failed to record.
  const firstMonth = heldFrom !== null && yearOf(heldFrom) === year ? monthNumber(heldFrom) : 1;
  const lastMonth = yearOf(today) === year ? monthNumber(today) : 12;

  // A holding acquired after this year, or a year entirely in the future.
  const expectedStart = yearOf(heldFrom ?? `${String(year)}-01-01`) > year ? 13 : firstMonth;
  const expectedEnd = yearOf(today) < year ? 0 : lastMonth;

  const monthsRead = new Set(inYear.map((value) => monthOf(value.date)));

  const missingMonths: IsoMonth[] = [];
  for (let month = expectedStart; month <= expectedEnd; month++) {
    const label = `${String(year)}-${String(month).padStart(2, '0')}`;
    if (!monthsRead.has(label)) missingMonths.push(label);
  }

  return {
    year,
    peak,
    peakDate,
    missingMonths,
    isProvisional: missingMonths.length > 0,
  };
}
