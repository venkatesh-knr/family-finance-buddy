/**
 * Reading a consolidated account statement.
 *
 * An eCAS from CAMS or KFintech is the household's full mutual-fund history
 * across every AMC, and it is how `lot` and `disposal` get filled in bulk
 * rather than one purchase at a time: "every SIP instalment is a lot, so a
 * household three years into a monthly SIP has a hundred-odd rows nobody will
 * ever type" (docs/build-plan.md, stage 5).
 *
 * ── what this module is, and what it deliberately is not ────────────────
 *
 * It is pure. Lines of text in, transactions out — no PDF, no crypto, no
 * clock. The file is opened and decrypted by an adapter, because a password
 * and a byte stream are I/O; the hash of each line is taken outside, because
 * hashing is asynchronous in a browser and this is arithmetic. What is left
 * here is the part that is worth testing with fixtures and the part most
 * likely to be subtly wrong.
 *
 * It never writes anything. Matching a scheme to an instrument, a folio to a
 * holding, and deciding what to create belongs to the import flow, with a
 * person looking at it — "let every row be changed before anything is
 * written".
 *
 * ── two rules it must not break ─────────────────────────────────────────
 *
 * A magnitude is a magnitude. `parseAmountToMinor` and `parseQuantity` both
 * refuse a negative, deliberately, and this module does not work around them:
 * a redemption printed as (4,000.00) is four thousand rupees going out, and
 * the direction rides in its own field. A negative cost is not a fact about
 * money, it is a fact about which way the money went.
 *
 * A line that does not parse is reported. A statement where nine rows in ten
 * arrive silently is worse than one that fails outright, because the cost
 * basis it leaves behind looks plausible and is short.
 *
 * ── and one honest caveat ───────────────────────────────────────────────
 *
 * "Statement parsers break when an issuer changes their layout. That is true
 * in every language and on every runtime — it is the hardest single component
 * in this app" (§894). This one is written from the published shape of the two
 * registrars' statements and is expected to meet lines it has not seen. That
 * is why `unread` exists and why nothing here guesses.
 */

import { parseAmountToMinor } from '../lib/money.ts';
import { parseQuantity } from '../lib/quantity.ts';

/**
 * Who produced the file. They print the same facts differently.
 *
 * Two documents, not one. A registrar's eCAS (CAMS, KFintech) is the full
 * mutual-fund transaction history across AMCs. A depository CAS (CDSL, NSDL)
 * is a month's statement for demat holdings and mutual fund folios together,
 * and its mutual-fund rows carry the same facts in a different order.
 */
export type Registrar = 'cams' | 'kfintech' | 'cdsl' | 'nsdl' | 'unknown';

/**
 * How a transaction row is laid out, which follows from who issued it.
 *
 *   registrar   Date · Description · Amount · Units · Price · Unit Balance,
 *               with the description on the same line as the figures.
 *
 *   depository  Date · Reference · Amount · NAV · Price · Units · Stamp Duty ·
 *               Distribution · Withdrawal, with the description printed on the
 *               line above and the row beginning with an instalment and ARN
 *               reference that is not a number.
 *
 * The difference is not cosmetic: read a depository row by taking the last
 * four figures — which is right for a registrar — and the units become the
 * amount and the stamp duty becomes the units.
 */
type Layout = 'registrar' | 'depository';

/**
 * What a line does to a position.
 *
 * `charge` is stamp duty, STT or a transaction fee: money that left without
 * buying or selling units. `unknown` is a line that parsed as a transaction
 * and whose description matches nothing — kept, flagged, and left for a person.
 */
export type EcasTxnKind =
  | 'purchase'
  | 'redemption'
  | 'switch_in'
  | 'switch_out'
  | 'dividend_reinvest'
  | 'dividend_payout'
  | 'charge'
  | 'unknown';

/** Which way the money went. Never encoded as the sign of an amount. */
export type Direction = 'in' | 'out';

export interface EcasTransaction {
  /** ISO date, from the statement's own `05-Apr-2024`. */
  readonly date: string;
  /** The description exactly as printed, which is part of the line's identity. */
  readonly description: string;
  readonly kind: EcasTxnKind;
  readonly direction: Direction;
  /** Paise. Always positive — see the note above. */
  readonly amountMinor: bigint;
  /**
   * Stamp duty and the like, printed as their own lines and belonging to this
   * one.
   *
   * `lot.cost_minor` is the cost of acquisition all in — "brokerage, STT and
   * stamp duty belong in here rather than in a column of their own: they are
   * part of the cost of acquisition for the purpose that matters, and
   * splitting them out invites a cost basis that forgets to add them back".
   * A statement prints them as separate rows, so they are put back together
   * here, and the cost a lot records is `amountMinor + chargesMinor`.
   */
  readonly chargesMinor: bigint;
  /**
   * True on a charge that has been folded into the purchase it belongs to.
   *
   * Kept in the list rather than removed, because the preview shows what the
   * statement said and then what became of each line — and a row that quietly
   * vanished between the file and the table is the kind of thing that makes
   * somebody stop trusting an importer.
   */
  readonly absorbed: boolean;
  /** Scaled to eight places, like every quantity. Zero for a payout or a charge. */
  readonly units: bigint;
  /** As printed, commas removed. Not money and never summed, so it stays text. */
  readonly nav: string | null;
  readonly balanceUnits: bigint | null;
  /**
   * What this line is, as a string to be hashed into `lot.source_hash`.
   *
   * It carries the full folio, which is why hashing happens before anything is
   * stored: the hash goes in a column, the folio never does.
   *
   * It also carries the line's position within its folio, and that is not
   * padding. Two SIP instalments can fall on one day for the same amount and
   * the same units — a top-up beside the monthly instalment — and on date,
   * amount and description alone those two lines are identical. Hashed that
   * way the second would be refused as a re-import, and the cost basis would
   * be short by one instalment for as long as the household held the fund.
   */
  readonly identity: string;
}

export interface EcasFolio {
  readonly amc: string;
  /** The whole folio, in memory only. Never returned for storage. */
  readonly folio: string;
  /** What may be stored: "account identifiers keep last four digits only". */
  readonly folioLast4: string;
  readonly scheme: string;
  readonly isin: string | null;
  readonly transactions: readonly EcasTransaction[];
  /** The closing balance the statement states, which is a check, not a total. */
  readonly closingUnits: bigint | null;
}

export interface UnreadLine {
  readonly line: string;
  readonly folio: string | null;
}

export interface EcasStatement {
  readonly registrar: Registrar;
  readonly period: { readonly from: string; readonly to: string } | null;
  readonly folios: readonly EcasFolio[];
  /** Lines that began like a transaction and did not parse. Never dropped. */
  readonly unread: readonly UnreadLine[];
}

const MONTHS: Readonly<Record<string, string>> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Two date forms, because the registrars and the depositories disagree.
 *
 * A CAMS or KFintech statement prints `05-Apr-2024`. A CDSL depository CAS
 * prints `01-11-2022`, and a parser that knew only the first read a real file
 * as having no transactions at all — every row was there and every row began
 * with a date it did not recognise.
 *
 * The numeric form is read day-first. Every document this parser is pointed at
 * is issued in India, where that is the convention, and both the depositories
 * and the registrars follow it. It is worth stating out loud: on the twelfth of
 * November the two readings differ silently, and a wrong date is a wrong
 * holding period and eventually a wrong tax rate.
 */
const DATE_AT_START = /^(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{4})\b/;
const DATE_ANYWHERE = /(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{4})/g;
const ISIN = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;
const FOLIO_LINE = /^folio\s*no\.?\s*:?\s*(.+)$/i;

/**
 * The folio itself, off the front of what follows "Folio No:".
 *
 * A real statement prints more on that line than the number — "Mode of
 * Holding: Single", a PAN, a KYC flag — and taking the rest of the line whole
 * ended with a folio whose last four characters were "ngle".
 */
const FOLIO_TOKEN = /^([0-9][0-9A-Za-z]*(?:\s*[/-]\s*[0-9A-Za-z]+)*)/;

/**
 * Lines that sit where a scheme name sits and are not one.
 *
 * "No Transaction during the period" is printed in place of the table for a
 * folio that was quiet, and it became the scheme name of three holdings on the
 * first real statement this parser met.
 */
const NOT_A_SCHEME =
  /^(no transaction|opening|closing|date\b|nav on|registrar|isin\b|pan\b|kyc|nominee|mode of holding|folio|email|address|statement|consolidated|page\b|total\b|market value|income capital)/i;
const REGISTRAR_LINE = /registrar\s*:?\s*(cams|kfintech|karvy)/i;
const DEPOSITORY_LINE = /central depository services|national securities depository/i;

// "Closing Unit Balance" on a registrar's statement, "Closing Balance" on a
// depository's.
const CLOSING_LINE = /closing\s+(unit\s+)?balance/i;
const OPENING_LINE = /opening\s+(unit\s+)?balance/i;

/** The line that introduces a table of transactions, on either layout. */
const TABLE_HEADER = /^date\b.*transaction|^isin\b.*security/i;

/**
 * An AMC, rather than a scheme.
 *
 * Anchored at the end, because "ICICI Prudential Mutual Fund" is a fund house
 * and "ICICI Prudential Bluechip Fund - Growth" is a scheme, and the first
 * four words do not tell them apart.
 */
const AMC_LINE = /(mutual fund|asset management(\s+company)?|amc)\s*$/i;

/**
 * Where a scheme's own name starts, on a registrar's statement.
 *
 * The lines between a folio and its transactions are, in order: the investor's
 * name, the scheme, the nominees, the opening balance. Taking "the first
 * plausible line after the folio" made the investor's name the name of the
 * instrument — wrong, and a person's name written into a table that did not
 * ask for one.
 *
 * Every scheme line begins with the registrar's own code for it — `P1191-`,
 * `PP001ZG-`, `108ETD2G-` — so the name can be cut from there, which drops
 * whatever preceded it.
 */
const SCHEME_CODE = /(?:^|\s)([A-Z0-9]{3,10}-)(?=[A-Za-z])/;

/** Where the block of lines between a folio and its figures ends. */
const SCHEME_BLOCK_END =
  /^(nominee|opening\s+(unit\s+)?balance|closing\s+(unit\s+)?balance|\*\*\*\s*no transaction|date\b)/i;

/** A page header like "01-Apr-2026 To 11-Sep-2026": a period, not a transaction. */
const PERIOD_ONLY =
  /^(\d{1,2}[-/](?:[A-Za-z]{3}|\d{1,2})[-/]\d{4})\s+to\s+(\d{1,2}[-/](?:[A-Za-z]{3}|\d{1,2})[-/]\d{4})$/i;

/** "Closing Unit Balance: 4,013.730 NAV on …" — the figure that follows the words. */
const CLOSING_UNITS = /closing\s+(?:unit\s+)?balance\s*:?\s*([\d,]+(?:\.\d+)?)/i;

/**
 * A figure as a statement prints one: 5,000.00 · (4,000.00) · -10.000 · .15
 *
 * That last one is a real stamp duty from a real statement. The earlier
 * pattern required a digit before the decimal point, so `.15` was not a number
 * to it — which silently shifted every column on the row that carried one.
 */
const NUMBER = /^\(?[-+]?(?:\d[\d,]*)?(?:\.\d+)?\)?$/;

function isNumber(token: string): boolean {
  return NUMBER.test(token) && /\d/.test(token);
}

function toIsoDate(day: string, month: string, year: string): string | null {
  const named = MONTHS[month.toLowerCase()];

  if (named === undefined) {
    // The numeric form. Rejected rather than clamped when it is not a month:
    // a statement that prints 13 where a month belongs is one this parser has
    // misread, and reading it as January would bury that.
    const numeric = Number(month);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 12) return null;

    const asDay = Number(day);
    if (!Number.isInteger(asDay) || asDay < 1 || asDay > 31) return null;

    return `${year}-${String(numeric).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return `${year}-${named}-${day.padStart(2, '0')}`;
}

/** Strips brackets, sign and grouping, and says which of the two it found. */
function magnitude(token: string): { text: string; negative: boolean } {
  const negative = token.startsWith('(') || token.startsWith('-');
  const stripped = token.replace(/[(),+-]/g, '');
  // `.15` is how a statement writes fifteen paise, and both the money and the
  // quantity parser require a digit before the point.
  const text = stripped.startsWith('.') ? `0${stripped}` : stripped;
  return { text, negative };
}

function classify(description: string): EcasTxnKind {
  const text = description.toLowerCase();

  // Charges first: a stamp duty line mentions neither buying nor selling, and
  // every other test below would miss it rather than mis-file it.
  if (
    /stamp duty|\bstt\b|transaction charge|\btds\b|tax deducted|\bgst\b|maintenance/.test(text)
  ) {
    return 'charge';
  }
  // Before purchase and redemption, both of which appear inside these phrases.
  if (/switch[\s-]*out|transfer[\s-]*out/.test(text)) return 'switch_out';
  if (/switch[\s-]*in|transfer[\s-]*in/.test(text)) return 'switch_in';
  if (/redemption|redeem|repurchase/.test(text)) return 'redemption';
  // Reinvestment before payout: "IDCW Reinvestment" buys units, "IDCW Payout"
  // sends money, and both say dividend.
  if (/reinvest/.test(text)) return 'dividend_reinvest';
  if (/dividend|idcw|payout/.test(text)) return 'dividend_payout';
  if (/purchase|investment|\bsip\b|systematic|allot|subscription/.test(text)) return 'purchase';

  return 'unknown';
}

function directionOf(kind: EcasTxnKind, negative: boolean): Direction {
  if (negative) return 'out';
  switch (kind) {
    case 'purchase':
    case 'switch_in':
    case 'dividend_reinvest':
      return 'in';
    case 'redemption':
    case 'switch_out':
    case 'dividend_payout':
    case 'charge':
      return 'out';
    default:
      return 'in';
  }
}

/**
 * The scheme, without the registrar's furniture.
 *
 * A scheme line carries a scheme code, the name, an advisor code and the
 * registrar. Only the name identifies the fund to a person, and the rest
 * varies between statements for the same holding — so it would make two
 * instruments out of one.
 */
function cleanScheme(line: string): string {
  return line
    .replace(/\(advisor[^)]*\)/gi, '')
    .replace(/registrar\s*:?\s*(cams|kfintech|karvy)?/gi, '')
    .replace(/\((non[\s-]*)?demat\)/gi, '')
    .replace(ISIN, '')
    .replace(/\bisin\s*:?/gi, '')
    // The scheme code a statement prints in front of the name: "HDFC0001-",
    // "1191 - ", "LFRAG - ". Four characters at least, so a fund house that is
    // genuinely part of the name — "UTI - Infrastructure Fund" — keeps it.
    .replace(/^[A-Z0-9]{4,10}\s*-\s*/, '')
    .replace(/\s{2,}/g, ' ')
    // What removing the furniture leaves behind: "- Growth -", "Plan - -
    // Reinvest". Punctuation that separated something from nothing.
    .replace(/\s*-\s*-\s*/g, ' - ')
    .replace(/^[\s\-–—,:;]+|[\s\-–—,:;]+$/g, '')
    .trim();
}

/** Digits and letters only, so "10422158 / 45" ends in 5845. */
function lastFour(folio: string): string {
  const compact = folio.replace(/[^0-9A-Za-z]/g, '');
  return compact.slice(-4);
}

/**
 * Settle the scheme from the lines between a folio and its figures.
 *
 * They arrive as: the investor's name, the scheme (wrapped over one or two
 * lines), the nominees. Cutting at the registrar's scheme code drops the name
 * — which is the point, and not only for tidiness. The ISIN is taken from the
 * whole block, because a wrapped line can carry the name and the ISIN apart.
 */
function finishScheme(current: Building, block: readonly string[]): void {
  const joined = block.join(' ').replace(/\s+/g, ' ').trim();
  if (joined === '') return;

  const isin = ISIN.exec(joined);
  if (current.isin === null && isin) current.isin = isin[1] ?? null;

  const code = SCHEME_CODE.exec(joined);

  if (code?.index !== undefined && code[0] !== undefined && code[1] !== undefined) {
    const startsAt = code.index + (code[0].length - code[1].length);
    current.scheme = cleanScheme(joined.slice(startsAt));
    return;
  }

  // No code. The line that names a fund is the one that says so.
  const named = block.find((line) => /\b(fund|plan|scheme|etf|index)\b/i.test(line));
  if (named !== undefined) current.scheme = cleanScheme(named);
}

/**
 * Stamp each line with what it is, so the same line is recognised next time.
 *
 * The ordinal at the end counts how many otherwise-identical lines came before
 * this one in the same folio — not the line's position in the file, which was
 * the first shape of this and was wrong in a way that only shows up on the
 * second import.
 *
 * A CAS is requested for a period, and the periods overlap: April to September
 * this time, January to September next. The same instalment is the first line
 * of one file and the seventh of the other, so a position-based identity makes
 * it two different lines — and the unique index, seeing two different hashes,
 * lets both in. A doubled instalment is a doubled cost basis and a wrong
 * capital gain years later, which is the exact failure this is here to stop.
 *
 * Counting identical lines instead is stable however much of the history a
 * file happens to cover, and still separates the case it was written for: two
 * instalments on one day, for the same amount, into the same fund.
 */
/**
 * Put a purchase and its stamp duty back together.
 *
 * A statement prints them as two rows on the same day — "SIP Purchase …
 * 4,999.75" and "*** Stamp Duty *** 0.25" — and the second is part of what the
 * first cost. Dropping it understates the cost basis by a few paise an
 * instalment, which is small and is still the figure a capital gain is
 * computed from.
 *
 * Matched within a folio, on the date, to the nearest purchase — the one above
 * it by preference, which is how both layouts print the pair. A charge with no
 * purchase to belong to stays as it is and is reported rather than guessed at:
 * an annual maintenance fee is not part of anything's cost.
 */
function absorbCharges(transactions: readonly Omit<EcasTransaction, 'identity'>[]) {
  const rows = transactions.map((txn) => ({ ...txn }));

  const buys = (kind: EcasTxnKind) =>
    kind === 'purchase' || kind === 'switch_in' || kind === 'dividend_reinvest';

  rows.forEach((row, at) => {
    if (row.kind !== 'charge' || row.absorbed) return;

    let found = -1;
    for (let back = at - 1; back >= 0; back -= 1) {
      const candidate = rows[back];
      if (candidate !== undefined && candidate.date === row.date && buys(candidate.kind)) {
        found = back;
        break;
      }
    }
    if (found === -1) {
      for (let ahead = at + 1; ahead < rows.length; ahead += 1) {
        const candidate = rows[ahead];
        if (candidate !== undefined && candidate.date === row.date && buys(candidate.kind)) {
          found = ahead;
          break;
        }
      }
    }

    const target = found === -1 ? undefined : rows[found];
    if (target === undefined) return;

    target.chargesMinor += row.amountMinor;
    row.absorbed = true;
  });

  return rows;
}

function identify(folio: Building, registrar: Registrar): EcasTransaction[] {
  const seen = new Map<string, number>();

  // The identity is the line's own text and does not include the charge folded
  // into it: a statement re-read after this change must still recognise the
  // purchases it already recorded.
  return absorbCharges(folio.transactions).map((txn) => {
    const line = [
      registrar,
      folio.folio,
      folio.isin ?? folio.scheme,
      txn.date,
      txn.description,
      `${txn.direction}${txn.amountMinor.toString()}`,
      txn.units.toString(),
    ].join('|');

    const before = seen.get(line) ?? 0;
    seen.set(line, before + 1);

    return { ...txn, identity: `${line}|#${String(before)}` };
  });
}

interface Building {
  amc: string;
  folio: string;
  scheme: string;
  isin: string | null;
  closingUnits: bigint | null;
  transactions: Omit<EcasTransaction, 'identity'>[];
}

/**
 * Read a statement's text.
 *
 * `lines` is the file in reading order, one entry per printed row — what an
 * adapter produces by grouping a PDF's positioned text items by line.
 */
export function parseEcas(lines: readonly string[]): EcasStatement {
  const folios: Building[] = [];
  const unread: UnreadLine[] = [];

  let registrar: Registrar = 'unknown';
  let layout: Layout = 'registrar';
  let period: { from: string; to: string } | null = null;
  let current: Building | null = null;
  let previous = '';
  // A registrar prints the scheme after the folio; a depository prints it
  // before. So plausible scheme lines are remembered as they go past, and the
  // folio line takes the most recent one — falling back to waiting for the
  // next, which is where a registrar puts it.
  let awaitingScheme = false;
  let candidates: { at: number; text: string }[] = [];
  // The lines between a folio and its first figure, on a registrar's layout.
  let schemeBlock: string[] | null = null;
  // An AMC is printed once above several folios, so it is remembered rather
  // than looked for immediately above each one.
  let lastAmc = '';
  // Counts printed lines, so "the two lines above this folio" means what it
  // says whatever blank space the PDF had in between.
  let at = 0;

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line === '') continue;
    at += 1;

    if (registrar === 'unknown') {
      const found = REGISTRAR_LINE.exec(line);
      if (found) {
        // Karvy is KFintech's former name and still appears on older files.
        registrar = found[1]?.toLowerCase() === 'cams' ? 'cams' : 'kfintech';
      } else if (DEPOSITORY_LINE.test(line)) {
        registrar = /national securities/i.test(line) ? 'nsdl' : 'cdsl';
        layout = 'depository';
      }
    }

    if (period === null && /\bfrom\b/i.test(line) && /\bto\b/i.test(line)) {
      const dates = [...line.matchAll(DATE_ANYWHERE)];
      if (dates.length >= 2) {
        const from = toIsoDate(dates[0]?.[1] ?? '', dates[0]?.[2] ?? '', dates[0]?.[3] ?? '');
        const to = toIsoDate(dates[1]?.[1] ?? '', dates[1]?.[2] ?? '', dates[1]?.[3] ?? '');
        if (from !== null && to !== null) period = { from, to };
      }
    }

    const folioMatch = FOLIO_LINE.exec(line);
    if (folioMatch) {
      // The folio number itself and nothing else on the line: a PAN, a KYC
      // flag and "Mode of Holding: Single" all follow it on a real statement,
      // and they are identifiers or noise, neither of which belongs here.
      const after = (folioMatch[1] ?? '').trim();
      const folio = (FOLIO_TOKEN.exec(after)?.[1] ?? after.split(' ')[0] ?? '').trim();

      // Only the two or three lines immediately above, so a scheme name is
      // never borrowed from a different folio further up the page.
      const near = candidates.filter((c) => at - c.at <= 3).map((c) => c.text).reverse();
      const schemeAbove = near.find((text) => !AMC_LINE.test(text));
      const amcAbove = near.find((text) => AMC_LINE.test(text));

      // Only a depository prints the scheme above the folio. On a registrar's
      // statement the lines above are the previous fund's exit-load paragraph,
      // and reading one as a name produced holdings called "kindly update them
      // immediately."
      const above = layout === 'depository' ? schemeAbove : undefined;

      current = {
        amc: amcAbove ?? lastAmc,
        folio,
        scheme: above === undefined ? '' : cleanScheme(above),
        isin: above === undefined ? null : (ISIN.exec(above)?.[1] ?? null),
        closingUnits: null,
        transactions: [],
      };
      folios.push(current);
      // A registrar prints it after; a depository has already printed it.
      awaitingScheme = current.scheme === '';
      schemeBlock = awaitingScheme ? [] : null;
      candidates = [];
      previous = line;
      continue;
    }

    if (current !== null) {
      // The scheme block runs from the folio to the first of the nominees, the
      // balances, or the figures themselves.
      if (schemeBlock !== null) {
        if (SCHEME_BLOCK_END.test(line) || DATE_AT_START.test(line)) {
          finishScheme(current, schemeBlock);
          schemeBlock = null;
          awaitingScheme = false;
        } else if (!PERIOD_ONLY.test(line)) {
          // Six lines is generous for a wrapped scheme name and short enough
          // that a missing terminator cannot swallow a page.
          if (schemeBlock.length < 6) schemeBlock.push(line);
          previous = line;
          continue;
        }
      }

      const isin = /isin/i.test(line) ? ISIN.exec(line) : null;
      if (isin && current.isin === null) current.isin = isin[1] ?? null;

      if (CLOSING_LINE.test(line)) {
        // The figure that follows the words, not the last one on the line: a
        // registrar prints "Closing Unit Balance: 4,013.730 NAV on …: INR
        // 105.66 … Market Value …: INR 424,090.71", and the last number there
        // is what the holding is worth, not how much of it there is.
        const stated = CLOSING_UNITS.exec(line)?.[1];
        const last = stated ?? line.split(' ').filter(isNumber).at(-1);
        if (last !== undefined) {
          try {
            current.closingUnits = parseQuantity(magnitude(last).text);
          } catch {
            // A closing balance that will not parse is not worth failing an
            // import over: it is a check on the figures, not one of them.
          }
        }
        previous = line;
        continue;
      }

      if (OPENING_LINE.test(line)) {
        previous = line;
        continue;
      }
    }

    // "01-Apr-2026 To 11-Sep-2026" heads every page of a registrar's
    // statement. It begins with a date and is not a transaction, and it was
    // the whole of the "could not be read" list on the first real eCAS.
    const periodOnly = PERIOD_ONLY.exec(line);
    if (periodOnly) {
      if (period === null) {
        const dates = [...line.matchAll(DATE_ANYWHERE)];
        const from = toIsoDate(dates[0]?.[1] ?? '', dates[0]?.[2] ?? '', dates[0]?.[3] ?? '');
        const to = toIsoDate(dates[1]?.[1] ?? '', dates[1]?.[2] ?? '', dates[1]?.[3] ?? '');
        if (from !== null && to !== null) period = { from, to };
      }
      previous = line;
      continue;
    }

    const dated = DATE_AT_START.exec(line);

    if (dated === null) {
      if (AMC_LINE.test(line)) lastAmc = line;

      // Could this be the name of a fund? Not a header, not a balance, not a
      // bare identifier, and with enough letters in it to be a name.
      const plausible =
        !NOT_A_SCHEME.test(line) &&
        !TABLE_HEADER.test(line) &&
        /[A-Za-z]{3}/.test(line) &&
        line.length >= 6;

      // Scheme lines belonging to a folio are collected by the block above;
      // what is gathered here is what sits *before* the next folio, which is
      // where a depository prints the name.
      if (plausible) {
        candidates.push({ at, text: line });
        if (candidates.length > 4) candidates.shift();
      }

      previous = line;
      continue;
    }

    // The line above, before it is overwritten: a depository prints the
    // description of a transaction there and the figures here.
    const above = previous;
    previous = line;

    const date = toIsoDate(dated[1] ?? '', dated[2] ?? '', dated[3] ?? '');
    if (date === null) {
      unread.push({ line, folio: current?.folio ?? null });
      continue;
    }

    const tokens = line.slice(dated[0].length).trim().split(' ').filter((t) => t !== '');
    const numbers: string[] = [];
    let description: string;

    if (layout === 'depository') {
      // Left to right from the first figure. The row begins with an instalment
      // number and an ARN — "42/62 - ARN-0020/E236466" — which are not figures,
      // and the description itself is printed on the line above.
      const firstFigure = tokens.findIndex((token) => isNumber(token));
      const reference = (firstFigure === -1 ? tokens : tokens.slice(0, firstFigure)).join(' ');

      if (firstFigure !== -1) {
        for (const token of tokens.slice(firstFigure)) {
          if (isNumber(token)) numbers.push(token);
        }
      }

      const spoken = NOT_A_SCHEME.test(above) || TABLE_HEADER.test(above) ? '' : above;
      description = [spoken, reference].filter((part) => part.trim() !== '').join(' ').trim();
    } else {
      // Read off the right-hand end. Which columns a line carries varies — a
      // purchase prints four, a stamp duty one — so the count is discovered
      // rather than assumed.
      while (tokens.length > 0 && numbers.length < 4 && isNumber(tokens[tokens.length - 1] ?? '')) {
        numbers.unshift(tokens.pop() ?? '');
      }
      description = tokens.join(' ').trim();
    }

    if (numbers.length === 0 || description === '') {
      unread.push({ line, folio: current?.folio ?? null });
      continue;
    }

    // The same four facts, in the order each issuer prints them.
    //
    //   registrar   amount · units · price · unit balance
    //   depository  amount · NAV · price · units · stamp duty · payouts
    const amountToken = numbers[0] ?? '';
    const unitsToken = layout === 'depository' ? numbers[3] : numbers[1];
    const navToken = layout === 'depository' ? numbers[1] : numbers[2];
    const balanceToken = layout === 'depository' ? undefined : numbers[3];

    const amount = magnitude(amountToken);
    const units = unitsToken === undefined ? null : magnitude(unitsToken);

    let amountMinor: bigint;
    let unitsScaled: bigint;
    let balanceUnits: bigint | null = null;
    try {
      amountMinor = parseAmountToMinor(amount.text, 'INR');
      unitsScaled = units === null ? 0n : parseQuantity(units.text);
      if (balanceToken !== undefined) {
        balanceUnits = parseQuantity(magnitude(balanceToken).text);
      }
    } catch {
      // A figure the money or quantity parser refuses is exactly the sort of
      // line that must not be guessed at.
      unread.push({ line, folio: current?.folio ?? null });
      continue;
    }

    const kind = classify(description);
    const negative = amount.negative || (units?.negative ?? false);

    const transaction = {
      date,
      description,
      kind,
      direction: directionOf(kind, negative),
      amountMinor,
      chargesMinor: 0n,
      absorbed: false,
      units: unitsScaled,
      nav: navToken === undefined ? null : magnitude(navToken).text,
      balanceUnits,
    };

    if (current === null) {
      unread.push({ line, folio: null });
      continue;
    }

    current.transactions.push(transaction);
  }

  // Identity last, so every line in the file is stamped with the registrar the
  // file turned out to be from rather than the one known at the time.
  return {
    registrar,
    period,
    unread,
    folios: folios.map((folio) => ({
      amc: folio.amc,
      folio: folio.folio,
      folioLast4: lastFour(folio.folio),
      scheme: folio.scheme,
      isin: folio.isin,
      closingUnits: folio.closingUnits,
      transactions: identify(folio, registrar),
    })),
  };
}
