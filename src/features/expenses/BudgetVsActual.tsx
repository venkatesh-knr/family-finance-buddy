/**
 * What was planned, against what was spent.
 *
 * The card that makes the plan and the ledger worth having together. Its point
 * is the pace column rather than the difference column: a month-end total says
 * what happened, a pace says it while there is still something to do about it.
 *
 * Everything shown here is computed by pure functions the tests cover; this
 * file decides only what to show and in what order.
 */

import { useMemo, useState } from 'react';
import {
  compareToBudget,
  daysElapsedIn,
  daysInclusive,
  monthBounds,
  taxYearBounds,
  type BudgetComparison,
  type CategoryActual,
  type CategoryPlanned,
} from '../../domain/budget.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import type { Budget, Expense, ExpenseCategory } from '../../repo/types.ts';
import { Card, Pill } from '../../ui/primitives.tsx';

type Period = 'month' | 'year';

export function BudgetVsActual({
  categories,
  budgets,
  expenses,
  today,
  fy,
  currency,
  privacy,
}: {
  categories: readonly ExpenseCategory[];
  budgets: readonly Budget[];
  expenses: readonly Expense[];
  today: string;
  fy: number;
  currency: string;
  privacy: boolean;
}) {
  const [period, setPeriod] = useState<Period>('month');

  const bounds = useMemo(
    () => (period === 'month' ? monthBounds(today) : taxYearBounds(fy)),
    [period, today, fy],
  );

  const daysInPeriod = useMemo(() => daysInclusive(bounds.start, bounds.end), [bounds]);
  const daysElapsed = useMemo(() => daysElapsedIn(bounds, today), [bounds, today]);

  const planned = useMemo<readonly CategoryPlanned[]>(() => {
    return categories
      .filter((category) => !category.isArchived)
      .map((category) => {
        const monthly = budgets.find((b) => b.categoryId === category.id && b.cadence === 'monthly');
        const yearly = budgets.find((b) => b.categoryId === category.id && b.cadence === 'yearly');

        // A month is compared against the monthly plan alone. Spreading a
        // yearly figure over twelve would invent a monthly budget nobody set —
        // a school fee is not a twelfth of itself every month, and a category
        // would look permanently under until the month it was actually paid.
        const minor =
          period === 'month'
            ? (monthly?.planned.minor ?? null)
            : (monthly === undefined && yearly === undefined
                ? null
                : (monthly?.planned.minor ?? 0n) * 12n + (yearly?.planned.minor ?? 0n));

        return {
          categoryId: category.id,
          name: category.name,
          nature: category.nature,
          planned: minor === null ? null : money(minor, currency),
        };
      });
  }, [categories, budgets, period, currency]);

  const actuals = useMemo<readonly CategoryActual[]>(() => {
    return expenses
      .filter(
        (expense) =>
          !expense.isVoided && expense.date >= bounds.start && expense.date <= bounds.end,
      )
      .map((expense) => ({ categoryId: expense.categoryId, spent: expense.amount }));
  }, [expenses, bounds]);

  const rows = useMemo(
    () => compareToBudget({ planned, actuals, daysElapsed, daysInPeriod }),
    [planned, actuals, daysElapsed, daysInPeriod],
  );

  // Whatever is over comes first, then the rest by what has been spent. A list
  // in category order buries the one row worth acting on.
  const ordered = useMemo(() => {
    const rank: Record<BudgetComparison['state'], number> = {
      over: 0,
      'on-track': 1,
      under: 2,
      unplanned: 3,
    };
    return [...rows].sort(
      (a, b) => rank[a.state] - rank[b.state] || Number(b.spent.minor - a.spent.minor),
    );
  }, [rows]);

  const totals = useMemo(() => {
    let plannedMinor = 0n;
    let spentMinor = 0n;
    for (const row of rows) {
      plannedMinor += row.planned?.minor ?? 0n;
      spentMinor += row.spent.minor;
    }
    return { planned: money(plannedMinor, currency), spent: money(spentMinor, currency) };
  }, [rows, currency]);

  const anySpending = rows.some((row) => row.spent.minor > 0n);

  return (
    <Card
      title="Budget vs actual"
      aside={
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="segmented" role="group" aria-label="Period">
            <button type="button" aria-pressed={period === 'month'} onClick={() => { setPeriod('month'); }}>
              This month
            </button>
            <button type="button" aria-pressed={period === 'year'} onClick={() => { setPeriod('year'); }}>
              This year
            </button>
          </span>
          <span className="note">
            day {daysElapsed} of {daysInPeriod}
          </span>
        </span>
      }
    >
      {!anySpending && totals.planned.minor === 0n ? (
        <p className="note">
          Nothing to compare yet. Set some figures on the Plan tab, then file a spend against a
          category — the two meet here.
        </p>
      ) : (
        <>
          <dl className="mb-3.5 flex flex-wrap gap-x-9 gap-y-2.5">
            <div>
              <dt className="micro-label">Planned</dt>
              <dd className="num" style={{ color: 'var(--ink)' }}>
                {formatMoney(totals.planned, { privacy })}
              </dd>
            </div>
            <div>
              <dt className="micro-label">Spent</dt>
              <dd className="num" style={{ color: 'var(--ink)' }}>
                {formatMoney(totals.spent, { privacy })}
              </dd>
            </div>
            <div>
              <dt className="micro-label">
                {totals.spent.minor > totals.planned.minor ? 'Over by' : 'Left'}
              </dt>
              <dd
                className="num"
                style={{
                  color:
                    totals.spent.minor > totals.planned.minor ? 'var(--coral)' : 'var(--teal)',
                }}
              >
                {formatMoney(
                  money(
                    totals.spent.minor > totals.planned.minor
                      ? totals.spent.minor - totals.planned.minor
                      : totals.planned.minor - totals.spent.minor,
                    currency,
                  ),
                  { privacy },
                )}
              </dd>
            </div>
          </dl>

          <ul className="row-separated">
            {ordered
              .filter((row) => row.planned !== null || row.spent.minor > 0n)
              .map((row) => (
                <ComparisonRow key={row.categoryId ?? 'none'} row={row} privacy={privacy} />
              ))}
          </ul>

          <p className="note mt-3.5">
            Pace is what has been spent against how much of{' '}
            {period === 'month' ? 'the month' : 'the year'} has passed — {formatIsoDate(bounds.start)}{' '}
            to {formatIsoDate(bounds.end)}. Above 1.0 means a category is ahead of the calendar, which
            is worth knowing now rather than at the end.
            {period === 'month' &&
              ' A yearly figure is not counted here: a school fee is not a twelfth of itself each month.'}
          </p>
        </>
      )}
    </Card>
  );
}

const TONE: Record<BudgetComparison['state'], 'ok' | 'due' | 'neutral' | 'own'> = {
  over: 'due',
  'on-track': 'ok',
  under: 'neutral',
  unplanned: 'neutral',
};

const LABEL: Record<BudgetComparison['state'], string> = {
  over: 'ahead of the calendar',
  'on-track': 'on track',
  under: 'behind',
  unplanned: 'no plan',
};

function ComparisonRow({ row, privacy }: { row: BudgetComparison; privacy: boolean }) {
  const overspent = row.remaining !== null && row.remaining.minor < 0n;

  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <span className="flex flex-wrap items-center gap-2">
          <span style={{ color: 'var(--ink)' }}>{row.name}</span>
          {row.nature === 'fixed' && <Pill tone="own">compulsory</Pill>}
          <Pill tone={TONE[row.state]}>{LABEL[row.state]}</Pill>
        </span>

        <span className="num whitespace-nowrap" style={{ color: 'var(--ink)' }}>
          {formatMoney(row.spent, { privacy })}
          {row.planned !== null && (
            <span className="note"> of {formatMoney(row.planned, { privacy })}</span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {row.pace !== null && (
          <span className="num note">
            pace {row.pace.toFixed(2)}
          </span>
        )}
        {row.remaining !== null && (
          <span className="num note" style={overspent ? { color: 'var(--coral)' } : undefined}>
            {overspent ? 'over by ' : 'left '}
            {formatMoney(
              money(overspent ? -row.remaining.minor : row.remaining.minor, row.spent.currency),
              { privacy },
            )}
          </span>
        )}
        {row.categoryId === null && (
          <span className="note">file these under a category to compare them</span>
        )}
      </div>
    </li>
  );
}
