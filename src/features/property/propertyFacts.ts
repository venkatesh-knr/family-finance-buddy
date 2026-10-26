/**
 * What the property screen says, worked out from the listing: for each property its cost basis, its latest valuation
 * and how old that is, its equity after its loan; and, per currency, the totals.
 *
 * Pure: the listing and today in, the facts out, every figure from `src/domain/property.ts`. Nothing is added across
 * currencies: a property abroad has its own total, and a total in one currency never carries another's. Net worth
 * counts the household's share, never the whole (docs/decisions.md, Property), so every figure here is the share.
 */

import type { IsoDate } from '../../lib/dates.ts';
import { money, type Money } from '../../lib/money.ts';
import {
  latestValuationOn,
  propertyCostBasis,
  propertyEquity,
  shareOfMoney,
  valuationAge,
  type PropertyCostBasis,
} from '../../domain/property.ts';
import type {
  Property,
  PropertyImprovement,
  PropertyListing,
  PropertyLoan,
  PropertyValuation,
  ValuationBasis,
} from '../../repo/types.ts';

export interface PropertyFacts {
  readonly property: Property;
  /** The cost of the whole and the household's share of it, or why it could not be worked out. */
  readonly cost: PropertyCostBasis;
  /** Work recorded and not voided, oldest first: the ones the cost is made from. */
  readonly work: readonly PropertyImprovement[];
  /** Work voided: in the log, struck out, and not in the cost. */
  readonly voided: readonly PropertyImprovement[];
  /** The latest valuation at or before today, with the household's share of it. Null before anybody has said. */
  readonly value: {
    readonly asOf: IsoDate;
    readonly whole: Money;
    readonly share: Money;
    readonly basis: ValuationBasis;
    readonly note: string | null;
  } | null;
  readonly age: { readonly months: number; readonly stale: boolean } | null;
  /** Every valuation of this property, newest first. */
  readonly valuations: readonly PropertyValuation[];
  readonly loan: PropertyLoan | null;
  /**
   * The household's share of the value less what is owed on the loan. Null when it cannot be said, and `equityWhy`
   * says why: there is a value and a loan with no balance recorded, or no value yet, or the loan is in another currency.
   */
  readonly equity: Money | null;
  readonly equityWhy: 'no-value' | 'no-balance' | 'mixed-currency' | null;
}

export interface CurrencyTotals {
  readonly currency: string;
  /** The household's share of every cost basis, of the duty and registration in it, and of the capital work in it. */
  readonly cost: Money;
  readonly dutyAndRegistration: Money;
  readonly capitalWork: Money;
  /** The household's share of the latest valuations; what is not valued is not in it, and is counted. */
  readonly value: Money;
  readonly unvalued: number;
  /** Equity after loans, only when every property with a loan in this currency could say it. */
  readonly equity: Money | null;
  readonly equityGaps: number;
  /** How many of these properties have a home loan: equity says nothing until one has. */
  readonly withLoan: number;
  readonly count: number;
}

export interface PropertyFactsAll {
  readonly byProperty: readonly PropertyFacts[];
  readonly totals: readonly CurrencyTotals[];
  /** The oldest of the latest valuations, which is the one most likely to be wrong. Null with nothing valued. */
  readonly oldest: { readonly months: number; readonly stale: boolean } | null;
  readonly staleCount: number;
}

export function propertyFacts(listing: PropertyListing, today: IsoDate): PropertyFactsAll {
  const loansById = new Map(listing.loans.map((loan) => [loan.id, loan]));

  const byProperty: PropertyFacts[] = listing.properties.map((property) => {
    const mine = listing.improvements.filter((work) => work.propertyId === property.id);
    const work = mine.filter((entry) => !entry.isVoided);
    const voided = mine.filter((entry) => entry.isVoided);

    const cost = propertyCostBasis({
      purchaseCost: property.purchaseCost,
      stampDuty: property.stampDuty,
      registration: property.registration,
      improvements: work.map((entry) => ({ date: entry.date, amount: entry.amount, isCapital: entry.isCapital })),
      sharePct: property.sharePct,
      asOf: today,
    });

    const valuations = listing.valuations.filter((entry) => entry.propertyId === property.id);
    const latest = latestValuationOn(valuations, today);
    const share = latest === null ? null : shareOfMoney(latest.value, property.sharePct);
    const value =
      latest === null || share === null || !share.ok
        ? null
        : { asOf: latest.asOf, whole: latest.value, share: share.amount, basis: latest.basis, note: latest.note };

    const loan = property.linkedLiabilityId === null ? null : (loansById.get(property.linkedLiabilityId) ?? null);
    // A closed loan is paid off: nothing is owed on it, whatever balance it last carried.
    const owed = loan === null ? null : loan.outstanding ?? (loan.isClosed ? money(0n, property.currency) : null);

    let equity: Money | null = null;
    let equityWhy: PropertyFacts['equityWhy'] = null;
    if (loan !== null) {
      if (value === null) equityWhy = 'no-value';
      else if (owed === null) equityWhy = 'no-balance';
      else {
        // The household's share of the loan, as of the value: a half share of the property carries half of what is
        // owed on it (docs/reviews/2026-10-26-property/proposal.md; docs/decisions.md, Property).
        const owedShare = shareOfMoney(owed, property.sharePct);
        const result = owedShare.ok ? propertyEquity(value.share, owedShare.amount) : null;
        if (result === null) equityWhy = 'no-balance';
        else if (result.ok) equity = result.equity;
        else equityWhy = result.reason;
      }
    }

    return {
      property,
      cost,
      work,
      voided,
      value,
      age: value === null ? null : valuationAge(value.asOf, today, listing.staleMonths),
      valuations,
      loan,
      equity,
      equityWhy,
    };
  });

  const currencies = [...new Set(byProperty.map((facts) => facts.property.currency))];
  const totals: CurrencyTotals[] = currencies.map((currency) => {
    const rows = byProperty.filter((facts) => facts.property.currency === currency);
    let cost = 0n;
    let dutyAndRegistration = 0n;
    let capitalWork = 0n;
    let value = 0n;
    let unvalued = 0;
    let equity = 0n;
    let equityGaps = 0;
    let withLoan = 0;

    for (const row of rows) {
      if (row.cost.ok) {
        cost += row.cost.share.minor;
        const duty = shareOfMoney(
          money(row.cost.stampDuty.minor + row.cost.registration.minor, currency),
          row.cost.sharePct,
        );
        if (duty.ok) dutyAndRegistration += duty.amount.minor;
        const capital = shareOfMoney(row.cost.capitalImprovements, row.cost.sharePct);
        if (capital.ok) capitalWork += capital.amount.minor;
      }
      if (row.value === null) unvalued += 1;
      else value += row.value.share.minor;

      if (row.loan !== null) {
        withLoan += 1;
        if (row.equity === null) equityGaps += 1;
        else equity += row.equity.minor;
      }
      // A property with no loan is its whole value in equity, and a valued one adds it.
      if (row.loan === null && row.value !== null) equity += row.value.share.minor;
    }

    return {
      currency,
      cost: money(cost, currency),
      dutyAndRegistration: money(dutyAndRegistration, currency),
      capitalWork: money(capitalWork, currency),
      value: money(value, currency),
      unvalued,
      equity: equityGaps === 0 ? money(equity, currency) : null,
      equityGaps,
      withLoan,
      count: rows.length,
    };
  });

  const ages = byProperty.flatMap((facts) => (facts.age === null ? [] : [facts.age]));
  const oldest = ages.length === 0 ? null : ages.reduce((a, b) => (b.months > a.months ? b : a));

  return { byProperty, totals, oldest, staleCount: ages.filter((age) => age.stale).length };
}
