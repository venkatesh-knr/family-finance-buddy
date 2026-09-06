/**
 * The planning screen's data, and the two figures that follow from it.
 *
 * The repository returns the plan; the domain turns it into an annual expense
 * and a FIRE ladder. That split is the whole point — both calculations are pure
 * and checked against the workbook's own cells, and this hook only decides
 * which year to ask about.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  annualPlannedExpense,
  type AnnualExpense,
  type PlannedOutgoing,
} from '../../domain/annual-expense.ts';
import { fireBaseYear, fireLadder, type LadderStep } from '../../domain/fire.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import {
  addCategory,
  addLiability,
  addPolicy,
  archiveCategory,
  listPlan,
  renameCategory,
  seedStarterCategories,
  setBudget,
} from '../../repo/planning.ts';
import { NoHouseholdError, type Budget, type PlanListing } from '../../repo/types.ts';

/** The tax year containing a given IST date. April starts a new one. */
export function taxYearOf(today: string): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month >= 4 ? year : year - 1;
}

export interface CategoryPlan {
  readonly categoryId: string;
  readonly name: string;
  readonly nature: 'fixed' | 'variable';
  readonly isArchived: boolean;
  readonly monthly: Budget | null;
  readonly yearly: Budget | null;
}

export interface PlanState {
  readonly listing: PlanListing | null;
  readonly rows: readonly CategoryPlan[];
  readonly annual: AnnualExpense | null;
  readonly ladder: readonly LadderStep[];
  readonly multiplier: number;
  readonly setMultiplier: (next: number) => void;
  readonly inflationPct: number;
  readonly setInflationPct: (next: number) => void;
  readonly fy: number;
  readonly today: string;
  readonly loading: boolean;
  readonly problem: string | null;
  readonly noHousehold: boolean;
  readonly reload: () => void;
}

export function usePlan(householdId: string | null): PlanState & {
  seed: () => Promise<void>;
  saveBudget: (categoryId: string, cadence: 'monthly' | 'yearly', planned: bigint) => Promise<void>;
  createCategory: (name: string, nature: 'fixed' | 'variable') => Promise<void>;
  setArchived: (categoryId: string, archived: boolean) => Promise<void>;
  rename: (categoryId: string, name: string) => Promise<void>;
  createLiability: (input: Parameters<typeof addLiability>[0]) => Promise<void>;
  createPolicy: (input: Parameters<typeof addPolicy>[0]) => Promise<void>;
} {
  const [listing, setListing] = useState<PlanListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [noHousehold, setNoHousehold] = useState(false);

  // The clock is read once, here at the edge. Everything below takes a date.
  const [today] = useState(() => istCalendarDate(new Date()));
  const fy = useMemo(() => taxYearOf(today), [today]);

  const [multiplier, setMultiplier] = useState(25);
  const [inflationPct, setInflationPct] = useState(6);

  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await listPlan(householdId === null ? { fy } : { householdId, fy });
      if (mine === generation.current) {
        setListing(next);
        setProblem(null);
        setNoHousehold(false);
      }
    } catch (error) {
      if (mine !== generation.current) return;
      if (error instanceof NoHouseholdError) {
        setNoHousehold(true);
        setProblem(null);
      } else {
        setProblem(error instanceof Error ? error.message : 'Could not load the plan.');
      }
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [householdId, fy]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<readonly CategoryPlan[]>(() => {
    if (listing === null) return [];
    return listing.categories.map((category) => ({
      categoryId: category.id,
      name: category.name,
      nature: category.nature,
      isArchived: category.isArchived,
      monthly:
        listing.budgets.find((b) => b.categoryId === category.id && b.cadence === 'monthly') ?? null,
      yearly:
        listing.budgets.find((b) => b.categoryId === category.id && b.cadence === 'yearly') ?? null,
    }));
  }, [listing]);

  const annual = useMemo<AnnualExpense | null>(() => {
    if (listing === null) return null;

    const outgoings: PlannedOutgoing[] = [];

    for (const row of rows) {
      // An archived category is out of the picker and out of the estimate. Its
      // history stays; its plan does not, because nobody intends to spend it.
      if (row.isArchived) continue;

      const compulsory = row.nature === 'fixed';

      // A category with neither figure is unplanned, and says so once rather
      // than twice — otherwise every empty row would appear in that list at
      // both cadences and drown the ones that matter.
      if (row.monthly === null && row.yearly === null) {
        outgoings.push({ label: row.name, amount: null, cadence: 'monthly', source: 'category', compulsory });
        continue;
      }
      if (row.monthly !== null) {
        outgoings.push({ label: row.name, amount: row.monthly.planned, cadence: 'monthly', source: 'category', compulsory });
      }
      if (row.yearly !== null) {
        outgoings.push({ label: row.name, amount: row.yearly.planned, cadence: 'yearly', source: 'category', compulsory });
      }
    }

    for (const liability of listing.liabilities) {
      if (liability.isClosed) continue;
      outgoings.push({
        label: liability.name,
        amount: liability.instalment,
        cadence: liability.cadence,
        source: 'liability',
      });
    }

    for (const policy of listing.policies) {
      if (policy.isLapsed) continue;
      outgoings.push({
        label: policy.name,
        amount: policy.premium,
        cadence: policy.cadence,
        source: 'policy',
      });
    }

    try {
      return annualPlannedExpense(outgoings);
    } catch {
      // Mixed currencies. The screen shows the problem rather than a number.
      return null;
    }
  }, [listing, rows]);

  const ladder = useMemo<readonly LadderStep[]>(() => {
    if (annual === null) return [];
    return fireLadder({
      annualExpense: annual.total,
      multiplier,
      inflationPct,
      fromYear: fireBaseYear(today),
      years: 10,
    });
  }, [annual, multiplier, inflationPct, today]);

  const after = useCallback(
    async <T,>(action: Promise<T>): Promise<void> => {
      await action;
      await load();
    },
    [load],
  );

  return {
    listing,
    rows,
    annual,
    ladder,
    multiplier,
    setMultiplier,
    inflationPct,
    setInflationPct,
    fy,
    today,
    loading,
    problem,
    noHousehold,
    reload: () => void load(),
    seed: async () => {
      if (listing === null) return;
      await after(seedStarterCategories(listing.household.id));
    },
    saveBudget: async (categoryId, cadence, planned) => {
      if (listing === null) return;
      await after(
        setBudget({
          householdId: listing.household.id,
          categoryId,
          fy,
          cadence,
          planned: { minor: planned, currency: listing.household.baseCurrency },
        }),
      );
    },
    createCategory: async (name, nature) => {
      if (listing === null) return;
      const highest = listing.categories.reduce((max, c) => Math.max(max, c.sortOrder), 0);
      await after(
        addCategory({ householdId: listing.household.id, name, nature, sortOrder: highest + 10 }),
      );
    },
    setArchived: async (categoryId, archived) => {
      await after(archiveCategory(categoryId, archived));
    },
    rename: async (categoryId, name) => {
      await after(renameCategory(categoryId, name));
    },
    createLiability: async (input) => {
      await after(addLiability(input));
    },
    createPolicy: async (input) => {
      await after(addPolicy(input));
    },
  };
}
