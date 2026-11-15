/**
 * The month's holding entries that name an account, for the close and for Last month (ledger-income.md sections 4a and 4b; LI-I30, LI-I35): purchases,
 * sales and PPF entries, and a deposit's or bond's principal and payout and the cost of a holding opened with one. Until they have been read, or
 * when they could not be, `blocked` is true and the close shows no figure: read as none, money into a holding would sit in spent and saved would read low.
 * A household with no account has none to name, and is not made to wait.
 */

import { useEffect, useState } from 'react';
import type { IsoDate } from '../../lib/dates.ts';
import type { MonthHoldingMove } from '../../domain/money-month.ts';
import { listFixedIncomeEntries, listHoldingEntriesBetween } from '../../repo/holdingEntries.ts';
import { lastDayOf } from './closeMonth.ts';
import { fixedIncomeMovesOf, holdingMovesOf } from './holdingMoves.ts';

export function useHoldingMoves(
  householdId: string | null,
  month: string,
  asks: boolean,
  today: IsoDate,
): { readonly moves: readonly MonthHoldingMove[]; readonly unnamed: number; readonly failed: boolean; readonly blocked: boolean } {
  const [state, setState] = useState<{ key: string; moves: readonly MonthHoldingMove[]; unnamed: number } | { key: string; failed: true } | null>(null);
  const key = householdId === null || !asks ? null : `${householdId}|${month}`;
  useEffect(() => {
    if (key === null || householdId === null) return undefined;
    let live = true;
    const from = `${month}-01`;
    const to = lastDayOf(month);
    Promise.all([listHoldingEntriesBetween(householdId, from, to), listFixedIncomeEntries(householdId, from, to)])
      .then(([entries, fixed]) => {
        const first = holdingMovesOf(entries);
        const second = fixedIncomeMovesOf({ ...fixed, from, to, today });
        if (live) setState({ key, moves: [...first.moves, ...second.moves], unnamed: first.unnamed + second.unnamed });
      })
      .catch(() => {
        if (live) setState({ key, failed: true });
      });
    return () => {
      live = false;
    };
  }, [key, householdId, month, today]);
  if (key === null) return { moves: [], unnamed: 0, failed: false, blocked: false };
  if (state === null || state.key !== key) return { moves: [], unnamed: 0, failed: false, blocked: true };
  if ('failed' in state) return { moves: [], unnamed: 0, failed: true, blocked: true };
  return { moves: state.moves, unnamed: state.unnamed, failed: false, blocked: false };
}
