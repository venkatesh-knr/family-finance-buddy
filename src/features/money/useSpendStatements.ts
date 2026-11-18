/**
 * The stated spends for some months, read for an owner or a partner (docs/design/spending-capture.md section 11). Anybody else reads none, and is not
 * asked: the hook then does nothing. A failed read is `failed` and never a month with nothing stated, so a figure is not shown as itemised when it was only
 * not read.
 */

import { useCallback, useEffect, useState } from 'react';
import { listSpendStatements } from '../../repo/spendStatements.ts';
import type { SpendStatement } from '../../repo/types.ts';

export type SpendStatements =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly statements: readonly SpendStatement[] };

export function useSpendStatements(
  householdId: string | null,
  months: readonly string[],
  asks: boolean,
  /** Changes when something was written that the figures depend on: the statements are read again, without going back to *loading*. */
  refreshKey?: unknown,
): { readonly read: SpendStatements; readonly reload: () => void } {
  const [state, setState] = useState<SpendStatements & { readonly key?: string }>({ status: 'idle' });
  const [bump, setBump] = useState(0);
  const monthsKey = months.join(',');
  const key = householdId === null || !asks || months.length === 0 ? null : `${householdId}|${monthsKey}|${String(bump)}`;

  useEffect(() => {
    if (key === null || householdId === null) return undefined;
    let live = true;
    listSpendStatements(householdId, monthsKey.split(','))
      .then((statements) => {
        if (live) setState({ status: 'ready', key, statements });
      })
      .catch(() => {
        if (live) setState({ status: 'failed', key });
      });
    return () => {
      live = false;
    };
  }, [key, householdId, monthsKey, refreshKey]);

  const reload = useCallback(() => {
    setBump((n) => n + 1);
  }, []);
  if (key === null) return { read: { status: 'idle' }, reload };
  return { read: state.key === key ? state : { status: 'loading' }, reload };
}
