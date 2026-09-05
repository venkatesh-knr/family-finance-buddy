/**
 * The expenses screen's data.
 *
 * Reads through the repository, and re-reads when the change stream says
 * something moved. The subscription carries no rows: it is a signal, so
 * `listExpenses` stays the only path expense data travels and there is never a
 * second, untested mapping of a payload shape.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addExpense,
  listExpenses,
  subscribeToExpenses,
  type LiveStatus,
} from '../../repo/expenses.ts';
import { NoHouseholdError, type ExpenseListing, type NewExpense } from '../../repo/types.ts';

export interface ExpensesState {
  readonly listing: ExpenseListing | null;
  readonly loading: boolean;
  readonly problem: string | null;
  /** True while a change arriving from another device is being folded in. */
  readonly refreshing: boolean;
  /** Whether this screen is actually receiving live updates. */
  readonly live: LiveStatus;
  readonly liveDetail: string | null;
  /**
   * Not an error, a state. An invited person signs in before they belong to
   * anything, and telling them "could not load expenses" would describe the
   * symptom rather than what to do.
   */
  readonly noHousehold: boolean;
}

export function useExpenses(): ExpensesState & {
  add: (expense: NewExpense) => Promise<void>;
  reload: () => void;
} {
  const [listing, setListing] = useState<ExpenseListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [noHousehold, setNoHousehold] = useState(false);
  const [live, setLive] = useState<LiveStatus>('connecting');
  const [liveDetail, setLiveDetail] = useState<string | null>(null);

  // Guards against a stale response overwriting a newer one when several
  // reloads are in flight — which realtime makes ordinary rather than rare.
  const generation = useRef(0);

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++generation.current;
    if (quiet) setRefreshing(true);
    try {
      const next = await listExpenses();
      if (mine === generation.current) {
        setListing(next);
        setProblem(null);
        setNoHousehold(false);
      }
    } catch (error) {
      if (mine === generation.current) {
        if (error instanceof NoHouseholdError) {
          setNoHousehold(true);
          setProblem(null);
        } else {
          setProblem(error instanceof Error ? error.message : 'Could not load expenses.');
        }
      }
    } finally {
      if (mine === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // Subscribe once the household is known, and re-subscribe if it changes.
  const householdId = listing?.household.id ?? null;
  useEffect(() => {
    if (householdId === null) return;
    return subscribeToExpenses(
      householdId,
      () => {
        void load(true);
      },
      (status, detail) => {
        setLive(status);
        setLiveDetail(detail);
      },
    );
  }, [householdId, load]);

  const add = useCallback(
    async (expense: NewExpense) => {
      await addExpense(expense);
      // The change stream will also fire, but not necessarily first, and the
      // person who just typed the amount should not have to wait for a round
      // trip through the websocket to see it.
      await load(true);
    },
    [load],
  );

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { listing, loading, refreshing, problem, live, liveDetail, noHousehold, add, reload };
}
