/**
 * The month: Came in · Spent · Saved, the Ledger's lifted surface (docs/design/ledger-income.md sections 1 and 4; the MoneyLedger board).
 *
 * Came in is the household's total for the month, from the sum function, so it includes other members' private credits without their rows,
 * and it is per currency. Spent is what has been itemised so far and other members' private spending, less the refunds, and says so; it is per
 * currency too, each as it was entered and never converted (LI-I5; the owner, 15 November 2026). Saved is not shown for a month that has not
 * been closed (LI-I7): it is a dash and *after the close*. Spent against the plan, which was the lifted figure, is the soft panel under it.
 *
 * A figure that could not be read is not shown as nothing: it says it could not be read.
 */

import { formatMoney } from '../../lib/money.ts';
import type { Expense, PersonalSpendPeriods } from '../../repo/types.ts';
import { Caveat } from '../../ui/primitives.tsx';
import { monthLabel, spentShortReasons, surfaceFigures } from './monthSurface.ts';
import { useMonthTotals } from './useMonthTotals.ts';

export function MonthSurface({
  bounds,
  currency,
  expenses,
  personalSpend,
  partial,
  householdId,
  today,
  privacy,
  refreshKey,
}: {
  /** The month's first and last day. */
  bounds: { readonly start: string; readonly end: string };
  /** The currency read first: the household's own, or this device's choice. Nothing is converted into it. */
  currency: string;
  /** The entries the spending screen holds, each in the currency it was entered in. */
  expenses: readonly Expense[];
  /** Other members' private sums, or null when they could not be read, which the figure must say. */
  personalSpend: PersonalSpendPeriods | null;
  /** The listing holds only the most recent entries and the month reaches back past the oldest: the figure is short by the older ones. */
  partial: boolean;
  householdId: string | null;
  today: string;
  privacy: boolean;
  /** Changes when a credit was written or changed. */
  refreshKey: unknown;
}) {
  const month = useMonthTotals(householdId, bounds.start, bounds.end, refreshKey);
  const itemised = expenses.filter((expense) => !expense.isVoided && expense.date >= bounds.start && expense.date <= bounds.end).map((expense) => expense.amount);
  const privateSpend = (personalSpend?.month ?? []).map((entry) => entry.total);
  const figures = month.status === 'ready' ? surfaceFigures({ totals: month.totals, itemised, privateSpend, currency }) : null;
  const shortBy = spentShortReasons({ privateUnreadable: personalSpend === null, partial });

  return (
    <section className="card card-lift" aria-label="The month so far">
      <span className="label">{monthLabel(today)}</span>
      <dl className="mt-2.5 grid gap-x-4 gap-y-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 6.25rem), 1fr))' }}>
        <div>
          <dt className="label">Came in</dt>
          <dd className="stat-card-value tabular-nums" data-testid="month-came-in">
            {figures === null ? (
              month.status === 'failed' ? (
                <span className="note">could not be read</span>
              ) : (
                <span className="note">Reading…</span>
              )
            ) : (
              figures.cameIn.map((line) => (
                <span key={line.currency} className="block">
                  {formatMoney(line, { privacy })}
                </span>
              ))
            )}
          </dd>
          <dd className="note">counts every kind but refunds</dd>
        </div>
        <div>
          <dt className="label">Spent</dt>
          <dd className="stat-card-value tabular-nums" data-testid="month-spent">
            {figures === null ? (
              <span className="note">{month.status === 'failed' ? 'could not be read' : 'Reading…'}</span>
            ) : (
              <>
                {figures.spent.map((line) => (
                  <span key={line.currency} className="block">
                    {formatMoney(line, { privacy })}
                  </span>
                ))}
                {/* What may make the figure short rides on the figure, not in a footnote (Pass 4: refuse, do not guess). */}
                {shortBy.reasons.length > 0 && (
                  <Caveat tone={shortBy.fixable ? 'warn' : 'info'} label="Why spent may be short">
                    {shortBy.reasons.map((reason) => (
                      <span key={reason} className="mb-1.5 block">
                        {reason}
                      </span>
                    ))}
                  </Caveat>
                )}
              </>
            )}
          </dd>
          <dd className="note">itemised so far</dd>
        </div>
        <div>
          <dt className="label">Saved</dt>
          <dd className="stat-card-value absent" data-testid="month-saved">
            <span aria-hidden="true">—</span>
            <span className="sr-only">not shown until the month is closed</span>
          </dd>
          <dd className="note">after the close</dd>
        </div>
      </dl>
      <p className="note mt-2.5">
        Refunds take away from spent. Money moved between your own accounts, and into holdings, is in neither.
        {month.status === 'failed' && 'Came in could not be read just now; reload to read it again.'}
      </p>
    </section>
  );
}
