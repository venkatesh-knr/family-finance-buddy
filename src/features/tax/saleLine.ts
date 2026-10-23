/**
 * The words under a sale on the Tax screen: when it was sold, how long it was held, and which term that makes it.
 *
 * Pure text from calendar dates. The term itself is `placeParcel`'s decision, made on the rule in force on the day
 * of the sale, and is passed in on the lot; nothing here decides what is long and what is short.
 */

import { daysBetween, formatShortDate } from '../../lib/dates.ts';
import { taxClassLabel } from '../../ui/labels.ts';
import type { TaxLot } from './taxLots.ts';

/**
 * A calendar date without its year, as "12 Jun". The tax year is chosen beside it and April to December and January
 * to March fall in different calendar years of it, so the year would say nothing the screen does not already.
 */
export function shortDate(isoDate: string): string {
  return formatShortDate(isoDate);
}

/** How long it was held, in whole months once it is a month or more: "20 days", "8 mo", "2 yr 3 mo". */
export function heldText(acquiredOn: string, disposedOn: string): string {
  const [fromYear, fromMonth, fromDay] = acquiredOn.split('-').map(Number);
  const [toYear, toMonth, toDay] = disposedOn.split('-').map(Number);
  if (
    fromYear === undefined ||
    fromMonth === undefined ||
    fromDay === undefined ||
    toYear === undefined ||
    toMonth === undefined ||
    toDay === undefined
  ) {
    return '';
  }

  let months = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  if (toDay < fromDay) months -= 1;

  if (months < 1) {
    const days = daysBetween(acquiredOn, disposedOn);
    return `${String(days)} ${days === 1 ? 'day' : 'days'}`;
  }
  if (months < 12) return `${String(months)} mo`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${String(years)} yr` : `${String(years)} yr ${String(rest)} mo`;
}

/**
 * The term, for a sale that is in the figures: "long term", or "short term", with the class named where it is not
 * equity and "at your slab" where a short-term gain is taxed that way. Null for a sale the figures leave out, which
 * says why instead.
 */
export function termWords(lot: TaxLot): string | null {
  if (!lot.placement.placed) return null;
  const label = lot.assetClass === null ? '' : taxClassLabel(lot.assetClass).toLowerCase();
  switch (lot.placement.bucket) {
    case 'equity-long':
      return 'long term';
    case 'equity-short':
      return 'short term';
    case 'other-long':
      return `${label} · long term`;
    case 'other-short':
      return `${label} · short term · at your slab`;
  }
}
