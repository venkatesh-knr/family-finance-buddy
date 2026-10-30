/**
 * A PPF account's balance, worked out from what was paid in and the rate the government notified.
 *
 * docs/blueprint.md section 10: "Contributions via a recurring rule; the balance is computed from the notified rate and
 * the lowest-balance-of-the-month convention". The convention, as the scheme states it: interest for a month is worked
 * out on the lowest balance between the close of the 5th and the end of the month, at the rate notified for that month,
 * a twelfth of the year's rate. The twelve months are added up and credited on 31 March, to the nearest rupee, and a
 * payment made after the 5th earns from the month after.
 *
 * The value steps at that credit and is not marked up in between (docs/design/protection-and-flow.md, PF-C11): it is
 * what the passbook says, which is what was paid in and the interest credited so far. What has accrued and is not yet
 * credited is returned beside it and is never part of it.
 *
 * Pure: the entries, the rates and the day in, the balance out. Integer minor units throughout; the interest is a
 * rational number of minor units kept as a numerator until the year's total is rounded once, so no month is rounded
 * and the months cannot drift from the year. A month with no rate in force is refused and named, rather than given one.
 *
 * What it does not model: the limit on a year's payments, the term and its extensions, loans and withdrawal rules. A
 * withdrawal is an entry with a negative amount and is taken into the lowest balance, which is all the convention needs.
 */

import type { IsoDate } from '../lib/dates.ts';
import { minorUnitExponent, money, type Money } from '../lib/money.ts';

export interface PpfEntry {
  readonly date: IsoDate;
  /** A payment in, or a withdrawal out as a negative amount. */
  readonly amount: Money;
}

export interface PpfRate {
  /** The first day the rate applies: quarters are notified, so this is the first day of one. */
  readonly from: IsoDate;
  /** The percentage a year, to three decimal places: "7.100". */
  readonly ratePct: string;
}

export type PpfView =
  | {
      readonly ok: true;
      /** What the passbook says: the opening balance, what has been paid in, and the interest credited so far. */
      readonly value: Money;
      /** Interest accrued for the months that have ended since the last credit, to the paisa. Not in `value`. */
      readonly accrued: Money;
      /** Each credit made on 31 March up to the day, oldest first. */
      readonly credits: readonly { readonly on: IsoDate; readonly interest: Money }[];
      /** The rate notified on or before the day, as it was given, or null if none is. */
      readonly rateInForce: string | null;
    }
  | { readonly ok: false; readonly reason: 'no-rate'; readonly month: string }
  | { readonly ok: false; readonly reason: 'before-opening' | 'mixed-currency' | 'overdrawn' | 'invalid-rate' };

const RATE = /^\d{1,3}(\.\d{1,3})?$/;

/** "7.100" as thousandths of a percent: 7100. */
function milli(ratePct: string): bigint {
  const [whole = '0', fraction = ''] = ratePct.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export function ppfBalance(input: {
  readonly opening?: { readonly date: IsoDate; readonly balance: Money };
  readonly entries: readonly PpfEntry[];
  readonly rates: readonly PpfRate[];
  readonly on: IsoDate;
  /** The currency of an account with nothing in it yet. Rupees. */
  readonly currency?: string;
}): PpfView {
  const { opening, rates, on } = input;
  const currency = opening?.balance.currency ?? input.entries[0]?.amount.currency ?? input.currency ?? 'INR';

  if (
    (opening !== undefined && opening.balance.currency !== currency) ||
    input.entries.some((entry) => entry.amount.currency !== currency)
  ) {
    return { ok: false, reason: 'mixed-currency' };
  }
  if (rates.some((entry) => !RATE.test(entry.ratePct))) return { ok: false, reason: 'invalid-rate' };
  if (opening !== undefined && input.entries.some((entry) => entry.date < opening.date)) {
    return { ok: false, reason: 'before-opening' };
  }

  const sortedRates = [...rates].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const rateOn = (day: IsoDate): PpfRate | null => {
    let found: PpfRate | null = null;
    for (const entry of sortedRates) if (entry.from <= day) found = entry;
    return found;
  };

  // The opening balance is the first event, on its day; the payments follow in order.
  const events: { date: IsoDate; delta: bigint }[] = [
    ...(opening === undefined ? [] : [{ date: opening.date, delta: opening.balance.minor }]),
    ...input.entries.map((entry) => ({ date: entry.date, delta: entry.amount.minor })),
  ]
    .filter((event) => event.date <= on)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const zero = money(0n, currency);
  const inForce = rateOn(on)?.ratePct ?? null;
  const first = events[0];
  if (first === undefined) return { ok: true, value: zero, accrued: zero, credits: [], rateInForce: inForce };

  const unit = 10n ** BigInt(minorUnitExponent(currency));
  // Interest for a month is lowest x rate% / 100 / 12 minor units: a numerator over 12 x 100 x 1000, the rate being in thousandths.
  const DENOMINATOR = 1_200_000n;

  let balance = 0n;
  let at = 0; // the next event not yet applied
  let yearNumerator = 0n;
  const credits: { on: IsoDate; interest: Money }[] = [];

  let year = Number(first.date.slice(0, 4));
  let month = Number(first.date.slice(5, 7));
  const lastYear = Number(on.slice(0, 4));
  const lastMonth = Number(on.slice(5, 7));

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const prefix = `${pad(year, 4)}-${pad(month, 2)}`;
    const monthStart = `${prefix}-01`;
    const fifth = `${prefix}-05`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthEnd = `${prefix}-${pad(lastDay, 2)}`;

    // Up to the close of the 5th, then each later change in turn: the lowest of those is what the month earns on.
    while (events[at] !== undefined && (events[at]?.date as IsoDate) <= fifth) {
      balance += events[at]?.delta ?? 0n;
      if (balance < 0n) return { ok: false, reason: 'overdrawn' };
      at += 1;
    }
    let lowest = balance;
    while (events[at] !== undefined && (events[at]?.date as IsoDate) <= monthEnd) {
      balance += events[at]?.delta ?? 0n;
      if (balance < 0n) return { ok: false, reason: 'overdrawn' };
      if (balance < lowest) lowest = balance;
      at += 1;
    }

    // Only a month that has ended has earned its interest.
    if (monthEnd <= on && lowest > 0n) {
      const rate = rateOn(monthStart);
      if (rate === null) return { ok: false, reason: 'no-rate', month: prefix };
      yearNumerator += lowest * milli(rate.ratePct);
    }

    // The credit, on 31 March: the year's months added up and rounded once, half a unit upward, to the nearest rupee.
    if (month === 3 && monthEnd <= on) {
      const interest = ((2n * yearNumerator + DENOMINATOR * unit) / (2n * DENOMINATOR * unit)) * unit;
      if (interest > 0n) {
        balance += interest;
        credits.push({ on: monthEnd, interest: money(interest, currency) });
      }
      yearNumerator = 0n;
    }

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return {
    ok: true,
    value: money(balance, currency),
    accrued: money(yearNumerator / DENOMINATOR, currency),
    credits,
    rateInForce: inForce,
  };
}

/**
 * What Close month writes for each PPF: the passbook as it stands at the month end, which is already the stepped value, so
 * no rule is needed for it apart from the one `ppfBalance` has. An account that cannot be worked out is left out and named,
 * and no figure is made up for it: one that had not begun by then, one with no rate in force, or one whose payments do not
 * fit its opening balance.
 */
export function ppfMonthEndReadings(
  accounts: readonly {
    readonly holdingId: string;
    readonly opening?: { readonly date: IsoDate; readonly balance: Money };
    readonly entries: readonly PpfEntry[];
  }[],
  rates: readonly PpfRate[],
  monthEnd: IsoDate,
): {
  readonly readings: readonly { readonly holdingId: string; readonly value: Money }[];
  readonly skipped: readonly { readonly holdingId: string; readonly why: 'not-started' | 'no-rate' | 'unworkable' }[];
} {
  const readings: { holdingId: string; value: Money }[] = [];
  const skipped: { holdingId: string; why: 'not-started' | 'no-rate' | 'unworkable' }[] = [];

  for (const account of accounts) {
    const begun =
      (account.opening !== undefined && account.opening.date <= monthEnd) ||
      account.entries.some((entry) => entry.date <= monthEnd);
    if (!begun) {
      skipped.push({ holdingId: account.holdingId, why: 'not-started' });
      continue;
    }
    const view = ppfBalance({
      ...(account.opening === undefined ? {} : { opening: account.opening }),
      entries: account.entries,
      rates,
      on: monthEnd,
    });
    if (view.ok) readings.push({ holdingId: account.holdingId, value: view.value });
    else skipped.push({ holdingId: account.holdingId, why: view.reason === 'no-rate' ? 'no-rate' : 'unworkable' });
  }

  return { readings, skipped };
}
