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

type Keyed = MonthTotals & { readonly span: string };

/** `refreshKey` changes when a credit was written or changed, and the totals are read again. */
export function useMonthTotals(householdId: string | null, from: string, to: string, refreshKey: unknown): MonthTotals {
  const [state, setState] = useState<Keyed>({ status: 'loading', span: '' });
  const asked = useRef(0);
  const span = `${from}|${to}`;

  useEffect(() => {
    if (householdId === null) return;
    const turn = ++asked.current;
    householdMoneyTotals(householdId, from, to)
      .then((totals) => {
        if (turn === asked.current) setState({ status: 'ready', totals, span });
      })
      .catch(() => {
        if (turn === asked.current) setState({ status: 'failed', span });
      });
  }, [householdId, from, to, refreshKey, span]);

  // Totals read for another span are not this span's: until this one arrives it is still being read, and never the other month's figures.
  return state.span === span ? state : { status: 'loading' };
}
