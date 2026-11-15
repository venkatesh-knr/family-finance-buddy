/**
 * What was spent in a month that is not closed, read for that month itself (docs/design/ledger-income.md section 4: *open month: spent so far = what was
 * itemised in the month, less the refunds*): the household's itemised spending in the month's own range, wherever the screen's year reaches, and
 * other members' private spending for it as a sum. A failed read is `failed` and never a month of nothing.
 */

import { useEffect, useState } from 'react';
import type { Money } from '../../lib/money.ts';
import { listExpensesBetween, listPersonalSpend } from '../../repo/expenses.ts';
import type { Member } from '../../repo/types.ts';
import { lastDayOf } from './closeMonth.ts';

export type LastMonthSpend =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly itemised: readonly Money[]; readonly privateSpend: readonly Money[] };

/** `month` is null when there is nothing to read: the hook then does nothing. */
export function useLastMonthSpend(householdId: string | null, month: string | null, members: readonly Member[]): LastMonthSpend {
  const [state, setState] = useState<LastMonthSpend & { readonly key?: string }>({ status: 'idle' });
  const key = householdId === null || month === null ? null : `${householdId}|${month}`;

  useEffect(() => {
    if (key === null || householdId === null || month === null) return undefined;
    let live = true;
    const range = { householdId, from: `${month}-01`, to: lastDayOf(month) };
    Promise.all([listExpensesBetween({ ...range, members }), listPersonalSpend(range)])
      .then(([expenses, personal]) => {
        if (!live) return;
        setState({
          status: 'ready',
          key,
          itemised: expenses.filter((expense) => !expense.isVoided).map((expense) => expense.amount),
          privateSpend: personal.map((entry) => entry.total),
        });
      })
      .catch(() => {
        if (live) setState({ status: 'failed', key });
      });
    return () => {
      live = false;
    };
  }, [key, householdId, month, members]);

  if (key === null) return { status: 'idle' };
  return state.key === key ? state : { status: 'loading' };
}
