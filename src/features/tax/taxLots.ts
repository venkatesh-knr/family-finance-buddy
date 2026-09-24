/**
 * One member's sales for one tax year, laid out for the Tax screen.
 *
 * Tax is filed per person and the ₹1.25 lakh allowance is each person's own, so
 * the unit is a member, never the household. Netting a household once would
 * hand two people one allowance between them, or take one person's loss off
 * another's gain — wrong in opposite directions, and neither would look wrong.
 *
 * Every sale in the year is listed, including the ones the netter will not
 * place. A foreign holding, a matured gold bond or an unclassified fund is shown
 * with the reason it is not in the figure, because a sale that quietly vanishes
 * from a tax page because the arithmetic cannot handle it yet is the failure this
 * screen exists to avoid.
 *
 * Where a sale goes is `placeParcel`'s decision, the same one the netter makes,
 * so "placed" on the page means exactly what it means in the arithmetic. This
 * file decides nothing about tax; it only arranges.
 *
 * Pure: the rows go in, a layout comes out.
 */

import { taxYearBounds } from '../../domain/budget.ts';
import { placeParcel, type Placement } from '../../domain/capital-gains.ts';
import type { Parcel } from '../../domain/lots.ts';
import type { AssetClass, Term, TaxRule } from '../../domain/tax-rules.ts';

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

export interface TaxLot {
  readonly parcel: Parcel;
  readonly holdingName: string;
  readonly assetClass: AssetClass | null;
  /** Null exactly where no term can honestly be given. */
  readonly term: Term | null;
  readonly placement: Placement;
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
  /** The kind of each disposal by id. Missing means an ordinary sale. */
  readonly disposalKindOf: ReadonlyMap<string, string>;
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

      const placement = placeParcel({
        parcel,
        assetClass: instrument.taxAssetClass,
        disposalKind: options.disposalKindOf.get(parcel.disposalId) ?? null,
        rules: options.rules,
      });

      lots.push({
        parcel,
        holdingName: instrument.name,
        assetClass: instrument.taxAssetClass,
        term: placement.term,
        placement,
      });
    }
  }

  // Newest sale first. The disposal id breaks a tie so the order is the same
  // on every render — a list that reshuffles two same-day sales is a list
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
