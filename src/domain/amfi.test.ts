/**
 * Parsing AMFI's daily NAV file.
 *
 * The parser lives in `supabase/functions/_shared/amfi.ts` so the edge
 * function and this file can both read it — the fetch cannot be tested
 * offline, but the parsing is where every edge case is, and an untested
 * parser is how rows start being skipped without anybody noticing.
 *
 * The sample below is the real file's shape: a header, fund-house names as
 * bare interleaved text, a category line, schemes with two ISINs and schemes
 * with one, and a date format that is nobody's standard.
 */

import { describe, expect, it } from 'vitest';
import { parseAmfi } from '../../supabase/functions/_shared/amfi.ts';

const SAMPLE = [
  'Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
  '',
  'Open Ended Schemes(Debt Scheme - Banking and PSU Fund)',
  '',
  'Aditya Birla Sun Life Mutual Fund',
  '119551;INF209K01Z15;INF209K01Z23;Aditya Birla Sun Life Banking & PSU Debt Fund;123.4567;08-Sep-2026',
  '119552;INF209K01AB1;-;Aditya Birla Sun Life Something Direct;99.1;08-Sep-2026',
  '',
  'HDFC Mutual Fund',
  '101234;INF179K01YV8;INF179K01YW6;HDFC Index Fund;789.0123;08-Sep-2026',
  '',
].join('\n');

describe('parseAmfi', () => {
  it('reads a scheme line and gives back an ISO date', () => {
    const quotes = parseAmfi(SAMPLE);
    const first = quotes.find((quote) => quote.externalId === 'INF209K01Z15');

    expect(first).toBeDefined();
    expect(first?.value).toBe('123.4567');
    // "08-Sep-2026" is nobody's standard, and a date reparsed downstream is
    // one that eventually gets reparsed wrongly.
    expect(first?.asOf).toBe('2026-09-08');
  });

  it('records both ISINs against the same NAV', () => {
    // A scheme has separate identifiers for its payout and reinvestment plans
    // and a holding can be either, so a match on one must not miss the other.
    const quotes = parseAmfi(SAMPLE);

    expect(quotes.filter((quote) => quote.externalId === 'INF209K01Z15')).toHaveLength(1);
    expect(quotes.filter((quote) => quote.externalId === 'INF209K01Z23')).toHaveLength(1);
  });

  it('treats a dash as no identifier rather than as one', () => {
    const quotes = parseAmfi(SAMPLE);

    expect(quotes.some((quote) => quote.externalId === '-')).toBe(false);
    expect(quotes.filter((quote) => quote.externalId === 'INF209K01AB1')).toHaveLength(1);
  });

  it('skips the header, the blank lines, the categories and the fund houses', () => {
    // Three schemes, five identifiers between them, and nothing else.
    expect(parseAmfi(SAMPLE)).toHaveLength(5);
  });

  it('keeps every decimal the file gives', () => {
    // A NAV rounded to paise carries its rounding into every valuation
    // computed from it, multiplied by the units held.
    const quotes = parseAmfi(SAMPLE);

    expect(quotes.find((q) => q.externalId === 'INF179K01YV8')?.value).toBe('789.0123');
    expect(quotes.find((q) => q.externalId === 'INF209K01AB1')?.value).toBe('99.1');
  });

  it('keeps the NAV as a string, never a number', () => {
    // The column is numeric(20,6) precisely so the precision survives; parsing
    // it into a double here would discard what the column was chosen to keep.
    for (const quote of parseAmfi(SAMPLE)) {
      expect(typeof quote.value).toBe('string');
    }
  });

  it('skips a line whose NAV is not a number rather than writing NaN', () => {
    // AMFI prints "N.A." for a scheme with no NAV that day. It is not zero.
    const withNa = '119553;INF209K01Z99;-;Some Fund;N.A.;08-Sep-2026';

    expect(parseAmfi(withNa)).toHaveLength(0);
  });

  it('skips a line whose date it cannot read', () => {
    const badDate = '119554;INF209K01Z98;-;Some Fund;12.34;2026-09-08';

    expect(parseAmfi(badDate)).toHaveLength(0);
  });

  it('skips a month it does not recognise, rather than defaulting to January', () => {
    const badMonth = '119555;INF209K01Z97;-;Some Fund;12.34;08-Xyz-2026';

    expect(parseAmfi(badMonth)).toHaveLength(0);
  });

  it('survives the file arriving with Windows line endings', () => {
    // The vendor's file has been served both ways, and a trailing \r would
    // otherwise land inside the year: "2026\r".
    const crlf = SAMPLE.split('\n').join('\r\n');

    expect(parseAmfi(crlf).find((q) => q.externalId === 'INF209K01Z15')?.asOf).toBe('2026-09-08');
  });

  it('returns nothing for an empty file rather than throwing', () => {
    expect(parseAmfi('')).toEqual([]);
  });
});
