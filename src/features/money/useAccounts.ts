/**
 * The Accounts screen's data: the household, who is looking, who the members are, the accounts the caller may read and their balances.
 *
 * One read, and one read again after every write. `listExpenses` is asked for one entry only, for what it also carries (the household, the
 * viewer's role and member, the members); the accounts and balances are `src/repo/accounts.ts`, and row-level security decides which of
 * them come back. Nothing is added up here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { addAccount, listAccounts, listBalances, updateAccount } from '../../repo/accounts.ts';
import { listCardDebts, type CardDebt } from '../../repo/cardDebt.ts';
import { listExpenses } from '../../repo/expenses.ts';
import type { Account, AccountBalance, AccountPatch, ExpenseListing, NewAccount } from '../../repo/types.ts';

export interface AccountsData {
  readonly household: ExpenseListing['household'];
  readonly viewer: ExpenseListing['viewer'];
  readonly members: ExpenseListing['members'];
  readonly accounts: readonly Account[];
  readonly balances: readonly AccountBalance[];
  /** The debts that are a card's EMI plans, read for an owner or a partner, who read every debt; a contributor's own are not read here, since nothing on this screen offers them to one (card-cycles.md 4a). */
  readonly cardDebts: readonly CardDebt[];
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
      const mayRead = listing.viewer.role === 'owner' || listing.viewer.role === 'partner';
      const [accounts, balances, cardDebts] = await Promise.all([
        listAccounts(listing.household.id, { includeArchived: true }),
        listBalances(listing.household.id),
        // A card's debt is a nicety on this screen: if it cannot be read, nothing here is wrong without it.
        mayRead ? listCardDebts(listing.household.id).catch((): readonly CardDebt[] => []) : Promise.resolve<readonly CardDebt[]>([]),
      ]);
      if (turn !== asked.current) return;
      setData({ household: listing.household, viewer: listing.viewer, members: listing.members, accounts, balances, cardDebts });
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
