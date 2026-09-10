/**
 * Turning a price into what a holding is worth.
 *
 * Two steps, both of which have a wrong answer that looks right: picking which
 * price applies, and multiplying it by the units held. Written before the
 * implementation, as anything numeric is.
 */

import { describe, expect, it } from 'vitest';
import { parseQuantity as q } from '../lib/quantity.ts';
import { priceOn, valueOf, type Price } from './pricing.ts';

const prices: readonly Price[] = [
  {
    source: 'amfi',
    externalId: 'INF209K01Z15',
    asOf: '2026-09-07',
    value: '122.1000',
    currency: 'INR',
    fetchedAt: '2026-09-08T00:30:00Z',
  },
  {
    source: 'amfi',
    externalId: 'INF209K01Z15',
    asOf: '2026-09-08',
    value: '123.4567',
    currency: 'INR',
    fetchedAt: '2026-09-09T00:30:00Z',
  },
  // The same day, fetched later: a revised NAV.
  {
    source: 'amfi',
    externalId: 'INF209K01Z15',
    asOf: '2026-09-08',
    value: '123.9999',
    currency: 'INR',
    fetchedAt: '2026-09-10T00:30:00Z',
  },
  {
    source: 'amfi',
    externalId: 'INF179K01YV8',
    asOf: '2026-09-08',
    value: '789.0123',
    currency: 'INR',
    fetchedAt: '2026-09-09T00:30:00Z',
  },
];

describe('priceOn', () => {
  it('takes the latest price on or before the date', () => {
    expect(priceOn(prices, 'amfi', 'INF209K01Z15', '2026-09-08')?.value).toBe('123.9999');
  });

  it('never reaches forward for a later one', () => {
    // The same rule as an exchange rate: valuing 7 September at the 8th's NAV
    // would move a figure somebody may already have relied on.
    expect(priceOn(prices, 'amfi', 'INF209K01Z15', '2026-09-07')?.value).toBe('122.1000');
  });

  it('prefers the most recent fetch for a date, so a revision wins', () => {
    // Two rows for 8 September; the later fetch is the corrected figure, and
    // the superseded one stays in the table rather than being overwritten.
    const chosen = priceOn(prices, 'amfi', 'INF209K01Z15', '2026-09-09');

    expect(chosen?.value).toBe('123.9999');
    expect(chosen?.asOf).toBe('2026-09-08');
  });

  it('keeps instruments apart', () => {
    expect(priceOn(prices, 'amfi', 'INF179K01YV8', '2026-09-08')?.value).toBe('789.0123');
  });

  it('is null before any price exists, rather than the earliest one', () => {
    expect(priceOn(prices, 'amfi', 'INF209K01Z15', '2026-01-01')).toBeNull();
  });

  it('is null for an instrument nothing has priced', () => {
    expect(priceOn(prices, 'amfi', 'INF000000000', '2026-09-08')).toBeNull();
  });

  it('keeps sources apart, since two can disagree about one instrument', () => {
    expect(priceOn(prices, 'gold', 'INF209K01Z15', '2026-09-08')).toBeNull();
  });
});

describe('valueOf', () => {
  it('multiplies units by the price into minor units', () => {
    // 10 units at ₹123.4567 is ₹1,234.567, which is 123456.7 paise — and
    // rounds to 123457.
    expect(valueOf(q('10'), '123.4567', 'INR').minor).toBe(123457n);
  });

  it('is exact on a whole answer', () => {
    expect(valueOf(q('100'), '50', 'INR').minor).toBe(500000n);
  });

  it('handles a fractional holding, which is why quantity has eight places', () => {
    // 12.5 units at $789.0123 is $9,862.653750 → 986265 cents.
    expect(valueOf(q('12.5'), '789.0123', 'USD').minor).toBe(986265n);
  });

  it('keeps the whole NAV rather than rounding it first', () => {
    // Rounding 123.4567 to paise first, then multiplying by 10,000 units,
    // loses ₹67. The multiplication happens on the full figure and rounds once
    // at the end.
    expect(valueOf(q('10000'), '123.4567', 'INR').minor).toBe(123456700n);
  });

  it('rounds half away from zero, once, at the end', () => {
    // 1 unit at 0.005 is half a paise. Away from zero, so it never rounds
    // toward the house across a portfolio.
    expect(valueOf(q('1'), '0.005', 'INR').minor).toBe(1n);
  });

  it('is zero for a closed position rather than throwing', () => {
    expect(valueOf(q('0'), '123.4567', 'INR').minor).toBe(0n);
  });

  it('carries the currency it was given', () => {
    expect(valueOf(q('1'), '100', 'USD').currency).toBe('USD');
  });

  it('works for a currency with no minor unit', () => {
    // 3 units at ¥1234.5 is ¥3703.5, and the yen has no subunit: 3704.
    expect(valueOf(q('3'), '1234.5', 'JPY').minor).toBe(3704n);
  });

  it('handles a very large position without losing paise to a double', () => {
    // A crore of units. This is the figure a float would quietly round.
    expect(valueOf(q('10000000'), '123.4567', 'INR').minor).toBe(123456700000n);
  });
});
