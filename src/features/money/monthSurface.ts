/**
 * The month surface's figures (docs/design/ledger-income.md section 4; the MoneyLedger board).
 *
 * Pure: what came in comes from the household's totals, which include other members' private credits without their rows; what is spent so far
 * is what was itemised, passed in, less the refunds (LI-I3). Came in is per currency and never added across them (LI-I5). Saved is not shown
 * for a month that has not been closed, which is every month until the close is built (LI-I7).
 */

import { money, type Money } from '../../lib/money.ts';
import type { MoneyTotals } from '../../repo/types.ts';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The surface's title: "November so far". The month is the IST calendar month of the day passed in. */
export function monthLabel(today: string): string {
  const name = MONTH_NAMES[Number(today.slice(5, 7)) - 1] ?? '';
  return `${name} so far`;
}

export interface SurfaceFigures {
  /** One line per currency, the one being read first even when nothing came in, and another only when something did. */
  readonly cameIn: readonly Money[];
  /**
   * One line per currency, the one being read first, and another only when something was spent or refunded in it: the itemised spending, other
   * members' private spending, less the refunds, each in its own currency and never converted (LI-I5; the owner, 15 November 2026).
   */
  readonly spent: readonly Money[];
  /** Not shown for a month that is not closed. */
  readonly saved: null;
}

const byCurrency = (reading: string) => (a: string, b: string): number => (a === b ? 0 : a === reading ? -1 : b === reading ? 1 : a < b ? -1 : 1);

export function surfaceFigures(input: {
  readonly totals: readonly MoneyTotals[];
  /** What was itemised in the month, as it was entered: each amount in its own currency. */
  readonly itemised: readonly Money[];
  /** Other members' private spending for the month, which reaches the screen only as a sum for each currency. */
  readonly privateSpend: readonly Money[];
  readonly currency: string;
}): SurfaceFigures {
  const { totals, itemised, privateSpend, currency } = input;
  const order = byCurrency(currency);

  const own = totals.find((line) => line.cameIn.currency === currency);
  const others = totals
    .filter((line) => line.cameIn.currency !== currency && line.cameIn.minor > 0n)
    .map((line) => line.cameIn)
    .sort((a, b) => order(a.currency, b.currency));

  // Spent in each currency: what was itemised and what is private to others, less what was refunded in that currency.
  const spent = new Map<string, bigint>();
  // A currency that something was spent or refunded in keeps its line even when the two cancel, as a line of nothing.
  const touched = new Set<string>();
  const add = (value: Money, sign: 1n | -1n): void => {
    spent.set(value.currency, (spent.get(value.currency) ?? 0n) + sign * value.minor);
    touched.add(value.currency);
  };
  for (const value of itemised) add(value, 1n);
  for (const value of privateSpend) add(value, 1n);
  for (const line of totals) {
    if (line.refunds.minor !== 0n) add(line.refunds, -1n);
  }
  const lines = [...spent.entries()]
    .filter(([code]) => code === currency || touched.has(code))
    .sort(([a], [b]) => order(a, b))
    .map(([code, minor]) => money(minor, code));

  return {
    cameIn: [own?.cameIn ?? money(0n, currency), ...others],
    spent: lines.some((line) => line.currency === currency) ? lines : [money(0n, currency), ...lines],
    saved: null,
  };
}

/**
 * What may make the spent figure short, in words, and whether the person can put it right: other members' private spending could not be read
 * (reloading may), or the month holds more entries than the screen reads (a limit of the screen). Said on the figure and never left out.
 */
export function spentShortReasons(input: { readonly privateUnreadable: boolean; readonly partial: boolean }): { readonly reasons: readonly string[]; readonly fixable: boolean } {
  const reasons: string[] = [];
  if (input.privateUnreadable) reasons.push('Other members’ private spending could not be read just now, so spent may be short. Reload to read it again.');
  if (input.partial) reasons.push('This month holds more entries than this screen reads, so spent is short by the older ones.');
  return { reasons, fixable: input.privateUnreadable };
}
