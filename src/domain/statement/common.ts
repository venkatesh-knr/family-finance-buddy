/**
 * What every statement parser shares (docs/design/spending-capture.md section 4; docs/build-plan.md step 7).
 *
 * Pure: text in, values out; nothing here reads a file, a database or a clock. Amounts are exact minor units and never pass through a double; dates are IST calendar days;
 * an account is known by its last four digits and nothing more of its number (CLAUDE.md); and a UPI narration gives up a payee's *name*, a 12-digit reference and a note,
 * and never the payee's VPA, which is often a phone number (section 4).
 */

import type { IsoDate } from '../../lib/dates.ts';

/** One line of a statement, as every parser returns it. Money is a positive figure and `direction` says which way it went. */
export interface StatementLine {
  readonly date: IsoDate;
  readonly valueDate: IsoDate | null;
  /** From the account's point of view: a `debit` is money out of a bank account, or a charge on a card. */
  readonly direction: 'debit' | 'credit';
  readonly amountMinor: bigint;
  /** What the bank printed, wrapped lines joined with a space. Used to recognise the line again (its hash); never shown as a payee and never stored with a VPA in it. */
  readonly raw: string;
  /** A readable name for who was paid or who paid, or null where the line does not say. */
  readonly payee: string | null;
  /** A 12-digit UPI reference, or null. */
  readonly upiReference: string | null;
  /** The bank's own reference or cheque number, or null. */
  readonly reference: string | null;
  /** The balance after the line, where the statement prints one. */
  readonly balanceMinor: bigint | null;
  /** What the statement itself says about the kind of spend (a merchant category, or the note on a UPI payment), or null. It is a hint for a suggestion and never a category. */
  readonly hint: string | null;
}

export type StatementKind = 'hdfc_delimited' | 'hdfc_text' | 'qif' | 'icici_savings_pdf' | 'icici_card_pdf' | 'axis_card_pdf' | 'gpay_pdf';

export interface ParsedStatement {
  readonly kind: StatementKind;
  /** `bank` for a savings or current account, `card` for a credit card: a card's balance is what is due. */
  readonly accountType: 'bank' | 'card';
  /** The last four digits of the account or card the statement is for, or null where it does not say. */
  readonly last4: string | null;
  readonly periodStart: IsoDate | null;
  readonly periodEnd: IsoDate | null;
  readonly lines: readonly StatementLine[];
  /** What could not be read, by line, in words. A line that could not be read is never dropped silently. */
  readonly problems: readonly string[];
}

// ── amounts ─────────────────────────────────────────────────────────────────────────────────────────────────────

const INDIAN_GROUPING = /^\d{1,3}(,\d{2})*,\d{3}(\.\d+)?$/;
const WESTERN_GROUPING = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN = /^\d+(\.\d+)?$/;

/**
 * A printed figure as exact minor units of a currency with two decimals, or null. Padding, a rupee sign (or the backtick some PDFs draw it as) and grouping commas are
 * taken off; the grouping must be a real one. A sign is refused: a statement's direction is a column or a letter, never a minus on a figure this reads.
 */
export function parseAmount(text: string): bigint | null {
  const stripped = text.replace(/[\s ]/g, '').replace(/[`₹]/g, '').replace(/^Rs\.?/i, '');
  if (stripped === '') return null;
  const grouped = stripped.includes(',');
  if (grouped ? !(INDIAN_GROUPING.test(stripped) || WESTERN_GROUPING.test(stripped)) : !PLAIN.test(stripped)) return null;
  const [whole = '', fraction = ''] = stripped.replace(/,/g, '').split('.');
  if (fraction.length > 2) return null;
  return BigInt(whole + fraction.padEnd(2, '0'));
}

// ── dates ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type DateStyle = 'dmy' | 'mdy' | 'dMonY' | 'MonDY';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function onTheCalendar(year: number, month: number, day: number): IsoDate | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const fullYear = (text: string): number => (text.length === 2 ? 2000 + Number(text) : Number(text));

/** A printed date as an IST calendar day, or null when it is not one. A two digit year is this century. */
export function parseDate(text: string, style: DateStyle): IsoDate | null {
  const value = text.trim();
  if (style === 'dmy' || style === 'mdy') {
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(value);
    if (match === null) return null;
    const [, a = '', b = '', y = ''] = match;
    return style === 'dmy' ? onTheCalendar(fullYear(y), Number(b), Number(a)) : onTheCalendar(fullYear(y), Number(a), Number(b));
  }
  if (style === 'dMonY') {
    const match = /^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/.exec(value);
    if (match === null) return null;
    const month = MONTHS.indexOf((match[2] ?? '').slice(0, 3).toLowerCase()) + 1;
    return month === 0 ? null : onTheCalendar(Number(match[3]), month, Number(match[1]));
  }
  const match = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  if (match === null) return null;
  const month = MONTHS.indexOf((match[1] ?? '').slice(0, 3).toLowerCase()) + 1;
  return month === 0 ? null : onTheCalendar(Number(match[3]), month, Number(match[2]));
}

// ── accounts ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The last four digits of an account or card number as a statement prints it, masked or not; null when the last run of digits is shorter than four. */
export function last4Of(text: string): string | null {
  const runs = text.match(/\d+/g);
  const last = runs === null ? undefined : runs[runs.length - 1];
  return last !== undefined && last.length >= 4 ? last.slice(-4) : null;
}

// ── UPI narrations ──────────────────────────────────────────────────────────────────────────────────────────────

export interface UpiNarration {
  readonly payee: string;
  /** The 12-digit UPI reference, or null when what is printed is not one. */
  readonly reference: string | null;
  readonly note: string | null;
}

const reference12 = (text: string | undefined): string | null => (text !== undefined && /^\d{12}$/.test(text) ? text : null);
const orNull = (text: string | undefined): string | null => (text === undefined || text.trim() === '' ? null : text.trim());

/**
 * The parts of a UPI payment's narration: who was paid, the reference and the note. HDFC writes `UPI-name-vpa-bank-reference-note`; ICICI writes `UPI/name/vpa/note/bank/
 * reference/id`. The VPA is read to find the rest and is not returned. Anything else is null, which is not a UPI payment.
 */
export function upiNarration(narration: string): UpiNarration | null {
  const text = narration.replace(/\s+/g, ' ').trim();
  if (text.startsWith('UPI/')) {
    const parts = text.split('/');
    const payee = orNull(parts[1]);
    if (payee === null) return null;
    const reference = parts.slice(3).map((part) => reference12(part.trim())).find((found) => found !== null) ?? null;
    return { payee, reference, note: orNull(parts[3]) };
  }
  const hdfc = /^UPI-(.+?)-(\S*@[A-Za-z0-9.]+)-([A-Za-z0-9]+)-(\d+)-?(.*)$/.exec(text);
  if (hdfc !== null) {
    const payee = orNull(hdfc[1]);
    if (payee === null) return null;
    return { payee, reference: reference12(hdfc[4]), note: orNull(hdfc[5]) };
  }
  return null;
}

/** What a narration says about a line, for matching and for a suggestion: the payee's name, a UPI reference, and the note a person typed on a UPI payment. */
export function describeNarration(narration: string): { readonly payee: string | null; readonly upiReference: string | null; readonly hint: string | null } {
  const upi = upiNarration(narration);
  if (upi !== null) return { payee: upi.payee, upiReference: upi.reference, hint: upi.note };
  const transfer = /^(?:NEFT|RTGS) (?:DR|CR)-[A-Za-z0-9]+-([^-]+)-/.exec(narration.replace(/\s+/g, ' ').trim());
  return { payee: transfer === null ? null : (transfer[1] ?? '').trim() || null, upiReference: null, hint: null };
}

/**
 * Whether each printed balance follows from the one before it and its line. A statement that prints a running balance checks its own reading: a direction read the wrong way, or an
 * amount misread, breaks the chain at that line. A line with no balance is not checked, but it still moves the running figure, and the chain goes on from the next that has one.
 */
export function balanceChainProblems(lines: readonly StatementLine[]): readonly string[] {
  const problems: string[] = [];
  let previous: bigint | null = null;
  lines.forEach((line, index) => {
    const expected: bigint | null = previous === null ? null : line.direction === 'credit' ? previous + line.amountMinor : previous - line.amountMinor;
    if (line.balanceMinor === null) {
      // A line with no balance still moves the running figure, so the next balance is checked against it.
      previous = expected;
      return;
    }
    if (expected !== null) {
      if (expected !== line.balanceMinor) problems.push(`line ${String(index + 1)}: the balance does not follow from the one before it and this line's amount and direction.`);
    }
    previous = line.balanceMinor;
  });
  return problems;
}
