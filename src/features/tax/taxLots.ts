/**
 * One member's sales for one tax year, laid out for the Tax screen.
 *
 * Tax is filed per person and the ₹1.25 lakh allowance is each person's own, so
 * the unit is a member, never the household. Netting a household once would
 * hand two people one allowance between them, or take one person's loss off
 * another's gain — wrong in opposite directions, and neither would look wrong.
 *
 * Every sale in the year is listed, including the ones the equity netter does
 * not touch. A gold sale or an unclassified fund is shown with the reason it
 * is not in the figure, because a sale that quietly vanishes from a tax page
 * because this slice cannot yet net it is the failure this screen exists to
 * avoid.
 *
 * Pure: the rows go in, a layout comes out.
 */

import { taxYearBounds } from '../../domain/budget.ts';
import type { Parcel } from '../../domain/lots.ts';
import { isEquityClass } from '../../domain/capital-gains.ts';
import { classify, type AssetClass, type Term, type TaxRule } from '../../domain/tax-rules.ts';

/**
 * The part of a holding row this needs, and no more.
 *
 * Structural rather than `HoldingRow`, so this is tested with a dozen fields
 * rather than the whole of what the Holdings screen carries.
 */
export interface TaxHolding {
  readonly holding: {
    readonly member: { readonly id: string };
    readonly instrument: {
      readonly id: string;
      readonly name: string;
      readonly taxAssetClass: AssetClass | null;
    };
  };
  readonly parcels: readonly Parcel[];
}

/**
 * Where a sale ends up.
 *
 *   netted            equity, classified, in rupees — in the figures above
 *   other-class       a class this slice does not net (gold, foreign equity, …)
 *   unclassified      the instrument's tax asset class has not been set
 *   no-rule           no rule covers the sale's date, so no term can be said
 *   currency-mismatch equity in a currency other than rupees, which is a data problem
 */
export type Treatment =
  | 'netted'
  | 'other-class'
  | 'unclassified'
  | 'no-rule'
  | 'currency-mismatch';

export interface TaxLot {
  readonly parcel: Parcel;
  readonly holdingName: string;
  readonly assetClass: AssetClass | null;
  /** Null exactly where no term can honestly be given. */
  readonly term: Term | null;
  readonly treatment: Treatment;
}

export interface TaxLots {
  /** Sales in the year, newest first. */
  readonly lots: readonly TaxLot[];
  /** Every parcel of the member's, not only this year's — the netter scopes by year itself. */
  readonly parcels: readonly Parcel[];
  /** Every instrument the member holds, by id. Null is unclassified. */
  readonly assetClassOf: ReadonlyMap<string, AssetClass | null>;
}

export function taxLotsFor(options: {
  readonly rows: readonly TaxHolding[];
  readonly memberId: string;
  readonly fy: number;
  readonly rules: readonly TaxRule[];
}): TaxLots {
  const window = taxYearBounds(options.fy);
  const mine = options.rows.filter((row) => row.holding.member.id === options.memberId);

  const assetClassOf = new Map<string, AssetClass | null>();
  const parcels: Parcel[] = [];
  const lots: TaxLot[] = [];

  for (const row of mine) {
    const { instrument } = row.holding;
    assetClassOf.set(instrument.id, instrument.taxAssetClass);

    for (const parcel of row.parcels) {
      parcels.push(parcel);
      if (parcel.disposedOn < window.start || parcel.disposedOn > window.end) continue;

      const assetClass = instrument.taxAssetClass;
      const classification = classify(options.rules, {
        assetClass,
        acquiredOn: parcel.acquiredOn,
        disposedOn: parcel.disposedOn,
      });
      const term = classification.known ? classification.term : null;

      let treatment: Treatment;
      if (assetClass === null) treatment = 'unclassified';
      else if (!isEquityClass(assetClass)) treatment = 'other-class';
      else if (parcel.gain.currency !== 'INR') treatment = 'currency-mismatch';
      else if (!classification.known) treatment = 'no-rule';
      else treatment = 'netted';

      lots.push({ parcel, holdingName: instrument.name, assetClass, term, treatment });
    }
  }

  // Newest sale first. The disposal id breaks a tie so the order is the same
  // on every render — a table that reshuffles two same-day sales is a table
  // somebody stops trusting.
  lots.sort((a, b) =>
    a.parcel.disposedOn === b.parcel.disposedOn
      ? a.parcel.disposalId < b.parcel.disposalId
        ? 1
        : -1
      : a.parcel.disposedOn < b.parcel.disposedOn
        ? 1
        : -1,
  );

  return { lots, parcels, assetClassOf };
}
