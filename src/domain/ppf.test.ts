import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { ppfBalance, type PpfEntry, type PpfRate } from './ppf.ts';

/**
 * A PPF account's balance, from what was put in and the rate the government notified.
 *
 * docs/blueprint.md section 10: "Contributions via a recurring rule; the balance is computed from the notified rate and
 * the lowest-balance-of-the-month convention". The convention, as the scheme states it: interest for a month is worked
 * out on the lowest balance between the close of the 5th and the end of the month, at the rate notified for that month,
 * a twelfth of the year's rate; the twelve months are added up and credited on 31 March, to the nearest rupee.
 * docs/design/protection-and-flow.md PF-C11: the value steps at that credit and is not marked up in between.
 *
 * Worked by hand in rupees; every figure below is arithmetic that can be checked on paper.
 */

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const deposit = (date: string, rupees: number): PpfEntry => ({ date, amount: inr(rupees) });
const rate = (from: string, ratePct: string): PpfRate => ({ from, ratePct });

const SEVEN_POINT_ONE: readonly PpfRate[] = [rate('2020-04-01', '7.100')];

/** An account that stood at 1,00,000 after the credit of 31 March 2025. */
const opening = { date: '2025-03-31', balance: inr(100_000) };

describe('a year of a PPF account', () => {
  it('earns a twelfth of the rate each month on what stood at the close of the 5th: 2,50,000 at 7.1% is 17,750', () => {
    // 1,00,000 + 1,50,000 paid on 4 April: 2,50,000 stands at the close of the 5th, and no month has less.
    // 2,50,000 x 7.1% = 17,750, credited on 31 March 2026.
    const view = ppfBalance({
      opening,
      entries: [deposit('2025-04-04', 150_000)],
      rates: SEVEN_POINT_ONE,
      on: '2026-03-31',
    });
    expect(view).toMatchObject({ ok: true });
    if (!view.ok) return;
    expect(view.value).toEqual(inr(267_750));
    expect(view.credits).toEqual([{ on: '2026-03-31', interest: inr(17_750) }]);
  });

  it('does not count a payment made after the 5th until the month after: 50,000 paid on 6 May earns from June', () => {
    // April and May on 2,50,000; June to March, ten months, on 3,00,000.
    // 2,50,000 x 7.1% x 2/12 = 2,958.33 and 3,00,000 x 7.1% x 10/12 = 17,750: 20,708.33, to the nearest rupee 20,708.
    const view = ppfBalance({
      opening,
      entries: [deposit('2025-04-04', 150_000), deposit('2025-05-06', 50_000)],
      rates: SEVEN_POINT_ONE,
      on: '2026-03-31',
    });
    if (!view.ok) throw new Error('refused');
    expect(view.credits).toEqual([{ on: '2026-03-31', interest: inr(20_708) }]);
    expect(view.value).toEqual(inr(320_708));
  });

  it('counts a payment made on the 5th itself in that month', () => {
    // 50,000 paid on 5 May is in the balance at the close of the 5th, so May earns on 3,00,000: Apr 2,50,000, May to Mar 3,00,000.
    // 2,50,000 x 7.1% /12 = 1,479.17 and 3,00,000 x 7.1% x 11/12 = 19,525: 21,004.17, to the nearest rupee 21,004.
    const view = ppfBalance({
      opening,
      entries: [deposit('2025-04-04', 150_000), deposit('2025-05-05', 50_000)],
      rates: SEVEN_POINT_ONE,
      on: '2026-03-31',
    });
    if (!view.ok) throw new Error('refused');
    expect(view.credits[0]?.interest).toEqual(inr(21_004));
  });

  it('follows a change of rate from the month it applies to: 7.1% to September, 6.9% after', () => {
    // 2,50,000 x 7.1% x 6/12 = 8,875 and 2,50,000 x 6.9% x 6/12 = 8,625: 17,500.
    const view = ppfBalance({
      opening,
      entries: [deposit('2025-04-04', 150_000)],
      rates: [rate('2020-04-01', '7.100'), rate('2025-10-01', '6.900')],
      on: '2026-03-31',
    });
    if (!view.ok) throw new Error('refused');
    expect(view.credits[0]?.interest).toEqual(inr(17_500));
  });

  it('takes the lowest balance when money has been taken out after the 5th', () => {
    // 3,00,000 at the close of 5 April, 50,000 taken out on the 20th: the lowest balance is 2,50,000 for April.
    // May to March: 2,50,000. 2,50,000 x 7.1% = 17,750 for the year.
    const view = ppfBalance({
      opening: { date: '2025-03-31', balance: inr(300_000) },
      entries: [{ date: '2025-04-20', amount: inr(-50_000) }],
      rates: SEVEN_POINT_ONE,
      on: '2026-03-31',
    });
    if (!view.ok) throw new Error('refused');
    expect(view.credits[0]?.interest).toEqual(inr(17_750));
    expect(view.value).toEqual(inr(267_750));
  });
});

describe('rounding the credit to the nearest rupee', () => {
  const year = (rupees: number) =>
    ppfBalance({ opening: { date: '2025-03-31', balance: inr(rupees) }, entries: [], rates: SEVEN_POINT_ONE, on: '2026-03-31' });

  it('rounds 8,765.447 down to 8,765', () => {
    const view = year(123_457);
    if (!view.ok) throw new Error('refused');
    expect(view.credits[0]?.interest).toEqual(inr(8_765));
  });

  it('rounds 8,765.518 up to 8,766', () => {
    const view = year(123_458);
    if (!view.ok) throw new Error('refused');
    expect(view.credits[0]?.interest).toEqual(inr(8_766));
  });
});

describe('the value steps at the credit and is not marked up in between', () => {
  const entries = [deposit('2025-04-04', 150_000)];
  const at = (on: string) => {
    const view = ppfBalance({ opening, entries, rates: SEVEN_POINT_ONE, on });
    if (!view.ok) throw new Error('refused');
    return view;
  };

  it('is what was put in, with no interest, the day before the credit', () => {
    expect(at('2026-03-30').value).toEqual(inr(250_000));
    // And nothing is marked up in the middle of the year either.
    expect(at('2025-09-30').value).toEqual(inr(250_000));
  });

  it('includes the credit on 31 March itself, and keeps it after', () => {
    expect(at('2026-03-31').value).toEqual(inr(267_750));
    expect(at('2026-04-01').value).toEqual(inr(267_750));
    expect(at('2026-09-30').value).toEqual(inr(267_750));
  });

  it('says what has accrued and is not yet credited, apart from the value', () => {
    // Six months of 2,50,000 x 7.1% /12 = 8,875 by the end of September, and it is not in the value.
    const view = at('2025-09-30');
    expect(view.accrued).toEqual(inr(8_875));
    expect(view.value).toEqual(inr(250_000));
    expect(at('2026-03-31').accrued).toEqual(inr(0));
  });

  it('counts only the months that have ended: on 15 September five months have accrued, not six', () => {
    // April to August, 2,50,000 x 7.1% x 5/12 = 7,395.83, to the paisa 7,395.83.
    expect(at('2025-09-15').accrued).toEqual(money(739_583n, 'INR'));
  });

  it('compounds from the next year: April 2026 earns on the credited balance', () => {
    // 2,67,750 for a year at 7.1% is 19,010.25, to the rupee 19,010, credited on 31 March 2027: 2,86,760.
    const view = ppfBalance({ opening, entries, rates: SEVEN_POINT_ONE, on: '2027-03-31' });
    if (!view.ok) throw new Error('refused');
    expect(view.credits.map((c) => c.interest)).toEqual([inr(17_750), inr(19_010)]);
    expect(view.value).toEqual(inr(286_760));
  });
});

describe('an account with no opening balance', () => {
  it('starts from its first payment', () => {
    // 1,50,000 paid on 4 April: 1,50,000 x 7.1% = 10,650.
    const view = ppfBalance({ entries: [deposit('2025-04-04', 150_000)], rates: SEVEN_POINT_ONE, on: '2026-03-31' });
    if (!view.ok) throw new Error('refused');
    expect(view.credits[0]?.interest).toEqual(inr(10_650));
    expect(view.value).toEqual(inr(160_650));
  });

  it('is worth nothing, and not an error, before anything has been paid in', () => {
    const view = ppfBalance({ entries: [], rates: SEVEN_POINT_ONE, on: '2026-03-31' });
    expect(view).toMatchObject({ ok: true, value: inr(0), credits: [], accrued: inr(0) });
  });
});

describe('what it refuses', () => {
  it('a month with no rate in force, rather than guessing one', () => {
    const view = ppfBalance({
      opening,
      entries: [deposit('2025-04-04', 150_000)],
      rates: [rate('2025-10-01', '7.100')],
      on: '2026-03-31',
    });
    expect(view).toEqual({ ok: false, reason: 'no-rate', month: '2025-04' });
  });

  it('a payment dated before the opening balance, which the balance already includes', () => {
    expect(
      ppfBalance({ opening, entries: [deposit('2025-03-30', 1_000)], rates: SEVEN_POINT_ONE, on: '2026-03-31' }),
    ).toEqual({ ok: false, reason: 'before-opening' });
  });

  it('amounts in two currencies', () => {
    const dollars = { date: '2025-04-04', amount: money(10_000n, 'USD') };
    expect(ppfBalance({ opening, entries: [dollars], rates: SEVEN_POINT_ONE, on: '2026-03-31' })).toEqual({
      ok: false,
      reason: 'mixed-currency',
    });
  });

  it('a balance that would go below nothing', () => {
    expect(
      ppfBalance({ opening, entries: [{ date: '2025-04-10', amount: inr(-200_000) }], rates: SEVEN_POINT_ONE, on: '2026-03-31' }),
    ).toEqual({ ok: false, reason: 'overdrawn' });
  });

  it('a rate that is not a percentage', () => {
    expect(
      ppfBalance({ opening, entries: [], rates: [rate('2020-04-01', 'seven')], on: '2026-03-31' }),
    ).toEqual({ ok: false, reason: 'invalid-rate' });
  });
});

describe('the rate in force', () => {
  it('is the latest notified on or before the day, and said', () => {
    const view = ppfBalance({
      opening,
      entries: [],
      rates: [rate('2020-04-01', '7.100'), rate('2025-10-01', '6.900')],
      on: '2025-12-15',
    });
    if (!view.ok) throw new Error('refused');
    expect(view.rateInForce).toBe('6.900');
  });
});
