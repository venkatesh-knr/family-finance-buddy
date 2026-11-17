/**
 * The household's cash reserve as at the last day of a closed month, per currency: the latest balance of each account, a card's due taken off, with how
 * many accounts had a balance and how many there are, over every account of the household (`household_cash_reserve`,
 * LI-I27). An owner or a partner only: the database refuses anyone else. A failed read is `failed` and never a reserve of nothing.
 */

import { useEffect, useState } from 'react';
import { householdCashReserve } from '../../repo/moneyTotals.ts';
import type { CashReserve } from '../../repo/types.ts';

export type CashReserveState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly lines: readonly CashReserve[] };

/** `asOf` is null before a first close, and the hook then does nothing. `refreshKey` changes when balances were written. */
export function useCashReserve(householdId: string | null, role: string | null, asOf: string | null, refreshKey: unknown): CashReserveState {
  const asks = householdId !== null && asOf !== null && (role === 'owner' || role === 'partner');
  const key = asks ? `${householdId}|${asOf}` : null;
  const [state, setState] = useState<CashReserveState & { readonly key?: string }>({ status: 'idle' });

  useEffect(() => {
    if (key === null || householdId === null || asOf === null) return undefined;
    let live = true;
    householdCashReserve(householdId, asOf)
      .then((lines) => {
        if (live) setState({ status: 'ready', key, lines });
      })
      .catch(() => {
        if (live) setState({ status: 'failed', key });
      });
    return () => {
      live = false;
    };
  }, [key, householdId, asOf, refreshKey]);

  if (key === null) return { status: 'idle' };
  return state.key === key ? state : { status: 'loading' };
}
