/**
 * The Ledger tab's money in and money moved, beside the accounts they name.
 *
 * `useAccounts` supplies the household, who is looking, the members and the accounts; this adds the credits and moves the caller may read, and the
 * household's credit rules (the salary rule), which the Expected panel lists when they are due,
 * through the repository, and reads them again after a credit is written. Row-level security decides which come back: a contributor's own,
 * an owner's or a partner's shared ones and their own private ones, and a viewer none. A failed read leaves the list without them and says
 * so, and never takes the spending down with it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listCredits } from '../../repo/credits.ts';
import { listIncomeRules } from '../../repo/incomeRules.ts';
import { listTransfers } from '../../repo/transfers.ts';
import type { Credit, IncomeRule, Transfer } from '../../repo/types.ts';
import { useAccounts } from './useAccounts.ts';

export function useMoneyLedger(householdId: string | null) {
  const accounts = useAccounts(householdId);
  const resolvedId = accounts.data?.household.id ?? null;
  const [credits, setCredits] = useState<readonly Credit[]>([]);
  const [transfers, setTransfers] = useState<readonly Transfer[]>([]);
  const [rules, setRules] = useState<readonly IncomeRule[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  // A read that answers after a newer one was asked for is not shown: the household may have changed in between.
  const asked = useRef(0);

  const loadMoney = useCallback(async () => {
    if (resolvedId === null) return;
    const turn = ++asked.current;
    try {
      const [nextCredits, nextTransfers, nextRules] = await Promise.all([listCredits(resolvedId), listTransfers(resolvedId), listIncomeRules(resolvedId)]);
      if (turn !== asked.current) return;
      setCredits(nextCredits);
      setTransfers(nextTransfers);
      setRules(nextRules);
      setProblem(null);
      setStatus('ready');
    } catch (error) {
      if (turn !== asked.current) return;
      setProblem(error instanceof Error ? error.message : 'Money in could not be read.');
      setStatus('failed');
    }
  }, [resolvedId]);

  useEffect(() => {
    setCredits([]);
    setTransfers([]);
    setRules([]);
    setStatus('loading');
    void loadMoney();
  }, [loadMoney]);

  return { ...accounts, credits, transfers, rules, moneyStatus: status, moneyProblem: problem, reloadMoney: loadMoney };
}
