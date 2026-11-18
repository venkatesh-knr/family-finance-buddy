/**
 * What the State the spend form works out for itself (docs/design/spending-capture.md section 11.3; the StateSpend boards).
 *
 * Pure: the fields as typed, what is itemised so far and the currency are passed in; nothing here reads a database or a clock. *Spent in total* and *or just the
 * rest* are linked: typing either fills the other, and what is saved is always the total. A total below what is itemised is not an error (neither figure is
 * clamped, SC-I16): the rest stays empty and the form says so.
 */

import { formatMoney, minorUnitExponent, money, parseAmountToMinor } from '../../lib/money.ts';
import { restToTotal, totalToRest } from '../../domain/spend-source.ts';

export type AmountReading =
  | { readonly ok: true; readonly minor: bigint }
  | { readonly ok: false; readonly problem: string; readonly blank: boolean };

/** The longest note the table takes. */
export const NOTE_LIMIT = 500;

const symbolOf = (currency: string): string => formatMoney(money(0n, currency)).replace(/[\d.,\s]/g, '');

/** An amount as typed, in minor units, or what is wrong with it in words. A blank is flagged so a form can wait to say so until it is tried. */
export function amountReading(text: string, currency: string): AmountReading {
  if (text.trim() === '') return { ok: false, problem: `Type an amount more than ${symbolOf(currency)}0, like 82,000.`, blank: true };
  try {
    const minor = parseAmountToMinor(text, currency);
    if (minor <= 0n) return { ok: false, problem: `Type an amount more than ${symbolOf(currency)}0, like 82,000.`, blank: false };
    return { ok: true, minor };
  } catch (error) {
    const said = error instanceof Error ? error.message : '';
    // The parser's own sentence where it says something a person can act on; otherwise ours.
    if (said.includes('decimal places') || said.includes('whole number')) return { ok: false, problem: said, blank: false };
    return { ok: false, problem: `Type an amount more than ${symbolOf(currency)}0, like 82,000.`, blank: false };
  }
}

/** Minor units as a plain figure to put in a field: no symbol, no grouping, the currency's own decimal places and none that say nothing. */
function plain(minor: bigint, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const digits = minor.toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? '' : digits.slice(digits.length - exponent);
  return /^0*$/.test(fraction) ? whole : `${whole}.${fraction}`;
}

export interface LinkedFields {
  readonly total: string;
  readonly rest: string;
  /** *₹52,000 itemised + ₹30,000 more*: what will be saved, whichever field was typed in. Null when there is no rest to show. */
  readonly caption: string | null;
  /** The total typed is below what is itemised: the rest stays empty, and neither figure is changed. */
  readonly belowItemised: boolean;
}

/** The two fields after one of them was typed in: the one typed keeps its text, and the other is filled when what was typed can be read. */
export function linkedFields(input: {
  readonly edited: 'total' | 'rest';
  readonly text: string;
  readonly itemised: bigint;
  readonly currency: string;
  /** Privacy mode: the amounts in the caption are masked, and the other field is not filled, because the rest or the total would give the itemised figure away. */
  readonly privacy?: boolean;
}): LinkedFields {
  const { edited, text, itemised, currency } = input;
  const privacy = input.privacy === true;
  const reading = amountReading(text, currency);
  if (edited === 'total') {
    if (!reading.ok) return { total: text, rest: '', caption: null, belowItemised: false };
    const rest = totalToRest(reading.minor, itemised);
    if (rest === null) return { total: text, rest: '', caption: null, belowItemised: true };
    // Nothing itemised, or the total is exactly what is itemised: there is no rest to speak of.
    if (itemised === 0n || rest === 0n) return { total: text, rest: '', caption: null, belowItemised: false };
    return { total: text, rest: privacy ? '' : plain(rest, currency), caption: captionOf(itemised, rest, currency, privacy), belowItemised: false };
  }
  if (!reading.ok) return { total: '', rest: text, caption: null, belowItemised: false };
  return { total: privacy ? '' : plain(restToTotal(itemised, reading.minor), currency), rest: text, caption: captionOf(itemised, reading.minor, currency, privacy), belowItemised: false };
}

const captionOf = (itemised: bigint, rest: bigint, currency: string, privacy: boolean): string =>
  `${formatMoney(money(itemised, currency), { privacy })} itemised + ${formatMoney(money(rest, currency), { privacy })} more`;

export type SpendFormReading =
  | { readonly ok: true; readonly amountMinor: bigint; readonly note: string | null }
  | { readonly ok: false; readonly problem: string };

/** What saving reads: the total as the amount, and the note trimmed, or what is wrong. */
export function readSpendForm(input: { readonly total: string; readonly note: string; readonly itemised: bigint; readonly currency: string }): SpendFormReading {
  const amount = amountReading(input.total, input.currency);
  if (!amount.ok) return { ok: false, problem: amount.problem };
  const note = input.note.trim();
  if (note.length > NOTE_LIMIT) return { ok: false, problem: `The note is up to ${String(NOTE_LIMIT)} characters.` };
  return { ok: true, amountMinor: amount.minor, note: note === '' ? null : note };
}

/**
 * The currencies the form offers, in order: the one being read first, then any other the month was itemised in, once each. One statement is live for a
 * household, month and currency, so one already stated is not offered again.
 */
export function stateSpendChoices(input: { readonly reading: string; readonly itemisedIn: readonly string[]; readonly statedIn: readonly string[] }): readonly string[] {
  const out: string[] = [];
  for (const code of [input.reading, ...input.itemisedIn]) {
    if (!out.includes(code) && !input.statedIn.includes(code)) out.push(code);
  }
  return out;
}
