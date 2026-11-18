/**
 * What went into holdings in a month, for the Money card of a stated month (docs/design/spending-capture.md section 11.2; SC-I11).
 *
 * The household's holdings, the terms and renewals of its deposits and bonds, and its PPF payments are read, and `investedInput` builds the same input the Overview's
 * card builds. A failed read of the holdings is `failed`; a failed read of the terms or the PPF payments is named in `unread`, so the figure says it may be short.
 * It is not that there is none: the request failed. Nothing is read unless it is asked for.
 */

import { useEffect, useState } from 'react';
import { investedInMonth, type Invested } from '../../domain/invested.ts';
import { listFixedIncome } from '../../repo/fixedIncome.ts';
import { listHoldings } from '../../repo/holdings.ts';
import { listPpf } from '../../repo/retirement.ts';
import { investedInput } from '../overview/investedInput.ts';

export type InvestedRead =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly invested: Invested; readonly unread: readonly string[] };

export function useInvestedInMonth(householdId: string | null, month: string | null, today: string, asks: boolean): InvestedRead {
  const [state, setState] = useState<InvestedRead & { readonly key?: string }>({ status: 'idle' });
  const key = householdId === null || month === null || !asks ? null : `${householdId}|${month}`;

  useEffect(() => {
    if (key === null || householdId === null || month === null) return undefined;
    let live = true;
    Promise.all([listHoldings({ householdId, includeArchived: true }), Promise.allSettled([listFixedIncome(householdId), listPpf(householdId)])])
      .then(([listing, [fixed, ppf]]) => {
        if (!live) return;
        const unread = [fixed.status === 'rejected' ? 'deposits and bonds' : null, ppf.status === 'rejected' ? 'PPF payments' : null].filter((name): name is string => name !== null);
        const invested = investedInMonth(
          investedInput({
            listing,
            terms: fixed.status === 'fulfilled' ? fixed.value.terms : null,
            renewals: fixed.status === 'fulfilled' ? fixed.value.renewals : [],
            ppf: ppf.status === 'fulfilled' ? ppf.value.entries : null,
            month,
            scope: 'household',
            mine: null,
            today,
          }),
        );
        setState({ status: 'ready', key, invested, unread });
      })
      .catch(() => {
        if (live) setState({ status: 'failed', key });
      });
    return () => {
      live = false;
    };
  }, [key, householdId, month, today]);

  if (key === null) return { status: 'idle' };
  return state.key === key ? state : { status: 'loading' };
}
