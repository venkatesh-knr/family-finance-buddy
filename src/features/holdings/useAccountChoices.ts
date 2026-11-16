/**
 * The household's accounts, for naming one on a purchase, a sale or a PPF entry, and for saying which one an entry named. Read once. A read that fails
 * offers none and says so (`failed`): that is not a household with no accounts, and the screen does not read as one. An archived account is in the list,
 * so an entry that named it can say so and `paidViaOf` can refuse it by name; the picker does not offer it.
 */

import { useEffect, useState } from 'react';
import { listAccounts } from '../../repo/accounts.ts';
import type { Account } from '../../repo/types.ts';

export function useAccountChoices(householdId: string | null): {
  readonly accounts: readonly Account[];
  readonly failed: boolean;
  /** The accounts have been read, so an account an entry names that is not among them is one this person cannot read. */
  readonly loaded: boolean;
} {
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (householdId === null) return undefined;
    let live = true;
    listAccounts(householdId, { includeArchived: true })
      .then((rows) => {
        if (live) {
          setAccounts(rows);
          setFailed(false);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (live) {
          setAccounts([]);
          setFailed(true);
          setLoaded(false);
        }
      });
    return () => {
      live = false;
    };
  }, [householdId]);
  return { accounts, failed, loaded };
}
