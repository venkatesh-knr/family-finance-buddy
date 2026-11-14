/**
 * The household's came in and refunds for a span of days, per currency, including other members' private credits without their rows.
 *
 * Only an owner or a partner with a second factor may ask; anyone else, or a failed read, is `failed`, and never an empty answer: a total
 * that is short because the read failed must not look like a month with nothing in it (ledger-income.md section 7).
 */

import { useEffect, useRef, useState } from 'react';
import { householdMoneyTotals } from '../../repo/moneyTotals.ts';
import type { MoneyTotals } from '../../repo/types.ts';

export type MonthTotals =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly totals: readonly MoneyTotals[] };

/** `refreshKey` changes when a credit was written or changed, and the totals are read again. */
export function useMonthTotals(householdId: string | null, from: string, to: string, refreshKey: unknown): MonthTotals {
  const [state, setState] = useState<MonthTotals>({ status: 'loading' });
  const asked = useRef(0);

  useEffect(() => {
    if (householdId === null) return;
    const turn = ++asked.current;
    householdMoneyTotals(householdId, from, to)
      .then((totals) => {
        if (turn === asked.current) setState({ status: 'ready', totals });
      })
      .catch(() => {
        if (turn === asked.current) setState({ status: 'failed' });
      });
  }, [householdId, from, to, refreshKey]);

  return state;
}
