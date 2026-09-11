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

/** Which registrar produced the file. They print the same facts differently. */
export type Registrar = 'cams' | 'kfintech' | 'unknown';

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
const CLOSING_LINE = /closing\s+unit\s+balance/i;
const OPENING_LINE = /opening\s+unit\s+balance/i;

/** A figure as a statement prints one: 5,000.00 · (4,000.00) · -10.000 */
const NUMBER = /^\(?[-+]?[\d,]+(?:\.\d+)?\)?$/;

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
  const text = token.replace(/[(),+-]/g, '');
  return { text, negative };
}

function classify(description: string): EcasTxnKind {
  const text = description.toLowerCase();

  // Charges first: a stamp duty line mentions neither buying nor selling, and
  // every other test below would miss it rather than mis-file it.
  if (/stamp duty|\bstt\b|transaction charge|\btds\b|tax deducted|\bgst\b/.test(text)) {
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
    .replace(/registrar\s*:?\s*\w+/gi, '')
    .replace(ISIN, '')
    .replace(/\bisin\s*:?/gi, '')
    .replace(/^[A-Z0-9]{2,10}-/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Digits and letters only, so "10422158 / 45" ends in 5845. */
function lastFour(folio: string): string {
  const compact = folio.replace(/[^0-9A-Za-z]/g, '');
  return compact.slice(-4);
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
  let period: { from: string; to: string } | null = null;
  let current: Building | null = null;
  let previous = '';
  // The first non-empty line after a folio that is not an ISIN or a header is
  // the scheme. Tracked rather than assumed adjacent, because the two
  // registrars order those lines differently.
  let awaitingScheme = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line === '') continue;

    if (registrar === 'unknown') {
      const found = REGISTRAR_LINE.exec(line);
      if (found) {
        // Karvy is KFintech's former name and still appears on older files.
        registrar = found[1]?.toLowerCase() === 'cams' ? 'cams' : 'kfintech';
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

      current = {
        // An AMC name sits above the folio on both layouts.
        amc: /mutual fund|asset management|fund house|amc\b/i.test(previous) ? previous : '',
        folio,
        scheme: '',
        isin: null,
        closingUnits: null,
        transactions: [],
      };
      folios.push(current);
      awaitingScheme = true;
      previous = line;
      continue;
    }

    if (current !== null) {
      const isin = /isin/i.test(line) ? ISIN.exec(line) : null;
      if (isin && current.isin === null) current.isin = isin[1] ?? null;

      if (CLOSING_LINE.test(line)) {
        const last = line.split(' ').filter(isNumber).at(-1);
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

    const dated = DATE_AT_START.exec(line);

    if (dated === null) {
      if (awaitingScheme && current !== null && current.scheme === '') {
        const bare = ISIN.exec(line);
        if (/^isin/i.test(line) || (bare && line.replace(bare[0], '').trim() === '')) {
          if (current.isin === null && bare) current.isin = bare[1] ?? null;
        } else if (!NOT_A_SCHEME.test(line)) {
          current.scheme = cleanScheme(line);
          const inScheme = ISIN.exec(line);
          if (current.isin === null && inScheme) current.isin = inScheme[1] ?? null;
          awaitingScheme = false;
        }
      }
      previous = line;
      continue;
    }

    previous = line;

    const date = toIsoDate(dated[1] ?? '', dated[2] ?? '', dated[3] ?? '');
    if (date === null) {
      unread.push({ line, folio: current?.folio ?? null });
      continue;
    }

    // Read the figures off the right-hand end. Which columns a line carries
    // varies — a purchase prints four, a stamp duty one — so the count is
    // discovered rather than assumed.
    const tokens = line.slice(dated[0].length).trim().split(' ').filter((t) => t !== '');
    const numbers: string[] = [];
    while (tokens.length > 0 && numbers.length < 4 && isNumber(tokens[tokens.length - 1] ?? '')) {
      numbers.unshift(tokens.pop() ?? '');
    }

    const description = tokens.join(' ').trim();

    if (numbers.length === 0 || description === '') {
      unread.push({ line, folio: current?.folio ?? null });
      continue;
    }

    const amountToken = numbers[0] ?? '';
    const unitsToken = numbers.length >= 2 ? numbers[1] : undefined;
    const navToken = numbers.length >= 3 ? numbers[2] : undefined;
    const balanceToken = numbers.length >= 4 ? numbers[3] : undefined;

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
      transactions: folio.transactions.map((txn, index) => ({
        ...txn,
        identity: [
          registrar,
          folio.folio,
          folio.isin ?? folio.scheme,
          txn.date,
          txn.description,
          `${txn.direction}${txn.amountMinor.toString()}`,
          txn.units.toString(),
          `#${String(index)}`,
        ].join('|'),
      })),
    })),
  };
}
