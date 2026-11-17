/**
 * The month's payments on loans, for the close and for Last month (ledger-income.md section 4c; LI-I38). Until they have been read, or when they could
 * not be, `blocked` is true and the close shows no figure: read as none, an EMI would sit in spent and saved would read the same while the split read wrong.
 * A household with no account has none to name, and is not made to wait.
 */

import { useEffect, useState } from 'react';
import { listLoanPayments } from '../../repo/loanPayments.ts';
import type { LoanPayment } from '../../repo/types.ts';
import { lastDayOf } from './closeMonth.ts';

export function useLoanPayments(
  householdId: string | null,
  month: string,
  asks: boolean,
): { readonly payments: readonly LoanPayment[]; readonly failed: boolean; readonly blocked: boolean } {
  const [state, setState] = useState<{ key: string; payments: readonly LoanPayment[] } | { key: string; failed: true } | null>(null);
  const key = householdId === null || !asks ? null : `${householdId}|${month}`;
  useEffect(() => {
    if (key === null || householdId === null) return undefined;
    let live = true;
    listLoanPayments(householdId, { from: `${month}-01`, to: lastDayOf(month) })
      .then((payments) => {
        if (live) setState({ key, payments });
      })
      .catch(() => {
        if (live) setState({ key, failed: true });
      });
    return () => {
      live = false;
    };
  }, [key, householdId, month]);
  if (key === null) return { payments: [], failed: false, blocked: false };
  if (state === null || state.key !== key) return { payments: [], failed: false, blocked: true };
  if ('failed' in state) return { payments: [], failed: true, blocked: true };
  return { payments: state.payments, failed: false, blocked: false };
}
