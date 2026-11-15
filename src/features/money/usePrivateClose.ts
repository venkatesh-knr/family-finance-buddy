/**
 * What another member keeps private, as totals, for a month's close: the database adds it for an owner or a partner, and nobody else may ask
 * (`household_private_close`, docs/design/ledger-income.md LI-I27). Until it has been read, or when it could not be, `blocked` is true, and the close
 * and Last month show no figure: a close that leaves it out reads wrong, and not only low.
 */

import { useEffect, useState } from 'react';
import { householdPrivateClose } from '../../repo/moneyTotals.ts';
import type { PrivateClose } from '../../repo/types.ts';
import { lastDayOf } from './closeMonth.ts';

export function usePrivateClose(
  householdId: string | null,
  role: string | null,
  month: string,
): { readonly asks: boolean; readonly unread: readonly PrivateClose[] | null; readonly failed: boolean; readonly blocked: boolean } {
  const asks = householdId !== null && (role === 'owner' || role === 'partner');
  const [unread, setUnread] = useState<readonly PrivateClose[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!asks || householdId === null) return undefined;
    let live = true;
    setUnread(null);
    setFailed(false);
    householdPrivateClose(householdId, month, lastDayOf(month))
      .then((rows) => {
        if (live) setUnread(rows);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [asks, householdId, month]);
  return { asks, unread: asks ? unread : [], failed, blocked: asks && (unread === null || failed) };
}
