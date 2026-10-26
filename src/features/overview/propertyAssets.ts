/**
 * Property, put into the shapes net worth, the allocation and the history already read.
 *
 * Each property is a holding of the kind `property` for these calculations and nowhere else: its readings are its
 * valuations, and every figure is the household's share (docs/decisions.md, Property). So the totals, the
 * allocation and the history do not learn about property; they are handed more of what they already work from, and
 * keep every rule they have: never across currencies, a valuation at or before the day asked, an archived property
 * still part of the months before it was archived.
 *
 * What property does not go into is the reading-gaps card and the staleness of readings. A fund is owed a reading
 * every month and a property is valued when somebody values it; how old that is has its own rule, the household's
 * months, which the Property screen applies.
 *
 * Pure: the listing in, the shapes out. Nothing is read and the day is passed in.
 */

import { latestValuationOn, propertyCostBasis, shareOfMoney, valuationAge } from '../../domain/property.ts';
import type { HoldingInput, ValuationInput } from '../../domain/networth.ts';
import type { IsoDate } from '../../lib/dates.ts';
import type { Money } from '../../lib/money.ts';
import type { PropertyListing } from '../../repo/types.ts';

export interface PropertyAssets {
  /** One per property in view, archived ones too, of the kind `property`. */
  readonly holdings: readonly HoldingInput[];
  /** Each valuation as the household's share of it, dated as it was. */
  readonly valuations: readonly ValuationInput[];
  /** "Name · Member", for naming one where only its id is known. */
  readonly names: ReadonlyMap<string, string>;
  /** The share of each linked loan the household carries: that of the property it is linked to. */
  readonly loanShares: ReadonlyMap<string, string>;
  /** Every loan linked to a property that is still held. */
  readonly linkedLoanIds: ReadonlySet<string>;
  /**
   * The properties in view that the family lives in, and the loans linked to such a property. A home lived in is not
   * money that can be spent in retirement, so these are the ones the FIRE corpus leaves out, with the loan on them
   * (the owner's rule, 27 October 2026); a property that is not lived in is in the corpus like any other asset.
   */
  readonly livedIn: ReadonlySet<string>;
  readonly livedInLoanIds: ReadonlySet<string>;
  /** How many properties still held, not lived in, have never been valued: the ones the corpus is short of. */
  readonly unvaluedForCorpus: number;
  /** How many properties still held have never been valued, and so are in no total. */
  readonly unvalued: number;
  /** The same, by the currency of the property, for the per-currency totals. */
  readonly unvaluedByCurrency: ReadonlyMap<string, number>;
  /**
   * The properties still held whose latest valuation is older than the household's months, named, with how old. They
   * count in every total all the same, and carry the mark (docs/decisions.md, Property): this is what the Overview says.
   */
  readonly stale: readonly { readonly name: string; readonly months: number; readonly livedIn: boolean }[];
  /** The newest valuation in view on or before today, or null: the day a total with property in it is as at. */
  readonly newestValuation: IsoDate | null;
}

export function propertyAssets(
  listing: PropertyListing,
  options: { readonly scope: 'household' | 'mine'; readonly mine: string | null },
  today: IsoDate,
): PropertyAssets {
  const inView = listing.properties.filter(
    (property) => options.scope === 'household' || property.member.id === options.mine,
  );
  const shown = new Set(inView.map((property) => property.id));
  const shareOf = new Map(inView.map((property) => [property.id, property.sharePct]));

  const holdings: HoldingInput[] = inView.map((property) => {
    const worked = propertyCostBasis({
      purchaseCost: property.purchaseCost,
      stampDuty: property.stampDuty,
      registration: property.registration,
      improvements: listing.improvements
        .filter((work) => work.propertyId === property.id && !work.isVoided)
        .map((work) => ({ date: work.date, amount: work.amount, isCapital: work.isCapital })),
      sharePct: property.sharePct,
      asOf: today,
    });
    return {
      id: property.id,
      memberId: property.member.id,
      memberName: property.member.displayName,
      kind: 'property',
      currency: property.currency,
      // The cost basis, the household's share of it: what a gain is measured against.
      cost: worked.ok ? worked.share : null,
      isArchived: property.isArchived,
      // Owed a valuation from the day it was bought, as a holding is from the day it was opened.
      openedOn: property.purchaseDate,
      archivedOn: property.archivedOn,
      costIsShort: false,
    };
  });

  const valuations: ValuationInput[] = listing.valuations.flatMap((valuation) => {
    if (!shown.has(valuation.propertyId)) return [];
    // A valuation dated after today is not yet a reading: net worth is as at today.
    if (valuation.asOf > today) return [];
    const share = shareOfMoney(valuation.value, shareOf.get(valuation.propertyId) ?? '100');
    return share.ok ? [{ holdingId: valuation.propertyId, date: valuation.asOf, amount: share.amount }] : [];
  });

  const held = inView.filter((property) => !property.isArchived);
  // The share a loan is taken at belongs to the loan and not to the view: in a personal view a loan can be in view
  // while the part-owned property it is shared against is another member's, and must not be taken whole there.
  const loanShares = new Map<string, string>();
  for (const property of listing.properties.filter((entry) => !entry.isArchived)) {
    // One loan against two properties would be taken off twice; the first is the one it is taken at.
    if (property.linkedLiabilityId !== null && !loanShares.has(property.linkedLiabilityId)) {
      loanShares.set(property.linkedLiabilityId, property.sharePct);
    }
  }

  const livedIn = new Set(held.filter((property) => property.isSelfOccupied).map((property) => property.id));
  // The loan a lived-in property carries belongs to the property, so it is the same in a personal view as in the household's.
  const livedInLoanIds = new Set(
    listing.properties
      .filter((property) => !property.isArchived && property.isSelfOccupied && property.linkedLiabilityId !== null)
      .map((property) => property.linkedLiabilityId as string),
  );

  const valued = new Set(valuations.map((valuation) => valuation.holdingId));
  const unvaluedHeld = held.filter((property) => !valued.has(property.id));
  const unvaluedByCurrency = new Map<string, number>();
  for (const property of unvaluedHeld) {
    unvaluedByCurrency.set(property.currency, (unvaluedByCurrency.get(property.currency) ?? 0) + 1);
  }

  const stale = held.flatMap((property) => {
    const latest = latestValuationOn(
      valuations.filter((valuation) => valuation.holdingId === property.id).map((valuation) => ({ asOf: valuation.date })),
      today,
    );
    if (latest === null) return [];
    const age = valuationAge(latest.asOf, today, listing.staleMonths);
    return age.stale ? [{ name: property.label, months: age.months, livedIn: livedIn.has(property.id) }] : [];
  });

  const newestValuation = valuations.reduce<IsoDate | null>(
    (newest, valuation) => (newest === null || valuation.date > newest ? valuation.date : newest),
    null,
  );

  return {
    holdings,
    valuations,
    names: new Map(inView.map((property) => [property.id, `${property.label} · ${property.member.displayName}`])),
    loanShares,
    linkedLoanIds: new Set(loanShares.keys()),
    livedIn,
    livedInLoanIds,
    unvaluedForCorpus: unvaluedHeld.filter((property) => !livedIn.has(property.id)).length,
    unvalued: unvaluedHeld.length,
    unvaluedByCurrency,
    stale,
    newestValuation,
  };
}

/**
 * What the household owes on a loan: the whole of it, or its share where the loan is linked to a part-owned
 * property, because the household's share of the property carries the household's share of what is owed on it.
 */
export function debtAtShare(amount: Money, loanId: string | null, loanShares: ReadonlyMap<string, string>): Money {
  const share = loanId === null ? undefined : loanShares.get(loanId);
  if (share === undefined || share === '100') return amount;
  const taken = shareOfMoney(amount, share);
  return taken.ok ? taken.amount : amount;
}

/**
 * Which property the FIRE corpus holds. A home the family lives in is left out, and a property that is not lived in
 * counts like any other asset, at the household's share (the owner's rule, 27 October 2026). Returned as the same
 * holdings and valuations the totals take, split in two, so the corpus and the line that says what it leaves out are
 * made from one classification.
 */
export function splitForCorpus(assets: PropertyAssets): {
  readonly counted: { readonly holdings: readonly HoldingInput[]; readonly valuations: readonly ValuationInput[] };
  readonly leftOut: { readonly holdings: readonly HoldingInput[]; readonly valuations: readonly ValuationInput[] };
} {
  const lived = assets.livedIn;
  return {
    counted: {
      holdings: assets.holdings.filter((h) => !lived.has(h.id)),
      valuations: assets.valuations.filter((v) => !lived.has(v.holdingId)),
    },
    leftOut: {
      holdings: assets.holdings.filter((h) => lived.has(h.id)),
      valuations: assets.valuations.filter((v) => lived.has(v.holdingId)),
    },
  };
}
