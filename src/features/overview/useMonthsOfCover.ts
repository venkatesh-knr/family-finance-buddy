/**
 * How many months the emergency fund would last at the household's usual spending
 * (docs/design/protection-and-flow.md §3).
 *
 * The denominator is read here and the arithmetic is `monthsOfCover`, in the domain. A household's
 * spending in a month is three reads added together, because no one of them is all of it: the shared
 * entries (`household_expense_totals`, the Summary's read), other members' private spending as one sum
 * each (`personal_expense_totals`) and the caller's own private entries. Blueprint §20: household totals
 * include private amounts, or the numbers disagree between members. Each is converted at the rate for
 * that month's last day, so a month does not change because the rupee moved today.
 *
 * Thirteen months are read and twelve are averaged: the oldest is a probe that says whether recording
 * began inside the window (see `coverMonths`).
 */

import { useEffect, useMemo, useState } from 'react';
import { convert, type Rate } from '../../domain/fx.ts';
import { COVER_WINDOW_MONTHS, coverMonths, monthsOfCover, priorMonths } from '../../domain/earmark.ts';
import { monthBounds } from '../../domain/budget.ts';
import { money, type Money } from '../../lib/money.ts';
import { listOwnPrivateSpend, listPersonalSpend } from '../../repo/expenses.ts';
import { householdSpending } from '../../repo/summary.ts';

export type Cover =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'ready';
      /** Null where it cannot be said honestly: too little history, a zero average, a missing rate. */
      readonly months: number | null;
      /** Whole months with spending in them that the average is over. */
      readonly history: number;
      /** Why it is null, when it is, in words for the screen. */
      readonly why: string | null;
    };

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
  const [raw, setRaw] = useState<ReadonlyMap<string, readonly Money[]> | 'failed' | null>(null);

  useEffect(() => {
    if (householdId === null) return;
    let live = true;
    setRaw(null);
    const months = priorMonths(today, COVER_WINDOW_MONTHS + 1);
    const first = months[0];
    const last = months[months.length - 1];
    if (first === undefined || last === undefined) return;

    Promise.all([
      Promise.all(
        months.map(async (month) => {
          const { start, end } = monthBounds(`${month}-01`);
          const [shared, others] = await Promise.all([
            householdSpending({ householdId, from: start, to: end }),
            listPersonalSpend({ householdId, from: start, to: end }),
          ]);
          return [month, [...shared.map((row) => row.total), ...others.map((row) => row.total)]] as const;
        }),
      ),
      listOwnPrivateSpend({
        householdId,
        from: monthBounds(`${first}-01`).start,
        to: monthBounds(`${last}-01`).end,
      }),
    ])
      .then(([entries, own]) => {
        if (!live) return;
        const byMonth = new Map<string, Money[]>(entries.map(([month, amounts]) => [month, [...amounts]]));
        for (const entry of own) byMonth.get(entry.date.slice(0, 7))?.push(entry.amount);
        setRaw(byMonth);
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

    const spendMonths = [...raw.entries()]
      .filter(([, amounts]) => amounts.some((amount) => amount.minor !== 0n))
      .map(([month]) => month);
    const window = coverMonths({ today, spendMonths });

    const monthlyExpenses: { month: string; spent: Money }[] = [];
    for (const month of window) {
      const { end } = monthBounds(`${month}-01`);
      let total = 0n;
      for (const amount of raw.get(month) ?? []) {
        const converted = convert(amount, display, rates, end);
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
          ? `It needs three whole months with spending recorded in them; there ${window.length === 1 ? 'is' : 'are'} ${String(window.length)} so far. The month spending began in and months with nothing recorded do not count.`
          : 'The average monthly spending is nothing, so there is nothing to divide by.',
    };
  }, [raw, today, display, rates, emergency]);
}
