/**
 * Every payment on the household's loans that the caller may read, newest first, for the loans card of the plan (docs/design/ledger-income.md section 4c).
 * A read that fails says so (`failed`): that is not a loan with no payments, and the card does not read as one.
 */

import { useCallback, useEffect, useState } from 'react';
import { listLoanPayments } from '../../repo/loanPayments.ts';
import type { LoanPayment } from '../../repo/types.ts';

export function useLoanPaymentList(householdId: string | null): {
  readonly payments: readonly LoanPayment[];
  readonly failed: boolean;
  /** The payments have been read: until then, a loan with none listed is a loan not yet read, and not one with none. */
  readonly loaded: boolean;
  readonly reload: () => void;
} {
  const [payments, setPayments] = useState<readonly LoanPayment[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (householdId === null) return undefined;
    let live = true;
    listLoanPayments(householdId)
      .then((rows) => {
        if (live) {
          setPayments(rows);
          setFailed(false);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [householdId, round]);
  const reload = useCallback(() => {
    setRound((n) => n + 1);
  }, []);
  return { payments, failed, loaded, reload };
}
