/**
 * The month: Came in · Spent · Saved, the Ledger's lifted surface (docs/design/ledger-income.md sections 1 and 4; the MoneyLedger board).
 *
 * Came in is the household's total for the month, from the sum function, so it includes other members' private credits without their rows,
 * and it is per currency. Spent is what has been itemised so far, less the refunds, and says so. Saved is not shown for a month that has not
 * been closed (LI-I7): it is a dash and *after the close*. Spent against the plan, which was the lifted figure, is the soft panel under it.
 *
 * A figure that could not be read is not shown as nothing: it says it could not be read.
 */

import { formatMoney } from '../../lib/money.ts';
import { ShortFigure } from '../expenses/budgetView.tsx';
import { monthLabel, surfaceFigures } from './monthSurface.ts';
import { useMonthTotals } from './useMonthTotals.ts';
import type { BudgetComparisonView } from '../expenses/budgetView.tsx';

export function MonthSurface({
  view,
  householdId,
  today,
  privacy,
  refreshKey,
}: {
  /** The month's figures from the spending screen: its itemised total, in the currency being read, with its caveats. */
  view: BudgetComparisonView;
  householdId: string | null;
  today: string;
  privacy: boolean;
  /** Changes when a credit was written or changed. */
  refreshKey: unknown;
}) {
  const month = useMonthTotals(householdId, view.bounds.start, view.bounds.end, refreshKey);
  const figures = month.status === 'ready' ? surfaceFigures({ totals: month.totals, spent: view.totals.spent, currency: view.currency }) : null;

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
                {formatMoney(figures.spent, { privacy })}
                {/* The marks that ride on the plan's figure ride on this one too: it is the figure people read now (Pass 4: refuse, do not guess). */}
                <ShortFigure view={view} />
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
        {figures?.refundsInOtherCurrencies === true && ' A refund in another currency is not taken off spent here.'}{' '}
        {month.status === 'failed' && 'Came in could not be read just now; reload to read it again.'}
      </p>
    </section>
  );
}
