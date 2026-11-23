/**
 * What each month of the window spent, for months of cover (docs/design/spending-capture.md section 11.4; card-cycles.md 8.4; the owner, 23 November 2026).
 *
 * Each month is read from its best source, each currency on its own: the close's spent where the month was closed from balances, else a stated spend, else
 * what was itemised (`coverAmounts`). The amounts are converted at the rate for the month's last day, so a month does not change because the rupee moved
 * today, and added. Pure: everything is passed in, already read.
 */

import { convert, type Rate } from '../../domain/fx.ts';
import { monthBounds } from '../../domain/budget.ts';
import { coverAmounts } from '../../domain/spend-source.ts';
import { money, type Money } from '../../lib/money.ts';
import { closeFigures, type CloseInput } from '../money/closeMonth.ts';

/**
 * What the close says a month cost, in each currency, for months of cover: the very function the close uses, over the same reads, so the two cannot say different things. Null where the month cannot be closed
 * from what is read (a balance is missing, a card waits for its statement): it is then read from the next source and is not named as from balances. A figure below nothing is read as nothing, since a month
 * cannot cost less than nothing and a negative one would pull the average down; the month is still from balances and says so.
 */
export function closedSpend(input: CloseInput): readonly Money[] | null {
  const figures = closeFigures(input);
  if (figures.status !== 'figures') return null;
  return figures.currencies.map((each) => money(each.spent > 0n ? each.spent : 0n, each.currency));
}

export type MonthlyExpenses =
  | { readonly ok: true; readonly monthlyExpenses: readonly { readonly month: string; readonly spent: Money }[] }
  | { readonly ok: false; readonly missing: string };

export function coverMonthlyExpenses(input: {
  readonly window: readonly string[];
  readonly display: string;
  readonly rates: readonly Rate[];
  /** What the close says was spent in each month closed from balances, in each currency. */
  readonly closed: ReadonlyMap<string, readonly Money[]>;
  /** Every stated spend, one per month and currency. */
  readonly stated: readonly { readonly month: string; readonly amount: Money }[];
  /** What was itemised in each month, in each currency. */
  readonly itemised: ReadonlyMap<string, readonly Money[]>;
}): MonthlyExpenses {
  const monthlyExpenses: { month: string; spent: Money }[] = [];
  for (const month of input.window) {
    const { end } = monthBounds(`${month}-01`);
    const closed = input.closed.get(month);
    const amounts = coverAmounts({
      closed: closed === undefined ? null : closed,
      stated: input.stated.filter((statement) => statement.month === month).map((statement) => statement.amount),
      itemised: input.itemised.get(month) ?? [],
    });
    let total = 0n;
    for (const amount of amounts) {
      const converted = convert(amount, input.display, input.rates, end);
      if (!converted.ok) return { ok: false, missing: converted.missing.base };
      total += converted.amount.minor;
    }
    monthlyExpenses.push({ month, spent: money(total, input.display) });
  }
  return { ok: true, monthlyExpenses };
}
