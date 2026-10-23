import { describe, expect, it } from 'vitest';
import { heldText, shortDate, termWords } from './saleLine.ts';
import type { TaxLot } from './taxLots.ts';

describe('shortDate', () => {
  it('writes the day and the month, with no year', () => {
    expect(shortDate('2026-06-12')).toBe('12 Jun');
    expect(shortDate('2027-01-01')).toBe('1 Jan');
  });
});

describe('heldText', () => {
  it('counts days under a month, and says day for one', () => {
    expect(heldText('2026-06-01', '2026-06-21')).toBe('20 days');
    expect(heldText('2026-06-01', '2026-06-02')).toBe('1 day');
    expect(heldText('2026-06-01', '2026-06-01')).toBe('0 days');
  });

  it('counts whole months up to a year', () => {
    expect(heldText('2026-01-02', '2026-09-02')).toBe('8 mo');
    // A month is not complete until its day comes round.
    expect(heldText('2026-01-31', '2026-02-28')).toBe('28 days');
    expect(heldText('2026-01-15', '2026-12-14')).toBe('10 mo');
  });

  it('counts years and months from a year on, and drops a month count of nothing', () => {
    expect(heldText('2024-03-01', '2026-06-12')).toBe('2 yr 3 mo');
    expect(heldText('2025-06-12', '2026-06-12')).toBe('1 yr');
    expect(heldText('2025-06-13', '2026-06-12')).toBe('11 mo');
  });
});

/** The parts of a lot `termWords` reads. */
const lot = (assetClass: TaxLot['assetClass'], placement: TaxLot['placement']): TaxLot =>
  ({ assetClass, placement }) as unknown as TaxLot;

describe('termWords', () => {
  it('says the term for equity, and nothing about the class', () => {
    expect(termWords(lot('listed_equity', { placed: true, bucket: 'equity-long' } as TaxLot['placement']))).toBe('long term');
    expect(termWords(lot('equity_fund', { placed: true, bucket: 'equity-short' } as TaxLot['placement']))).toBe('short term');
  });

  it('names the class for gold and unlisted shares, and says a short-term gain is taxed at the slab', () => {
    expect(termWords(lot('gold', { placed: true, bucket: 'other-long' } as TaxLot['placement']))).toMatch(/ · long term$/);
    expect(termWords(lot('gold', { placed: true, bucket: 'other-short' } as TaxLot['placement']))).toMatch(
      / · short term · at your slab$/,
    );
  });

  it('gives no term for a sale the figures leave out', () => {
    expect(
      termWords(lot(null, { placed: false, reason: 'unclassified-asset' } as TaxLot['placement'])),
    ).toBeNull();
  });
});
