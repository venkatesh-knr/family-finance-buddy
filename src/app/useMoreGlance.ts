import { useEffect, useMemo, useState } from 'react';
import { taxYearOf } from '../domain/budget.ts';
import { money, type Money } from '../lib/money.ts';
import { todayInIst } from '../repo/expenses.ts';
import { listPlan } from '../repo/planning.ts';
import type { InsurancePolicy } from '../repo/types.ts';
import { useHoldings } from '../features/holdings/useHoldings.ts';
import { taxFigures } from '../features/tax/taxFigures.ts';
import { insuranceGlance, type InsuranceGlance } from './moreGlance.ts';

export interface TaxGlance {
  readonly fy: number;
  /** The capital gains tax so far this year for the person looking, or null where it cannot be said. */
  readonly tax: Money | null;
  /** What is left of the equity allowance, or null where no rule covers the year. */
  readonly allowanceUnused: Money | null;
}

/**
 * What More says under Tax and Insurance, read from the same figures those screens use.
 *
 * Read only for the places that person can open, and not at all until they are asked for: a household id of null
 * reads nothing. A line that has not arrived is absent and the row still opens; nothing waits on it.
 */
export function useMoreGlance(options: { householdId: string | null; wantsTax: boolean; wantsInsurance: boolean }) {
  const { householdId, wantsTax, wantsInsurance } = options;
  const { listing, rows, today, taxRules, taxRulesFailed } = useHoldings(wantsTax ? householdId : null);

  const tax = useMemo<TaxGlance | null>(() => {
    if (!wantsTax || listing === null || taxRulesFailed) return null;
    const fy = taxYearOf(today);
    const disposalKindOf = new Map(listing.disposals.map((sale) => [sale.id, sale.kind as string]));
    const { gains, tax: figures } = taxFigures({
      rows,
      memberId: listing.viewer.memberId,
      fy,
      rules: taxRules,
      disposalKindOf,
    });
    const allowance = gains.equityLong.exemption;
    return {
      fy,
      tax: figures.total,
      allowanceUnused:
        allowance === null ? null : money(allowance.available.minor - allowance.used.minor, allowance.available.currency),
    };
  }, [wantsTax, listing, rows, today, taxRules, taxRulesFailed]);

  const [policies, setPolicies] = useState<readonly InsurancePolicy[] | null>(null);
  useEffect(() => {
    if (!wantsInsurance || householdId === null) return;
    let live = true;
    listPlan({ householdId, fy: Number(todayInIst().slice(0, 4)) })
      .then((plan) => {
        if (live) setPolicies(plan.policies);
      })
      .catch(() => {
        if (live) setPolicies(null);
      });
    return () => {
      live = false;
    };
  }, [wantsInsurance, householdId]);

  const insurance = useMemo<InsuranceGlance | null>(
    () => (policies === null ? null : insuranceGlance(policies, todayInIst())),
    [policies],
  );

  return { tax, insurance };
}
