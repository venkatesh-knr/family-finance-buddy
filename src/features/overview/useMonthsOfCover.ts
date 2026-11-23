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
 * Each month is read from its best source (the owner, 23 November 2026; spending-capture.md 11.4; card-cycles.md 8.4): the balances at a close, then a stated spend, then what was itemised, each currency on its own, and the caveat
 * on the card counts the months by source. A month closed from balances is read as the close reads it, so a household that closes every month at month end gets the very figure the close shows as spent, and a card closed on its
 * statement date is read on that window. Only an owner or a partner reads the close: it needs every account and what other members keep private, and a contributor's months are stated or itemised as they were. Thirteen months are read and twelve are averaged: the oldest is a probe that says whether recording
 * began inside the window (see `coverMonths`).
 */

import { useEffect, useMemo, useState } from 'react';
import type { Rate } from '../../domain/fx.ts';
import { COVER_WINDOW_MONTHS, coverMonths, monthsOfCover, priorMonths } from '../../domain/earmark.ts';
import { monthBounds } from '../../domain/budget.ts';
import { countBySource, coverSources, statementsForCover, type SpendSource } from '../../domain/spend-source.ts';
import type { Money } from '../../lib/money.ts';
import { closedSpend, coverMonthlyExpenses } from './coverFigures.ts';
import { listAccounts, listBalances } from '../../repo/accounts.ts';
import { listClosesWithoutCard } from '../../repo/closeWithoutCard.ts';
import { listCredits } from '../../repo/credits.ts';
import { listOwnPrivateSpend, listPersonalSpend } from '../../repo/expenses.ts';
import { listFixedIncomeEntries, listHoldingEntriesBetween } from '../../repo/holdingEntries.ts';
import { listLoanPayments } from '../../repo/loanPayments.ts';
import { householdPrivateClose } from '../../repo/moneyTotals.ts';
import { listSpendStatements } from '../../repo/spendStatements.ts';
import { householdSpending } from '../../repo/summary.ts';
import { listTransfers } from '../../repo/transfers.ts';
import type { SpendStatement } from '../../repo/types.ts';
import { isClosed, lastDayOf } from '../money/closeMonth.ts';
import { fixedIncomeMovesOf, holdingMovesOf } from '../money/holdingMoves.ts';

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
      /** How many of the months the average is over are from balances, how many stated and how many itemised (docs/design/spending-capture.md section 11.4). */
      readonly sources: Readonly<Record<SpendSource, number>>;
    };

export function useMonthsOfCover(options: {
  householdId: string | null;
  today: string;
  /** The currency the emergency total and the average are both read in. */
  display: string;
  rates: readonly Rate[];
  /** What is earmarked emergency, in `display`, or null where it could not be added into one figure. */
  emergency: Money | null;
  /** The caller's role in the household: only an owner or a partner reads the close, and so the months closed from balances. */
  role: string | null;
}): Cover {
  const { householdId, today, display, rates, emergency, role } = options;
  const readsClose = role === 'owner' || role === 'partner';
  const [raw, setRaw] = useState<
    | {
        readonly byMonth: ReadonlyMap<string, readonly Money[]>;
        readonly stated: readonly SpendStatement[];
        /** What the close says was spent in each month closed from balances, in each currency: the same figure the close shows. */
        readonly closed: ReadonlyMap<string, readonly Money[]>;
      }
    | 'failed'
    | null
  >(null);

  useEffect(() => {
    // Until the role is known the reads wait, so they are made once and for what the role may read.
    if (householdId === null || role === null) return;
    let live = true;
    setRaw(null);
    const months = priorMonths(today, COVER_WINDOW_MONTHS + 1);
    // The balance on the last day of the month before the probe opens it, so the probe can be closed from them as every other month is.
    const opens = priorMonths(today, COVER_WINDOW_MONTHS + 2)[0];
    const first = months[0];
    const last = months[months.length - 1];
    if (first === undefined || last === undefined || opens === undefined) return;

    Promise.all([
      listSpendStatements(householdId, months),
      Promise.all([listAccounts(householdId, { includeArchived: true }), listBalances(householdId, { from: lastDayOf(opens), to: today })]),
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
      readsClose ? listClosesWithoutCard(householdId) : Promise.resolve([]),
    ])
      .then(async ([statements, [accounts, balances], entries, own, closesWithout]) => {
        const byMonth = new Map<string, Money[]>(entries.map(([month, amounts]) => [month, [...amounts]]));
        for (const entry of own) byMonth.get(entry.date.slice(0, 7))?.push(entry.amount);
        // Balances beat a stated spend (SC-I17): a statement for a month closed from balances is not used.
        const closedWithout = closesWithout.map((choice) => ({ accountId: choice.accountId, month: choice.month }));
        const closedMonths = months.filter((month) => isClosed({ month, accounts, balances, closedWithout }));

        // The close's own figure for each month closed from balances, worked out as the close works it out: the same reads and the same function, so the two cannot say different things.
        const closed = new Map<string, readonly Money[]>();
        if (readsClose && closedMonths.length > 0) {
          const [credits, transfers, loanPayments] = await Promise.all([
            listCredits(householdId, { from: `${first}-01`, to: lastDayOf(last) }),
            listTransfers(householdId, { from: `${first}-01`, to: lastDayOf(last) }),
            listLoanPayments(householdId, { from: `${first}-01`, to: lastDayOf(last) }),
          ]);
          const perMonth = await Promise.all(
            closedMonths.map(async (month) => {
              const from = `${month}-01`;
              const to = lastDayOf(month);
              const [heldEntries, fixed, unreadable] = await Promise.all([
                listHoldingEntriesBetween(householdId, from, to),
                listFixedIncomeEntries(householdId, from, to),
                householdPrivateClose(householdId, month, to),
              ]);
              const held = holdingMovesOf(heldEntries);
              const fixedMoves = fixedIncomeMovesOf({ ...fixed, from, to, today });
              const amounts = closedSpend({
                month,
                today,
                accounts,
                balances,
                credits,
                transfers,
                holdingMoves: [...held.moves, ...fixedMoves.moves],
                loanPayments,
                closedWithout,
                ...(unreadable.length === 0 ? {} : { unreadable }),
                typed: {},
              });
              return [month, amounts] as const;
            }),
          );
          for (const [month, amounts] of perMonth) {
            if (amounts !== null) closed.set(month, amounts);
          }
        }
        if (live) setRaw({ byMonth, stated: statementsForCover(statements, new Set(closedMonths)), closed });
      })
      .catch(() => {
        if (live) setRaw('failed');
      });
    return () => {
      live = false;
    };
  }, [householdId, today, role, readsClose]);

  return useMemo<Cover>(() => {
    if (raw === null) return { status: 'loading' };
    if (raw === 'failed') return { status: 'failed' };

    const statedMonths = new Set(raw.stated.map((statement) => statement.month));
    const closedMonths = new Set(raw.closed.keys());
    // A month closed from balances has spending where the close says it does, and not only where something was itemised.
    const spendMonths = [...raw.byMonth.entries()]
      .filter(([month, amounts]) => (raw.closed.get(month) ?? []).some((amount) => amount.minor !== 0n) || statedMonths.has(month) || amounts.some((amount) => amount.minor !== 0n))
      .map(([month]) => month);
    // A statement is a whole month's total, and so is a month closed from balances: neither is the first entry of a month, so neither is dropped as the month recording began in.
    const window = coverMonths({ today, spendMonths, stated: [...statedMonths, ...closedMonths] });
    const sources = countBySource(coverSources(window, statedMonths, closedMonths));

    // Each currency is read from its best source on its own: the close's spent, else a statement, else what was itemised, in that currency and in no other.
    const worked = coverMonthlyExpenses({
      window,
      display,
      rates,
      closed: raw.closed,
      stated: raw.stated.map((statement) => ({ month: statement.month, amount: statement.amount })),
      itemised: raw.byMonth,
    });
    if (!worked.ok) {
      return {
        status: 'ready',
        months: null,
        history: window.length,
        sources,
        why: `A rate to convert ${worked.missing} spending into ${display} is missing, so the monthly average cannot be added up.`,
      };
    }
    const monthlyExpenses = worked.monthlyExpenses;

    if (emergency === null) {
      return {
        status: 'ready',
        months: null,
        history: window.length,
        sources,
        why: 'The emergency fund could not be added into one figure, so there is nothing to divide.',
      };
    }

    const months = monthsOfCover({ emergency, monthlyExpenses });
    if (months !== null) return { status: 'ready', months, history: window.length, sources, why: null };

    return {
      status: 'ready',
      months: null,
      history: window.length,
      sources,
      why:
        window.length < 3
          ? `It needs three whole months with spending recorded in them; there ${window.length === 1 ? 'is' : 'are'} ${String(window.length)} so far. The month spending began in and months with nothing recorded do not count.`
          : 'The average monthly spending is nothing, so there is nothing to divide by.',
    };
  }, [raw, today, display, rates, emergency]);
}
