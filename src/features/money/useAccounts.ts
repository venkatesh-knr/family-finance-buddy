/**
 * The Accounts tab's data: the household, who is looking, who the members are, the accounts the caller may read and their balances.
 *
 * One read, and one read again after every write. `listExpenses` is asked for one entry only, for what it also carries (the household, the
 * viewer's role and member, the members); the accounts and balances are `src/repo/accounts.ts`, and row-level security decides which of
 * them come back. Nothing is added up here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { addAccount, listAccounts, listBalances, updateAccount } from '../../repo/accounts.ts';
import { listExpenses } from '../../repo/expenses.ts';
import type { Account, AccountBalance, AccountPatch, ExpenseListing, NewAccount } from '../../repo/types.ts';

export interface AccountsData {
  readonly household: ExpenseListing['household'];
  readonly viewer: ExpenseListing['viewer'];
  readonly members: ExpenseListing['members'];
  readonly accounts: readonly Account[];
  readonly balances: readonly AccountBalance[];
}

export function useAccounts(householdId: string | null) {
  const [data, setData] = useState<AccountsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  // A read that answers after a newer one was asked for is not shown: the household may have changed in between.
  const asked = useRef(0);

  const load = useCallback(async () => {
    const turn = ++asked.current;
    try {
      const listing = await listExpenses(householdId === null ? { limit: 1 } : { limit: 1, householdId });
      const [accounts, balances] = await Promise.all([listAccounts(listing.household.id, { includeArchived: true }), listBalances(listing.household.id)]);
      if (turn !== asked.current) return;
      setData({ household: listing.household, viewer: listing.viewer, members: listing.members, accounts, balances });
      setProblem(null);
    } catch (error) {
      if (turn !== asked.current) return;
      setProblem(error instanceof Error ? error.message : 'The accounts could not be read.');
    } finally {
      if (turn === asked.current) setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    void load();
  }, [load]);

  const add = useCallback(
    async (input: NewAccount): Promise<{ readonly id: string }> => {
      const made = await addAccount(input);
      await load();
      return made;
    },
    [load],
  );

  const change = useCallback(
    async (id: string, patch: AccountPatch): Promise<void> => {
      await updateAccount(id, patch);
      await load();
    },
    [load],
  );

  return { data, loading, problem, add, change, reload: load };
}
