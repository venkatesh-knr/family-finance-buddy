/**
 * A household's recurring rules, with what a form needs to file one: its categories, its members and who is looking.
 *
 * Read through the repository and nowhere else. A rule that could not be read says so; it is not read as a household with none.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listExpenses } from '../../repo/expenses.ts';
import { addRule, listRules, postDueRecurring, updateRule } from '../../repo/recurring.ts';
import type { ExpenseListing, NewRecurringRule, RecurringRule, RecurringRulePatch } from '../../repo/types.ts';

export function useRules(householdId: string | null, recurringMade = 0) {
  const [rules, setRules] = useState<readonly RecurringRule[] | null>(null);
  const [listing, setListing] = useState<ExpenseListing | null>(null);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (householdId === null) return;
    const mine = ++generation.current;
    try {
      // One entry is enough: the listing is read for its categories, its members and who is looking, not for the entries.
      const [next, filing] = await Promise.all([listRules(householdId), listExpenses({ limit: 1, householdId })]);
      if (mine !== generation.current) return;
      setRules(next);
      setListing(filing);
      setFailed(false);
    } catch {
      if (mine === generation.current) setFailed(true);
    }
  }, [householdId]);

  // The poster ran after the first read and made some: read again, so a rule that was due shows its next day.
  useEffect(() => {
    if (recurringMade > 0) void load();
  }, [recurringMade, load]);

  /** After a change, enter what has come due (a rule added, resumed or moved to a day that has gone by), then read. */
  const settle = useCallback(async () => {
    if (householdId !== null) await postDueRecurring(householdId).catch(() => 0);
    await load();
  }, [householdId, load]);

  useEffect(() => {
    setRules(null);
    setListing(null);
    void load();
  }, [load]);

  const add = useCallback(
    async (input: NewRecurringRule) => {
      await addRule(input);
      await settle();
    },
    [settle],
  );

  const update = useCallback(
    async (id: string, patch: RecurringRulePatch) => {
      await updateRule(id, patch);
      await settle();
    },
    [settle],
  );

  return { rules, listing, failed, add, update, reload: load };
}

export type RulesData = ReturnType<typeof useRules>;
