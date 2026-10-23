import { useCallback, useMemo, useState } from 'react';
import { latestValuationPerHolding } from '../../domain/networth.ts';
import type { Money } from '../../lib/money.ts';
import { canPlan, setCoverDependencyYears } from '../../repo/planning.ts';
import { Problem } from '../../ui/primitives.tsx';
import { usePlan } from '../plan/usePlan.ts';
import { useOverviewData } from '../overview/useOverviewData.ts';
import { CoverGapCard } from './CoverGapCard.tsx';
import { insuranceFacts, type InsuranceFacts } from './insuranceFacts.ts';
import { PolicyList } from './PolicyList.tsx';

/**
 * Insurance (docs/design/protection-and-flow.md §1 and §5; docs/design/vibrant-canvas.html, Insurance).
 *
 * One question beyond storage: is the household under-covered? The answer is a stated calculation with
 * every input on the face of the screen, and never a recommendation: a number that looks like advice
 * will be read as advice, and the app is not licensed to give it. Health cover has no suggested figure at
 * all, only what is in force.
 *
 * A policy has a cover and no value. Cover is read here and nowhere near net worth, allocation or FIRE
 * (PF-C3), and a ULIP's surrender value is a holding's, carried on the holding it cites.
 */
export function InsuranceScreen({ privacy, householdId }: { privacy: boolean; householdId: string | null }) {
  const plan = usePlan(householdId);
  const data = useOverviewData({ householdId, displayCurrency: '', scope: 'household' });
  const [problem, setProblem] = useState<string | null>(null);

  const listing = plan.listing;
  const editable = listing !== null && canPlan(listing.viewer.role);

  const surrenderValues = useMemo(() => {
    const map = new Map<string, Money>();
    for (const [id, reading] of latestValuationPerHolding(data.valuations)) map.set(id, reading.amount);
    return map;
  }, [data.valuations]);

  const facts = useMemo<InsuranceFacts | null>(() => {
    if (listing === null) return null;
    return insuranceFacts({
      policies: listing.policies,
      liabilities: listing.liabilities,
      surrenderValues,
      annual: plan.annual,
      years: listing.household.coverDependencyYears,
      liquid: data.fire.liquid.ok ? data.fire.liquid.amount : null,
      base: listing.household.baseCurrency,
      rates: data.rates,
      today: plan.today,
    });
  }, [listing, plan.annual, plan.today, surrenderValues, data.fire.liquid, data.rates]);

  const refresh = useCallback(async () => {
    plan.reload();
    await data.load();
  }, [plan, data]);

  // Only before there is anything to show. A save reloads in the background and swaps the figures in place:
  // unmounting every row and the open editor on each edit threw away the focus a person had just moved.
  if ((plan.loading && plan.listing === null) || (data.loading && data.listing === null)) {
    return <p className="note px-4.5 py-4.5">Loading…</p>;
  }
  if (plan.noHousehold || data.noHousehold) return null;
  if (plan.problem !== null || data.problem !== null || listing === null || facts === null) {
    return <Problem>{plan.problem ?? data.problem ?? 'Could not read the policies.'}</Problem>;
  }

  const base = listing.household.baseCurrency;

  return (
    <div className="flex flex-col gap-3">
      <CoverGapCard
        facts={facts}
        years={listing.household.coverDependencyYears}
        base={base}
        privacy={privacy}
        editable={editable}
        onYears={async (years) => {
          setProblem(null);
          try {
            await setCoverDependencyYears(listing.household.id, years);
            await refresh();
          } catch (error) {
            setProblem(error instanceof Error ? error.message : 'Could not save that.');
          }
        }}
      />

      {problem !== null && <Problem>{problem}</Problem>}

      <PolicyList
        policies={listing.policies}
        factsOf={(id) => facts.byPolicy.get(id)}
        renewals={facts.renewals}
        members={listing.members}
        holdings={data.listing?.holdings ?? []}
        base={base}
        householdId={listing.household.id}
        today={plan.today}
        privacy={privacy}
        editable={editable}
        onChanged={refresh}
        onProblem={setProblem}
      />
    </div>
  );
}
