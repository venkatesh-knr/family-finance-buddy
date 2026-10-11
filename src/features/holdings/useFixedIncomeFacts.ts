import { useCallback, useEffect, useMemo, useState } from 'react';
import { fixedIncomeView, type FixedIncomePosition, type FixedIncomeView } from '../../domain/fixed-income.ts';
import type { IsoDate } from '../../lib/dates.ts';
import { listFixedIncome } from '../../repo/fixedIncome.ts';
import type { FixedIncomeListing, HoldingListing } from '../../repo/types.ts';
import { buildPosition } from './fixedIncomeRows.ts';

/**
 * What the Holdings list and a holding's screen need to know about its deposits and bonds: the position as
 * recorded and the view it works out for today.
 *
 * Read apart from the holdings, and its failure is the screen's to carry on without: a deposit with no terms read
 * still has its latest reading and its place in the list, and says "terms not recorded" in place of a maturity
 * rather than a date it made up.
 */

export interface FixedFacts {
  readonly position: FixedIncomePosition;
  readonly view: FixedIncomeView;
  readonly institution: string | null;
  readonly last4: string | null;
  readonly rating: string | null;
}

export interface FixedIncomeFacts {
  get: (holdingId: string) => FixedFacts | undefined;
  all: ReadonlyMap<string, FixedFacts>;
  /** The raw terms and renewals, for the screens that edit them. */
  data: FixedIncomeListing | null;
  failed: boolean;
  reload: () => void;
}

export function useFixedIncomeFacts(listing: HoldingListing | null, today: IsoDate): FixedIncomeFacts {
  const [data, setData] = useState<FixedIncomeListing | null>(null);
  const [failed, setFailed] = useState(false);
  const householdId = listing?.household.id ?? null;

  const load = useCallback(async () => {
    if (householdId === null) return;
    try {
      setData(await listFixedIncome(householdId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const all = useMemo(() => {
    const map = new Map<string, FixedFacts>();
    if (data === null) return map;
    for (const terms of data.terms) {
      const position = buildPosition(terms, data.renewals);
      map.set(terms.holdingId, {
        position,
        view: fixedIncomeView(position, today),
        institution: terms.institution,
        last4: terms.accountLast4,
        rating: terms.rating,
      });
    }
    return map;
  }, [data, today]);

  return {
    get: (holdingId) => all.get(holdingId),
    all,
    data,
    failed,
    reload: () => {
      void load();
    },
  };
}
