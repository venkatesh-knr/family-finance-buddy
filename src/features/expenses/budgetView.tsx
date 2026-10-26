/**
 * What was planned, against what was spent: the month's figure, and the plan that explains it.
 *
 * Two cards read one calculation. `useBudgetComparison` does the arithmetic (every figure from the pure functions
 * in `domain/budget.ts`, converted at the rate for the day it was spent), and `SpentHero` and `PlanCard` only decide
 * what to show and in what order. The screen puts quick add between them, as the artboard does, so they are two
 * components and not one card.
 */

import { useMemo, useState } from 'react';
import {
  compareToBudget,
  daysElapsedIn,
  daysInclusive,
  monthBounds,
  periodSummary,
  taxYearBounds,
  type BudgetComparison,
  type CategoryActual,
  type CategoryPlanned,
  type PersonalTotal,
} from '../../domain/budget.ts';
import { convert } from '../../domain/fx.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { EXPENSE_LISTING_LIMIT } from '../../repo/expenses.ts';
import type { FxRate } from '../../repo/rates.ts';
import type { Budget, Expense, ExpenseCategory, Member, PersonalSpendPeriods } from '../../repo/types.ts';
import { Bar, Caveat, Notice, Qualifier } from '../../ui/primitives.tsx';

export type Period = 'month' | 'year';

export interface BudgetInputs {
  categories: readonly ExpenseCategory[];
  budgets: readonly Budget[];
  expenses: readonly Expense[];
  members: readonly Member[];
  /**
   * Other members' private sums. Absent from `expenses` by policy, not by accident. Null when they could not be
   * read, which the card must say: "nobody has any" and "we could not tell" are the difference between a total
   * that is right and one that is short.
   */
  personalSpend: PersonalSpendPeriods | null;
  /**
   * Whether `expenses` is every entry of the period, and not only the most recent the list holds. When it is not,
   * the figures are short by the older entries and say so.
   */
  complete: boolean;
  today: string;
  fy: number;
  /** What these figures are read in: the household's currency, or this device's choice. */
  currency: string;
  /** The household's recorded rates. Each row converts at the rate for its own date. */
  rates: readonly FxRate[];
}

export function useBudgetComparison(inputs: BudgetInputs) {
  const { categories, budgets, expenses, members, personalSpend, complete, today, fy, currency, rates } = inputs;

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

        /**
         * A plan is stored in the currency it was set in, and read in the
         * currency this device asked for.
         *
         * Relabelling it would be worse than not converting at all: the
         * figures came out as "$26,500 planned" against spending genuinely
         * converted to dollars, so a household reading in USD saw a budget
         * eighty-eight times what it had set.
         *
         * Converted at today's rate, unlike spending: a plan is a statement
         * about now, not something that happened on a date.
         */
        const stored = monthly?.planned.currency ?? yearly?.planned.currency ?? currency;
        const raw = minor === null ? null : money(minor, stored);
        const converted = raw === null ? null : convert(raw, currency, rates, today);

        return {
          categoryId: category.id,
          name: category.name,
          nature: category.nature,
          // A plan no rate can carry into the currency being read is no plan
          // on this screen — counted below rather than shown at the wrong size.
          planned: converted !== null && converted.ok ? converted.amount : null,
        };
      });
  }, [categories, budgets, period, currency, rates, today]);

  /** Plans that could not be carried into the currency being read. */
  const plansUnconverted = useMemo(() => {
    const missing = new Set<string>();
    for (const budget of budgets) {
      if (convert(budget.planned, currency, rates, today).ok) continue;
      missing.add(budget.planned.currency);
    }
    return [...missing];
  }, [budgets, currency, rates, today]);

  /**
   * What was spent, in the currency being read, and what could not be.
   *
   * This used to add every expense's minor units together whatever currency
   * they were in, so a $49.99 domain renewal counted as ₹49.99 — a real row
   * in the demo household, and a figure wrong by a factor of the exchange
   * rate. Each row is converted at the rate for its own date now, and a row
   * with no rate for its date is left out and counted, because a total short
   * by an amount nobody can see is the failure this app exists to avoid.
   */
  const { actuals, unconverted } = useMemo(() => {
    const rows: CategoryActual[] = [];
    const missing = new Map<string, number>();

    for (const expense of expenses) {
      if (expense.isVoided) continue;
      if (expense.date < bounds.start || expense.date > bounds.end) continue;

      const converted = convert(expense.amount, currency, rates, expense.date);
      if (converted.ok) {
        rows.push({ categoryId: expense.categoryId, spent: converted.amount });
      } else {
        missing.set(expense.amount.currency, (missing.get(expense.amount.currency) ?? 0) + 1);
      }
    }

    return {
      actuals: rows,
      unconverted: [...missing.entries()].map(([code, count]) => ({ code, count })),
    };
  }, [expenses, bounds, currency, rates]);

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

  // The listing holds the most recent entries and no more. A period that reaches back past the oldest one loaded
  // is being added up from part of itself, and its total is short by what is not here.
  const partial = useMemo(() => {
    const oldest = expenses[expenses.length - 1];
    return !complete && expenses.length >= EXPENSE_LISTING_LIMIT && oldest !== undefined && oldest.date >= bounds.start;
  }, [complete, expenses, bounds]);

  const summary = useMemo(
    () => periodSummary({ planned: totals.planned, spent: totals.spent, daysElapsed, daysInPeriod }),
    [totals, daysElapsed, daysInPeriod],
  );

  return {
    period,
    setPeriod,
    bounds,
    daysInPeriod,
    daysElapsed,
    currency,
    totals,
    summary,
    anySpending,
    moving,
    untouched,
    untouchedPlanned,
    personal,
    personalSpend,
    plansUnconverted,
    unconverted,
    otherCurrencies,
    partial,
  };
}

export type BudgetComparisonView = ReturnType<typeof useBudgetComparison>;

// ─── the month: the one lifted surface ────────────────────────────────────────

/**
 * The mark on the figure when it leaves something out, with what and what to do.
 *
 * Amber only while the person can do something about it (docs/tokens.md section 2): reloading, or recording the
 * rate that is missing. A listing that holds only the most recent entries is a limit of the screen and not
 * something to act on, so it is the muted mark. It rides on the figure and not on the plan below it: "₹10,335 left"
 * under a total that is short by ten thousand rupees tells a person they have more to spend than they do.
 */
function ShortFigure({ view }: { view: BudgetComparisonView }) {
  const fixable: string[] = [];
  if (view.personalSpend === null) {
    fixable.push('Private spending could not be read just now, so this total may be short. Reload to read it again.');
  }
  if (view.unconverted.length > 0) {
    fixable.push(
      'Spending in another currency is not in this figure, because no rate covers the day it was spent. Record a rate for that date on Overview and it comes in.',
    );
  }
  if (view.otherCurrencies.length > 0) {
    fixable.push(
      'Some private spending is in another currency and is not in this figure. Adding it would need a rate, and a total is not the place to invent one.',
    );
  }
  if (view.plansUnconverted.length > 0) {
    fixable.push(
      `Some categories are planned in another currency and no rate carries them into ${view.currency}, so the plan is short. Record a rate on Overview.`,
    );
  }
  const limited = view.partial
    ? [
        `This ${view.period === 'month' ? 'month' : 'year'} holds more entries than the ${String(EXPENSE_LISTING_LIMIT)} most recent that this screen reads, so the figure is short by the older ones.`,
      ]
    : [];
  if (fixable.length === 0 && limited.length === 0) return null;
  return (
    <span className="ml-2 align-middle text-base font-normal">
      <Caveat tone={fixable.length > 0 ? 'warn' : 'info'} label="Why this figure may be short">
        {[...fixable, ...limited].map((reason) => (
          <span key={reason} className="mb-1.5 block">
            {reason}
          </span>
        ))}
      </Caveat>
    </span>
  );
}

/** What the pace says, in words, for the period on screen. Null where there is nothing to say. */
function paceWords(view: BudgetComparisonView): { text: string; tone: 'warn' | 'loss' | 'muted' } | null {
  const noun = view.period === 'month' ? "the month's pace" : "the year's pace";
  switch (view.summary.verdict) {
    case 'ahead':
      return { text: `ahead of ${noun}`, tone: 'warn' };
    case 'over-plan':
      return { text: 'over the plan', tone: 'loss' };
    case 'behind':
      return { text: `under ${noun}`, tone: 'muted' };
    case 'on-pace':
      return { text: `on ${noun}`, tone: 'muted' };
    case 'no-plan':
      return null;
  }
}

/**
 * Spent, of what was planned, and whether that is early: the figure the screen is about.
 *
 * The artboard's hero (docs/design/vibrant-canvas.html, Expenses): the amount large, "of ₹62,500 planned · day
 * 15 of 31", a bar for how much of the plan is spent with a tick for how much of the period has passed, and
 * under it what is left and a pace verdict. The pace is the point: a month-end total says what happened, a pace
 * says it while there is still something to do about it.
 */
export function SpentHero({ view, privacy }: { view: BudgetComparisonView; privacy: boolean }) {
  const { summary, totals, period, setPeriod, daysElapsed, daysInPeriod, bounds } = view;
  const words = paceWords(view);
  const planned = totals.planned.minor > 0n;
  const over = summary.left !== null && summary.left.minor < 0n;
  const spentPercent = summary.spentShare === null ? 0 : Math.min(summary.spentShare, 1) * 100;
  const elapsedPercent = summary.elapsedShare * 100;
  const noun = period === 'month' ? 'month' : 'year';

  return (
    <section className="card card-lift" aria-label={period === 'month' ? 'This month' : 'This year'}>
      <div className="flex items-center justify-between gap-3">
        <span className="label">Spent</span>
        <span className="segmented" role="group" aria-label="Period">
          <button type="button" aria-pressed={period === 'month'} onClick={() => { setPeriod('month'); }}>
            This month
          </button>
          <button type="button" aria-pressed={period === 'year'} onClick={() => { setPeriod('year'); }}>
            This year
          </button>
        </span>
      </div>

      <div className="figure figure-month mt-1.5" data-testid="period-spent">
        {formatMoney(totals.spent, { privacy })}
        <ShortFigure view={view} />
      </div>

      <p className="note mt-1">
        {planned ? (
          <>
            of {formatMoney(totals.planned, { privacy })} planned · day {daysElapsed} of {daysInPeriod}
          </>
        ) : (
          <>
            no plan set for this {noun} · day {daysElapsed} of {daysInPeriod}
          </>
        )}{' '}
        <Caveat tone="info" label="What pace is">
          Pace is what has been spent against how much of the {noun} has passed, {formatIsoDate(bounds.start)} to{' '}
          {formatIsoDate(bounds.end)}. Ahead means more of the plan is gone than of the calendar, which is worth
          knowing now and not at the end.
          {period === 'month' &&
            ' A yearly figure is not counted in a month: a school fee is not a twelfth of itself each month.'}
        </Caveat>
      </p>

      {planned && (
        <>
          <div
            className="spent-bar"
            role="img"
            aria-label={`${String(Math.round(spentPercent))} percent of the plan spent, ${String(Math.round(elapsedPercent))} percent of the ${noun} gone`}
          >
            <i style={{ width: `${String(spentPercent)}%`, background: over ? 'var(--coral)' : 'var(--teal)' }} />
            <b style={{ left: `${String(elapsedPercent)}%` }} />
          </div>

          <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-caption">
            <span style={{ color: 'var(--ink-2)' }}>
              {summary.left === null
                ? null
                : over
                  ? `${formatMoney(money(-summary.left.minor, summary.left.currency), { privacy })} over the plan`
                  : summary.daysLeft > 0
                    ? `${formatMoney(summary.left, { privacy })} left for ${String(summary.daysLeft)} ${summary.daysLeft === 1 ? 'day' : 'days'}`
                    : `${formatMoney(summary.left, { privacy })} left`}
            </span>
            {words !== null && (
              <span
                style={{
                  color: words.tone === 'warn' ? 'var(--brass)' : words.tone === 'loss' ? 'var(--coral)' : 'var(--ink-2)',
                  fontWeight: words.tone === 'muted' ? 400 : 600,
                }}
              >
                {words.text}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ─── the plan, over-spent first ───────────────────────────────────────────────

function PlanRow({ row, privacy }: { row: BudgetComparison; privacy: boolean }) {
  const over = row.remaining !== null && row.remaining.minor < 0n;
  return (
    <li className="plan-row">
      <div className="plan-line">
        <span className="plan-name">{row.name}</span>
        <span className="tabular-nums">
          {over && row.remaining !== null ? (
            <>
              <span style={{ color: 'var(--coral)', fontWeight: 600 }}>
                {formatMoney(money(-row.remaining.minor, row.spent.currency), { privacy })} over
              </span>{' '}
              <span className="note">· {formatMoney(row.planned ?? row.spent, { privacy })}</span>
            </>
          ) : (
            <>
              {formatMoney(row.spent, { privacy })}{' '}
              {row.planned !== null ? (
                <Qualifier word="of">{formatMoney(row.planned, { privacy })}</Qualifier>
              ) : (
                <span className="note">no plan</span>
              )}
            </>
          )}
        </span>
      </div>
      {row.planned !== null && row.planned.minor > 0n && (
        <div className="plan-bar">
          <Bar
            value={Number(row.spent.minor)}
            target={Number(row.planned.minor)}
            label={`${row.name}: spent against plan`}
          />
        </div>
      )}
    </li>
  );
}

/**
 * The plan beside what has been spent: a row for each category with spending, the ones over first, then what is
 * not filed under a category, with a way to go and file it, and a fold for the categories nothing has been spent in.
 */
export function PlanCard({
  view,
  privacy,
  onFile,
}: {
  view: BudgetComparisonView;
  privacy: boolean;
  /** Show only the entries with no category in this period, in the ledger below: the way to file them. */
  onFile: (period: { start: string; end: string }) => void;
}) {
  const {
    period,
    totals,
    anySpending,
    moving,
    untouched,
    untouchedPlanned,
    personalSpend,
    plansUnconverted,
    unconverted,
    otherCurrencies,
    currency,
  } = view;

  const categoryRows = moving.filter((row) => row.kind === 'category');
  const uncategorised = moving.find((row) => row.kind === 'uncategorised');
  const personalRows = moving.filter((row) => row.kind === 'personal');
  const overCount = categoryRows.filter((row) => row.remaining !== null && row.remaining.minor < 0n).length;

  if (!anySpending && totals.planned.minor === 0n) {
    return (
      <section className="card" aria-label="Plan">
        <h2 className="card-title font-sans mb-3.5">Plan</h2>
        <p className="note">
          Nothing to compare yet. Set some figures in the spending plan on FIRE, then file a spend against a
          category: the two meet here.
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-label="Plan">
      <header className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="card-title font-sans">Plan</h2>
        {overCount > 0 ? (
          <span className="note">{overCount} over</span>
        ) : (
          <Caveat tone="info" label="Where the planned figures come from">
            The planned figures come from the spending plan on <strong>FIRE</strong>, where they are also what the
            retirement target is a multiple of. Change one there and both this comparison and that target move.
          </Caveat>
        )}
      </header>

      <ul className="plan-rows">
        {categoryRows.map((row) => (
          <PlanRow key={row.categoryId ?? row.name} row={row} privacy={privacy} />
        ))}
      </ul>

      {categoryRows.length === 0 && (
        <p className="note">Nothing spent against a category yet this {period === 'month' ? 'month' : 'year'}.</p>
      )}

      {uncategorised !== undefined && (
        <div className="plan-uncategorised">
          <span className="min-w-0 flex-1">
            <span className="plan-line">
              <span className="plan-name">Uncategorised</span>
              <span className="tabular-nums">{formatMoney(uncategorised.spent, { privacy })}</span>
            </span>
            <span className="note mt-0.5 flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 11v5" />
                <path d="M12 8h.01" />
              </svg>
              no plan to compare against
            </span>
          </span>
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              onFile(view.bounds);
            }}
          >
            File them
          </button>
        </div>
      )}

      {personalRows.map((row) => (
        <div key={row.memberId ?? row.name} className="plan-uncategorised">
          <span className="min-w-0 flex-1">
            <span className="plan-line">
              <span className="plan-name">{row.name}</span>
              <span className="tabular-nums">{formatMoney(row.spent, { privacy })}</span>
            </span>
            <span className="note mt-0.5 block">their detail, your total</span>
          </span>
        </div>
      ))}

      {untouched.length > 0 && (
        <details className="plan-fold">
          <summary>
            <span className="tabular-nums">
              {untouched.length} with nothing spent yet
              {untouchedPlanned.minor > 0n && <> · {formatMoney(untouchedPlanned, { privacy })} planned</>}
            </span>
          </summary>
          <ul className="plan-rows">
            {untouched.map((row) => (
              <PlanRow key={row.categoryId ?? row.name} row={row} privacy={privacy} />
            ))}
          </ul>
        </details>
      )}

      {personalSpend === null && (
        <div className="mt-2.5">
          <Notice tone="due">
            Private spending could not be read just now, so this total may be short. It is not that nobody has
            any: that would show as a line of its own.
          </Notice>
        </div>
      )}

      {plansUnconverted.length > 0 && (
        <div className="mt-2.5">
          <Notice tone="due" names={plansUnconverted} namesLabel="Which currencies">
            Some categories are planned in another currency and no rate carries them into {currency}, so they are
            shown as having no plan rather than as a figure at the wrong size.
          </Notice>
        </div>
      )}

      {unconverted.length > 0 && (
        <div className="mt-2.5">
          <Notice
            tone="due"
            names={unconverted.map(
              (entry) => `${String(entry.count)} ${entry.count === 1 ? 'entry' : 'entries'} in ${entry.code}`,
            )}
            namesLabel="Which spending"
          >
            Spending in another currency is not in these figures, because no rate covers the day it was spent. A
            rate for that date, recorded on Overview, brings it in; converting it at today&rsquo;s rate instead
            would restate what a past month cost.
          </Notice>
        </div>
      )}

      {otherCurrencies.length > 0 && (
        <div className="mt-2.5">
          <Notice names={otherCurrencies} namesLabel="Which currencies">
            Some private spending is in another currency and is not in this total, which is therefore low. Adding
            it would need a rate, and a total is not the place to invent one.
          </Notice>
        </div>
      )}
    </section>
  );
}
