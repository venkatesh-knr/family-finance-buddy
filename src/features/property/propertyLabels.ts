import type { PropertyKind, ValuationBasis } from '../../repo/types.ts';

export const KIND_LABEL: Record<PropertyKind, string> = {
  land: 'Land',
  plot: 'Plot',
  apartment: 'Apartment',
  house: 'House',
  commercial: 'Commercial',
};

/** How a valuation was arrived at, as a person would say it. */
export const BASIS_LABEL: Record<ValuationBasis, string> = {
  own_estimate: 'Your own estimate',
  circle_rate: 'Circle rate calculation',
  broker: 'A broker’s view',
  registered: 'A registered valuation',
};

/** "March 2019": when it was bought, to the month, which is all the cost basis needs said. */
export function monthYear(iso: string): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${months[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`;
}

/** "17 months", "1 month", "under a month": how old a valuation is. */
export function monthsPhrase(months: number): string {
  if (months < 1) return 'under a month';
  return `${String(months)} ${months === 1 ? 'month' : 'months'}`;
}
