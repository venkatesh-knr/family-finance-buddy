/**
 * The household's accounts, for naming one on a purchase, a sale or a PPF entry. Read once; a read that fails offers none, and the entry is then simply
 * not tied to an account, as before. An archived account is kept in the list so `paidViaOf` can refuse it by name rather than by absence.
 */

import { useEffect, useState } from 'react';
import { listAccounts } from '../../repo/accounts.ts';
import type { Account } from '../../repo/types.ts';

export function useAccountChoices(householdId: string | null): readonly Account[] {
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  useEffect(() => {
    if (householdId === null) return undefined;
    let live = true;
    listAccounts(householdId)
      .then((rows) => {
        if (live) setAccounts(rows);
      })
      .catch(() => {
        if (live) setAccounts([]);
      });
    return () => {
      live = false;
    };
  }, [householdId]);
  return accounts;
}
