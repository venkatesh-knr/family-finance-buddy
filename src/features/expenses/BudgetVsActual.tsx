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
  type PersonalTotal,
} from '../../domain/budget.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import type {
  Budget,
  Expense,
  ExpenseCategory,
  Member,
  PersonalSpendPeriods,
} from '../../repo/types.ts';
import { Bar, Card, Notice, Pill, Stat } from '../../ui/primitives.tsx';

type Period = 'month' | 'year';

export function BudgetVsActual({
  categories,
  budgets,
  expenses,
  members,
  personalSpend,
  today,
  fy,
  currency,
  privacy,
}: {
  categories: readonly ExpenseCategory[];
  budgets: readonly Budget[];
  expenses: readonly Expense[];
  members: readonly Member[];
  /**
   * Other members' private sums. Absent from `expenses` by policy, not by
   * accident. Null when they could not be read — which the card must say,
   * because the difference between "nobody has any" and "we could not tell"
   * is the difference between a total that is right and one that is short.
   */
  personalSpend: PersonalSpendPeriods | null;
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

  /**
   * The private sums, given the member names this screen already has.
   *
   * The database returns an id and a figure; a name is not its business, and
   * joining it there would have made the function return more than a total.
   */
  // The sums for the period actually on screen. Reading the year's figures
  // into a month's comparison would put twelve months of private spending
  // against one month of plan.
  const spendForPeriod = useMemo(
    () => (personalSpend === null ? null : period === 'month' ? personalSpend.month : personalSpend.year),
    [personalSpend, period],
  );

  const personal = useMemo<readonly PersonalTotal[]>(() => {
    if (spendForPeriod === null) return [];
    const nameOf = new Map(members.map((member) => [member.id, member.displayName]));
    return spendForPeriod
      .filter((entry) => entry.total.currency === currency)
      .map((entry) => ({
        memberId: entry.memberId,
        // A member who has left the household still has spending in its
        // history — archived, never deleted — and an unnamed line is worse
        // than a plainly former one.
        memberName: nameOf.get(entry.memberId) ?? 'A former member',
        total: entry.total,
      }));
  }, [spendForPeriod, members, currency]);

  // Private spending in another currency cannot be added to this total, and
  // must not be silently dropped either: the figure would be too low with
  // nothing on screen saying so. Converting it here would invent a rate at the
  // display edge, which is the one thing this app never does with money.
  const otherCurrencies = useMemo(
    () => [
      ...new Set(
        (spendForPeriod ?? []).filter((e) => e.total.currency !== currency).map((e) => e.total.currency),
      ),
    ],
    [spendForPeriod, currency],
  );

  const rows = useMemo(
    () => compareToBudget({ planned, actuals, personal, daysElapsed, daysInPeriod }),
    [planned, actuals, personal, daysElapsed, daysInPeriod],
  );

  // Whatever is over comes first, then the rest by what has been spent. A list
  // in category order buries the one row worth acting on.
  const ordered = useMemo(() => {
    // Private lines sort last on purpose. Nothing can be done about them —
    // there is no plan to compare and no detail to look into — so they belong
    // below every row somebody could actually act on.
    const rank: Record<BudgetComparison['state'], number> = {
      over: 0,
      'on-track': 1,
      under: 2,
      unplanned: 3,
      private: 4,
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

  /**
   * Rows worth reading first, and rows worth keeping.
   *
   * A category with nothing spent against it says the same thing as every
   * other one in that state, and there are usually far more of them than of
   * the rows somebody can act on. Splitting them is not hiding them — both
   * halves are in the totals above, and the fold says how many and how much
   * they were planned at.
   */
  const shown = useMemo(
    () => ordered.filter((row) => row.planned !== null || row.spent.minor > 0n),
    [ordered],
  );
  const moving = useMemo(() => shown.filter((row) => row.spent.minor > 0n), [shown]);
  const untouched = useMemo(() => shown.filter((row) => row.spent.minor === 0n), [shown]);
  const untouchedPlanned = useMemo(
    () => money(untouched.reduce((sum, row) => sum + (row.planned?.minor ?? 0n), 0n), currency),
    [untouched, currency],
  );

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
            <Stat label="Planned">{formatMoney(totals.planned, { privacy })}</Stat>
            <Stat label="Spent">{formatMoney(totals.spent, { privacy })}</Stat>
            <Stat
              label={totals.spent.minor > totals.planned.minor ? 'Over by' : 'Left'}
              tone={totals.spent.minor > totals.planned.minor ? 'loss' : 'gain'}
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
            </Stat>
          </dl>

          <ul className="row-separated">
            {moving.map((row) => (
              <ComparisonRow key={row.categoryId ?? 'none'} row={row} privacy={privacy} />
            ))}
          </ul>

          {moving.length === 0 && (
            <p className="note">Nothing spent against a category yet this {period === 'month' ? 'month' : 'year'}.</p>
          )}

          {/*
            The untouched categories, folded.
            
            A household with thirty-three categories and spending in five was
            showing twenty-eight identical rows reading zero, pace 0.00,
            behind — which buried the five rows that meant something under a
            wall of rows that did not. They are still here, and still counted
            in the totals above; they are just not the first thing the screen
            says. "Behind" on a category nobody has spent in yet is not news.
          */}
          {untouched.length > 0 && (
            <details className="mt-2.5">
              <summary className="notice-toggle">
                {untouched.length} {untouched.length === 1 ? 'category has' : 'categories have'} nothing
                spent yet
                {untouchedPlanned.minor > 0n && (
                  <> · {formatMoney(untouchedPlanned, { privacy })} planned</>
                )}
              </summary>
              <ul className="row-separated">
                {untouched.map((row) => (
                  <ComparisonRow key={row.categoryId ?? 'none'} row={row} privacy={privacy} />
                ))}
              </ul>
            </details>
          )}

          {/*
            Where the other half of every row on this card comes from. The
            planned figures are set on FIRE, because they are also what the
            FIRE target is a multiple of — but somebody looking at an
            overspend here should not have to work out where to go and change
            it.
          */}
          <p className="note mt-3.5">
            The planned figures come from the spending plan on <strong>FIRE</strong>, where they
            are also what the retirement target is a multiple of. Change one there and both this
            comparison and that target move.
          </p>

          <p className="note mt-2">
            Pace is what has been spent against how much of{' '}
            {period === 'month' ? 'the month' : 'the year'} has passed — {formatIsoDate(bounds.start)}{' '}
            to {formatIsoDate(bounds.end)}. Above 1.0 means a category is ahead of the calendar, which
            is worth knowing now rather than at the end.
            {period === 'month' &&
              ' A yearly figure is not counted here: a school fee is not a twelfth of itself each month.'}
          </p>

          {personal.length > 0 && (
            <p className="note mt-2">
              A <strong>private</strong> line is one member's own spending, counted in the total and
              shown as a single figure. The detail is theirs; the total is the household's.
            </p>
          )}

          {personalSpend === null && (
            <div className="mt-2.5">
              <Notice tone="due">
                Private spending could not be read just now, so this total may be short. It is not
                that nobody has any — that would show as a line of its own.
              </Notice>
            </div>
          )}

          {otherCurrencies.length > 0 && (
            <div className="mt-2.5">
              <Notice names={otherCurrencies} namesLabel="Which currencies">
                Some private spending is in another currency and is not in this total, which is
                therefore low. Adding it would need a rate, and a total is not the place to invent
                one.
              </Notice>
            </div>
          )}
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
  // `own` is the attribution colour, which is what this line is: a figure
  // belonging to somebody. It is not a warning and must not look like one.
  private: 'own',
};

const LABEL: Record<BudgetComparison['state'], string> = {
  over: 'ahead of the calendar',
  'on-track': 'on track',
  under: 'behind',
  unplanned: 'no plan',
  // Not "no plan". This is counted, deliberate, and nothing for anyone else to
  // go and fix; a label implying an oversight would invite exactly the asking
  // that the feature exists to make unnecessary.
  private: 'private',
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

      {/*
        docs/tokens.md §182: a bar against its target, flipping to coral past
        it. Spent against planned is the one relationship on this row that a
        number states and a shape shows — you can see an overspend before you
        have read anything.
      */}
      {row.planned !== null && row.planned.minor > 0n && (
        <Bar
          value={Number(row.spent.minor)}
          target={Number(row.planned.minor)}
          label={`${row.name}: spent against plan`}
        />
      )}

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
        {/*
          Keyed on kind, not on a null category. A personal line has no
          category either, and telling somebody to go and file another
          member's private spending is advice that is both wrong and
          impossible to act on — the rows are not theirs to see, let alone
          categorise.
        */}
        {row.kind === 'uncategorised' && (
          <span className="note">file these under a category to compare them</span>
        )}
        {row.kind === 'personal' && (
          <span className="note">their detail, your total</span>
        )}
      </div>
    </li>
  );
}
