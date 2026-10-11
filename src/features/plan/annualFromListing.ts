import { annualPlannedExpense, type AnnualExpense, type PlannedOutgoing } from '../../domain/annual-expense.ts';
import type { PlanListing } from '../../repo/types.ts';

/**
 * The approximate annual expense, from what a plan listing holds: the planned categories, the loans that
 * are open and the policies that are in force.
 *
 * One place, because the FIRE target, the cover gap and the Overview's protection line are all built on
 * the same figure, and three screens working it out three ways is how they disagree. Null in mixed
 * currencies, which the screen shows as a problem and not as a number.
 */
export function annualFromListing(listing: PlanListing): AnnualExpense | null {
  const outgoings: PlannedOutgoing[] = [];

  for (const category of listing.categories) {
    // An archived category is out of the picker and out of the estimate. Its history stays; its plan
    // does not, because nobody intends to spend it.
    if (category.isArchived) continue;

    const compulsory = category.nature === 'fixed';
    const monthly = listing.budgets.find((b) => b.categoryId === category.id && b.cadence === 'monthly') ?? null;
    const yearly = listing.budgets.find((b) => b.categoryId === category.id && b.cadence === 'yearly') ?? null;

    // A category with neither figure is unplanned, and says so once rather than twice.
    if (monthly === null && yearly === null) {
      outgoings.push({ label: category.name, amount: null, cadence: 'monthly', source: 'category', compulsory });
      continue;
    }
    if (monthly !== null) {
      outgoings.push({ label: category.name, amount: monthly.planned, cadence: 'monthly', source: 'category', compulsory });
    }
    if (yearly !== null) {
      outgoings.push({ label: category.name, amount: yearly.planned, cadence: 'yearly', source: 'category', compulsory });
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
    outgoings.push({ label: policy.name, amount: policy.premium, cadence: policy.cadence, source: 'policy' });
  }

  try {
    return annualPlannedExpense(outgoings);
  } catch {
    return null;
  }
}
