/**
 * Parsing AMFI's daily NAV file.
 *
 * The parser lives in `supabase/functions/_shared/amfi.ts` so the edge
 * function and this file can both read it — the fetch cannot be tested
 * offline, but the parsing is where every edge case is, and an untested
 * parser is how rows start being skipped without anybody noticing.
 *
 * The sample below is copied from the real file, not imagined. The first
 * version of it WAS imagined: it had six fields where the vendor has eight,
 * and eleven tests passed against a parser that would have skipped all
 * fourteen thousand real rows and reported "no matching scheme" forever. A
 * sample that agrees with your assumptions tests nothing.
 */

import { describe, expect, it } from 'vitest';
import { parseAmfi } from '../../supabase/functions/_shared/amfi.ts';

const SAMPLE = [
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
  ' ',
  "Open Ended Schemes(Children's Fund - Childrens' Fund)",
  ' ',
  'Axis Mutual Fund',
  "135762;INF846K01WO1;-;Axis Children's Fund;Direct Plan;Growth Option;30.0313;09-Sep-2026",
  "135765;INF846K01WP8;INF846K01WQ6;Axis Children's Fund;Direct Plan;IDCW Option;27.6642;09-Sep-2026",
  ' ',
  'HDFC Mutual Fund',
  '101234;INF179K01YV8;-;HDFC Index Fund;Regular Plan;Growth Option;789.0123;09-Sep-2026',
  ' ',
].join('\n');

describe('parseAmfi', () => {
  it('reads a scheme line and gives back an ISO date', () => {
    const quotes = parseAmfi(SAMPLE);
    const first = quotes.find((quote) => quote.externalId === 'INF846K01WO1');

    expect(first).toBeDefined();
    expect(first?.value).toBe('30.0313');
    // "09-Sep-2026" is nobody's standard, and a date reparsed downstream is
    // one that eventually gets reparsed wrongly.
    expect(first?.asOf).toBe('2026-09-09');
  });

  it('records both ISINs against the same NAV', () => {
    // A scheme has separate identifiers for its payout and reinvestment plans
    // and a holding can be either, so a match on one must not miss the other.
    const quotes = parseAmfi(SAMPLE);

    expect(quotes.filter((quote) => quote.externalId === 'INF846K01WP8')).toHaveLength(1);
    expect(quotes.filter((quote) => quote.externalId === 'INF846K01WQ6')).toHaveLength(1);
  });

  it('treats a dash as no identifier rather than as one', () => {
    const quotes = parseAmfi(SAMPLE);

    expect(quotes.some((quote) => quote.externalId === '-')).toBe(false);
    expect(quotes.filter((quote) => quote.externalId === 'INF846K01WO1')).toHaveLength(1);
  });

  it('skips the header, the blank lines, the categories and the fund houses', () => {
    // Three schemes, four identifiers between them, and nothing else.
    expect(parseAmfi(SAMPLE)).toHaveLength(4);
  });

  it('keeps every decimal the file gives', () => {
    // A NAV rounded to paise carries its rounding into every valuation
    // computed from it, multiplied by the units held.
    const quotes = parseAmfi(SAMPLE);

    expect(quotes.find((q) => q.externalId === 'INF179K01YV8')?.value).toBe('789.0123');
    expect(quotes.find((q) => q.externalId === 'INF846K01WP8')?.value).toBe('27.6642');
  });

  it('keeps the NAV as a string, never a number', () => {
    // The column is numeric(20,6) precisely so the precision survives; parsing
    // it into a double here would discard what the column was chosen to keep.
    for (const quote of parseAmfi(SAMPLE)) {
      expect(typeof quote.value).toBe('string');
    }
  });

  it('refuses a six-field line, which is the shape the parser first assumed', () => {
    // The vendor has Plan and Option columns between the name and the NAV. A
    // parser that ignored them read "Direct Plan" as the price and skipped
    // every row in the file — silently, and for as long as nobody checked.
    // A shorter line now means the format has changed, and a changed format
    // must not be parsed on the assumption that it has not.
    const sixFields = '119556;INF209K01Z96;-;Some Fund;12.34;09-Sep-2026';

    expect(parseAmfi(sixFields)).toHaveLength(0);
  });

  it('skips a line whose NAV is not a number rather than writing NaN', () => {
    // AMFI prints "N.A." for a scheme with no NAV that day. It is not zero.
    const withNa = '119553;INF209K01Z99;-;Some Fund;Direct Plan;Growth Option;N.A.;09-Sep-2026';

    expect(parseAmfi(withNa)).toHaveLength(0);
  });

  it('skips a line whose date it cannot read', () => {
    const badDate = '119554;INF209K01Z98;-;Some Fund;Direct Plan;Growth Option;12.34;2026-09-08';

    expect(parseAmfi(badDate)).toHaveLength(0);
  });

  it('skips a month it does not recognise, rather than defaulting to January', () => {
    const badMonth = '119555;INF209K01Z97;-;Some Fund;Direct Plan;Growth Option;12.34;08-Xyz-2026';

    expect(parseAmfi(badMonth)).toHaveLength(0);
  });

  it('survives the file arriving with Windows line endings', () => {
    // The vendor's file has been served both ways, and a trailing \r would
    // otherwise land inside the year: "2026\r".
    const crlf = SAMPLE.split('\n').join('\r\n');

    expect(parseAmfi(crlf).find((q) => q.externalId === 'INF846K01WO1')?.asOf).toBe('2026-09-09');
  });

  it('returns nothing for an empty file rather than throwing', () => {
    expect(parseAmfi('')).toEqual([]);
  });
});
