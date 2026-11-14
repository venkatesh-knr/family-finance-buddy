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
  /** The itemised spending less the refunds in the same currency. */
  readonly spent: Money;
  /** Not shown for a month that is not closed. */
  readonly saved: null;
  /** A refund in another currency is not taken off the spent figure, which is in one currency; the surface says so. */
  readonly refundsInOtherCurrencies: boolean;
}

export function surfaceFigures(input: { readonly totals: readonly MoneyTotals[]; readonly spent: Money; readonly currency: string }): SurfaceFigures {
  const { totals, spent, currency } = input;
  const own = totals.find((line) => line.cameIn.currency === currency);
  const others = totals
    .filter((line) => line.cameIn.currency !== currency && line.cameIn.minor > 0n)
    .map((line) => line.cameIn)
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
  const refundsOwn = own?.refunds.minor ?? 0n;
  return {
    cameIn: [own?.cameIn ?? money(0n, currency), ...others],
    spent: money(spent.minor - refundsOwn, spent.currency),
    saved: null,
    refundsInOtherCurrencies: totals.some((line) => line.refunds.currency !== currency && line.refunds.minor > 0n),
  };
}
