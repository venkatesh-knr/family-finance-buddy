/**
 * The expenses screen's data.
 *
 * Reads through the repository, and re-reads when the change stream says
 * something moved. The subscription carries no rows: it is a signal, so
 * `listExpenses` stays the only path expense data travels and there is never a
 * second, untested mapping of a payload shape.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addExpense,
  listExpenses,
  listPersonalSpend,
  subscribeToExpenses,
  updateExpense,
  voidExpense,
  type LiveStatus,
} from '../../repo/expenses.ts';
import { monthBounds, taxYearBounds } from '../../domain/budget.ts';
import { listPlan } from '../../repo/planning.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import {
  NoHouseholdError,
  type Budget,
  type ExpenseListing,
  type NewExpense,
  type PersonalSpendPeriods,
} from '../../repo/types.ts';

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
  /** The plan for this tax year, so the ledger can be held against it. */
  readonly budgets: readonly Budget[];
  /**
   * Other members' private sums for the year (§20).
   *
   * Null, not empty, when the figure could not be fetched. An empty array
   * means "nobody has anything private"; null means "we do not know", and a
   * total built on the first when the truth is the second is quietly wrong.
   */
  readonly personalSpend: PersonalSpendPeriods | null;
  readonly fy: number;
  readonly today: string;
}

export function useExpenses(householdId: string | null): ExpensesState & {
  add: (expense: NewExpense) => Promise<void>;
  edit: (patch: Parameters<typeof updateExpense>[0]) => Promise<void>;
  discard: (id: string) => Promise<void>;
  reload: () => void;
} {
  const [listing, setListing] = useState<ExpenseListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [noHousehold, setNoHousehold] = useState(false);
  const [budgets, setBudgets] = useState<readonly Budget[]>([]);
  const [personalSpend, setPersonalSpend] = useState<PersonalSpendPeriods | null>({
    month: [],
    year: [],
  });
  const [live, setLive] = useState<LiveStatus>('connecting');

  // Read once at the edge; every calculation below takes it as an argument.
  const [today] = useState(() => istCalendarDate(new Date()));
  const fy = useMemo(() => {
    const year = Number(today.slice(0, 4));
    return Number(today.slice(5, 7)) >= 4 ? year : year - 1;
  }, [today]);
  const [liveDetail, setLiveDetail] = useState<string | null>(null);

  // Guards against a stale response overwriting a newer one when several
  // reloads are in flight — which realtime makes ordinary rather than rare.
  const generation = useRef(0);

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++generation.current;
    if (quiet) setRefreshing(true);
    try {
      const next = await listExpenses(householdId === null ? {} : { householdId });
      if (mine === generation.current) {
        setListing(next);
        setProblem(null);
        setNoHousehold(false);
      }

      // The plan, for the comparison. Fetched separately and allowed to fail
      // on its own: a viewer with no access to budgets should still see their
      // expenses rather than an error where the ledger ought to be.
      try {
        const plan = await listPlan({ householdId: next.household.id, fy });
        if (mine === generation.current) setBudgets(plan.budgets);
      } catch {
        if (mine === generation.current) setBudgets([]);
      }

      // The private sums, for BOTH periods the card can show.
      //
      // Not one and then narrowed: a month cannot be derived from a year here,
      // because the function returns a sum and deliberately no dates to narrow
      // it by. Deriving it would mean either a twelfth of the year, which is
      // not what anybody spent, or asking for the detail that must not be
      // returned. So the question is asked twice.
      //
      // Allowed to fail on its own, like the plan, but NOT flattened to empty:
      // a household total that silently drops private spending is the failure
      // section 20 exists to prevent, so the unknown travels as null and the
      // card says which it is.
      try {
        const year = taxYearBounds(fy);
        const month = monthBounds(today);
        const [forMonth, forYear] = await Promise.all([
          listPersonalSpend({ householdId: next.household.id, from: month.start, to: month.end }),
          listPersonalSpend({ householdId: next.household.id, from: year.start, to: year.end }),
        ]);
        if (mine === generation.current) setPersonalSpend({ month: forMonth, year: forYear });
      } catch {
        if (mine === generation.current) setPersonalSpend(null);
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
  }, [householdId, fy, today]);

  useEffect(() => {
    void load(false);
  }, [load]);

  // Subscribe to the household that actually loaded, which is not quite the
  // same as the one asked for: on a switch, the old listing is still on screen
  // for a moment, and subscribing to the new id before its rows arrive would
  // watch a household nothing on screen belongs to.
  const loadedHouseholdId = listing?.household.id ?? null;
  useEffect(() => {
    if (loadedHouseholdId === null) return;
    return subscribeToExpenses(
      loadedHouseholdId,
      () => {
        void load(true);
      },
      (status, detail) => {
        setLive(status);
        setLiveDetail(detail);
      },
    );
  }, [loadedHouseholdId, load]);

  // Both re-read afterwards rather than patching the list in place. The change
  // stream will also fire, but not necessarily first, and a correction that
  // does not visibly take is worse than one that takes slowly.
  const edit = useCallback(
    async (patch: Parameters<typeof updateExpense>[0]) => {
      await updateExpense(patch);
      await load(true);
    },
    [load],
  );

  const discard = useCallback(
    async (id: string) => {
      await voidExpense(id);
      await load(true);
    },
    [load],
  );

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

  return {
    listing,
    loading,
    refreshing,
    problem,
    live,
    liveDetail,
    noHousehold,
    budgets,
    personalSpend,
    fy,
    today,
    add,
    edit,
    discard,
    reload,
  };
}
