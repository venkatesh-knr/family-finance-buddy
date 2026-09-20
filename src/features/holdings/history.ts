/**
 * Saying, in words, that a position's purchases do not add up to its statement.
 *
 * One sentence, built from the arithmetic, so that the marker on the figure
 * names the numbers rather than gesturing at a problem: "cover 280.479 of the
 * 4,013.730 units" is something a person can check against the file, and "some
 * history may be missing" is not.
 *
 * Kept out of the screens because three of them say it — the holding's cost,
 * the portfolio return, and Overview's allocation — and a sentence written
 * three times is three sentences that drift.
 */

import type { Disposal, Lot } from '../../domain/lots.ts';
import { historyOf, isQualified, type History, type StatedBalance } from '../../domain/position.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatQuantity, parseQuantity } from '../../lib/quantity.ts';
import type { Holding, HoldingListing } from '../../repo/types.ts';

/**
 * A holding's purchases, sales and statement, as the domain takes them.
 *
 * The repository hands out decimal strings; the arithmetic takes scaled
 * bigints. This is the one place that crossing happens for a position, so the
 * holdings screen and Overview cannot read the same rows two ways.
 */
export function positionInputs(
  listing: HoldingListing,
  holding: Holding,
): {
  readonly lots: readonly Lot[];
  readonly disposals: readonly Disposal[];
  readonly stated: StatedBalance | null;
} {
  return {
    lots: listing.lots
      .filter((lot) => lot.holdingId === holding.id)
      .map((lot) => ({
        id: lot.id,
        instrumentId: holding.instrument.id,
        acquiredOn: lot.acquiredOn,
        quantity: parseQuantity(lot.quantity),
        cost: lot.cost,
      })),
    disposals: listing.disposals
      .filter((sale) => sale.holdingId === holding.id)
      .map((sale) => ({
        id: sale.id,
        instrumentId: holding.instrument.id,
        disposedOn: sale.disposedOn,
        quantity: parseQuantity(sale.quantity),
        proceeds: sale.proceeds,
      })),
    stated:
      holding.stated === null
        ? null
        : { units: parseQuantity(holding.stated.quantity), asOf: holding.stated.asOf },
  };
}

/** Whether this holding's purchases account for its statement's closing balance. */
export function historyForHolding(listing: HoldingListing, holding: Holding): History {
  return historyOf(positionInputs(listing, holding));
}

/**
 * Units as a registrar prints them: grouped, and at least three decimals.
 *
 * Built from the digits rather than through a number, because a quantity is
 * scaled to eight places and a double is not to be trusted with them.
 */
export function unitsText(scaled: bigint): string {
  const [whole = '0', fraction = ''] = formatQuantity(scaled).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = new Intl.NumberFormat('en-IN').format(BigInt(whole.replace('-', '')));
  return `${sign}${grouped}.${fraction.padEnd(3, '0')}`;
}

/** The arithmetic, or null when there is nothing to say. */
export function historySentence(history: History): string | null {
  if (!isQualified(history) || history.kind === 'unstated' || history.kind === 'complete') {
    return null;
  }

  const on = formatIsoDate(history.asOf);

  return history.kind === 'short'
    ? `The recorded purchases cover ${unitsText(history.lotUnits)} of the ${unitsText(history.statedUnits)} units the statement reported on ${on}.`
    : `The recorded purchases add up to ${unitsText(history.lotUnits)} units, more than the ${unitsText(history.statedUnits)} the statement reported on ${on}.`;
}

/** "One position rests on" / "3 positions rest on", for the sentence that follows. */
export function shortPositions(count: number): string {
  return count === 1 ? 'One position rests on' : `${String(count)} positions rest on`;
}

/**
 * Why a return is not shown, said once.
 *
 * The same reason for a position and for a total that contains one, so it is a
 * single text with the part that differs handed in.
 */
export const RETURN_REFUSED_BECAUSE =
  'A gain measured against a cost that covers only part of the units would be a number that never happened.';
