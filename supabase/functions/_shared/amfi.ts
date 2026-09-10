/**
 * Parsing AMFI's daily NAV file.
 *
 * Separated from the driver so it can be tested without a network. The fetch
 * is the part that cannot be exercised offline; the parsing is the part with
 * every edge case in it — interleaved fund-house names, a header line, schemes
 * with one ISIN and schemes with two, and a date format that is nobody's
 * standard. Leaving it inside the edge function would have made all of that
 * untestable, which is how a parser quietly starts skipping rows.
 *
 * No imports, on purpose: Deno reads this file directly and so does vitest.
 */

export interface Quote {
  readonly externalId: string;
  readonly value: string;
  readonly asOf: string;
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * Parse AMFI's NAVAll.txt.
 *
 * A header line, then scheme lines, with fund-house names and category
 * headings interleaved as bare text. Anything that is not a scheme line is
 * skipped rather than guessed at. Eight fields:
 *
 *   Scheme Code;ISIN Payout/Growth;ISIN Reinvestment;Scheme Name;Plan;Option;NAV;Date
 *
 * The Plan and Option columns are the reason this is written against the real
 * file and not a reasonable guess at it. A first version assumed six fields,
 * read "Direct Plan" as the NAV and "Growth Option" as the date, and skipped
 * every one of the fourteen thousand rows — reporting "no matching scheme"
 * forever, with nothing on any screen to say why. Hence the field count is
 * checked and the positions are named.
 *
 * Two identifiers per row, because a scheme has separate ISINs for its payout
 * and reinvestment plans and a holding can be either. Both are recorded
 * against the same NAV, so an instrument matches on whichever it was given.
 *
 * The date arrives as "08-Sep-2026" and leaves as an ISO date. A date that has
 * to be reparsed downstream is one that will eventually be reparsed wrongly.
 *
 * Exported so it can be tested without a network: the parsing is the part with
 * edge cases, and the fetching is the part that cannot be tested offline.
 */
export function parseAmfi(text: string): readonly Quote[] {
  const quotes: Quote[] = [];

  for (const line of text.split('\n')) {
    const parts = line.split(';');
    // Exactly eight. A shorter line is a heading, a blank, or a format that
    // has changed — and a format that has changed must not be parsed on the
    // assumption it has not.
    if (parts.length !== 8) continue;

    const trimmed = parts.map((part) => part.trim());
    const payoutIsin = trimmed[1] ?? '';
    const reinvestIsin = trimmed[2] ?? '';
    const nav = trimmed[6] ?? '';
    const date = trimmed[7] ?? '';

    // The header line and any stray text fail this and are skipped.
    if (!/^\d+(\.\d+)?$/.test(nav)) continue;

    const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(date);
    if (match === null) continue;
    const month = MONTHS[match[2] ?? ''];
    if (month === undefined) continue;
    const asOf = `${match[3] ?? ''}-${month}-${match[1] ?? ''}`;

    for (const isin of [payoutIsin, reinvestIsin]) {
      // "-" is AMFI's way of saying a plan has no ISIN.
      if (isin === '' || isin === '-') continue;
      quotes.push({ externalId: isin, value: nav, asOf });
    }
  }

  return quotes;
}
