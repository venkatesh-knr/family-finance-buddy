/**
 * How many months the emergency fund would last at the household's usual spending
 * (docs/design/protection-and-flow.md §3).
 *
 * The denominator is read here and the arithmetic is `monthsOfCover`, in the domain. It is the
 * household's shared spending, month by month, for the last twelve complete months: `household_expense_totals`
 * is the same read the Summary screen makes, so it counts what the Summary counts and leaves out what the
 * Summary leaves out, which is a member's private spending. That makes the cover high by whatever the
 * household spends privately, and the screen says so beside the figure. Each month's spending is converted
 * at the rate for that month's last day, so a month does not change because the rupee moved today.
 */

import { useEffect, useMemo, useState } from 'react';
import { convert, type Rate } from '../../domain/fx.ts';
import { coverMonths, monthsOfCover, COVER_WINDOW_MONTHS } from '../../domain/earmark.ts';
import { monthBounds } from '../../domain/budget.ts';
import type { SpendingRow } from '../../domain/summary.ts';
import { money, type Money } from '../../lib/money.ts';
import { householdSpending } from '../../repo/summary.ts';

export type Cover =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'ready';
      /** Null where it cannot be said honestly: too little history, a zero average, a missing rate. */
      readonly months: number | null;
      /** Complete months of spending there are to average over. */
      readonly history: number;
      /** Why it is null, when it is, in words for the screen. */
      readonly why: string | null;
    };

/** The twelve complete months before the one in progress, as first-of-month dates, oldest first. */
function priorMonths(today: string): readonly string[] {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < COVER_WINDOW_MONTHS; i += 1) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    out.push(`${String(year)}-${String(month).padStart(2, '0')}-01`);
  }
  return out.reverse();
}

export function useMonthsOfCover(options: {
  householdId: string | null;
  today: string;
  /** The currency the emergency total and the average are both read in. */
  display: string;
  rates: readonly Rate[];
  /** What is earmarked emergency, in `display`, or null where it could not be added into one figure. */
  emergency: Money | null;
}): Cover {
  const { householdId, today, display, rates, emergency } = options;
  const [raw, setRaw] = useState<ReadonlyMap<string, readonly SpendingRow[]> | 'failed' | null>(null);

  useEffect(() => {
    if (householdId === null) return;
    let live = true;
    setRaw(null);
    const months = priorMonths(today);
    Promise.all(
      months.map(async (first) => {
        const { start, end } = monthBounds(first);
        return [first.slice(0, 7), await householdSpending({ householdId, from: start, to: end })] as const;
      }),
    )
      .then((entries) => {
        if (live) setRaw(new Map(entries));
      })
      .catch(() => {
        if (live) setRaw('failed');
      });
    return () => {
      live = false;
    };
  }, [householdId, today]);

  return useMemo<Cover>(() => {
    if (raw === null) return { status: 'loading' };
    if (raw === 'failed') return { status: 'failed' };

    const firstSpendMonth =
      [...raw.entries()]
        .filter(([, rows]) => rows.some((row) => row.total.minor !== 0n))
        .map(([month]) => month)
        .sort()[0] ?? null;
    const window = coverMonths({ today, firstSpendMonth });

    const monthlyExpenses: { month: string; spent: Money }[] = [];
    for (const month of window) {
      const rows = raw.get(month) ?? [];
      const { end } = monthBounds(`${month}-01`);
      let total = 0n;
      for (const row of rows) {
        const converted = convert(row.total, display, rates, end);
        if (!converted.ok) {
          return {
            status: 'ready',
            months: null,
            history: window.length,
            why: `A rate to convert ${converted.missing.base} spending into ${display} is missing, so the monthly average cannot be added up.`,
          };
        }
        total += converted.amount.minor;
      }
      monthlyExpenses.push({ month, spent: money(total, display) });
    }

    if (emergency === null) {
      return {
        status: 'ready',
        months: null,
        history: window.length,
        why: 'The emergency fund could not be added into one figure, so there is nothing to divide.',
      };
    }

    const months = monthsOfCover({ emergency, monthlyExpenses });
    if (months !== null) return { status: 'ready', months, history: window.length, why: null };

    return {
      status: 'ready',
      months: null,
      history: window.length,
      why:
        window.length < 3
          ? 'It needs three complete months of spending history.'
          : 'The average monthly spending is nothing, so there is nothing to divide by.',
    };
  }, [raw, today, display, rates, emergency]);
}
