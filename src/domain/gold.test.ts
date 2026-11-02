import { describe, expect, it } from 'vitest';
import { dueDates, goldValue, schemeState, type GoldRate, type GoldTerms, type Instalment } from './gold.ts';

/**
 * The jeweller's gold savings scheme (docs/design/gold.md; GD-I2, GD-I3): what is paid, what is left, when the next is due, what
 * is redeemable if every instalment is paid, which are missed, and what the scheme is worth. The fixtures are the demo household's
 * scheme and the board's own figures: eleven instalments of five thousand on the 10th from 10 June, a one-instalment bonus, and a
 * redeemable total of sixty thousand on 10 May.
 */

const AMOUNT: GoldTerms = {
  variant: 'amount',
  instalmentMinor: 500000n,
  currency: 'INR',
  instalments: 11,
  startDate: '2026-06-10',
  dueDay: 10,
  bonusMinor: 500000n,
  bonusText: 'one instalment, at maturity',
  purity: null,
};

const paid = (...dates: string[]): Instalment[] => dates.map((date) => ({ date, amountMinor: 500000n, grams: null }));
const FIVE = paid('2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10');

describe('the instalments that fall due', () => {
  it('are one a month on the due day, from the month the scheme starts', () => {
    const dates = dueDates(AMOUNT);
    expect(dates).toHaveLength(11);
    expect(dates[0]).toBe('2026-06-10');
    expect(dates[1]).toBe('2026-07-10');
    expect(dates[7]).toBe('2027-01-10');
    expect(dates[10]).toBe('2027-04-10');
  });

  it('cross a year, and keep the day', () => {
    const dates = dueDates({ ...AMOUNT, startDate: '2026-11-05', dueDay: 5, instalments: 4 });
    expect(dates).toEqual(['2026-11-05', '2026-12-05', '2027-01-05', '2027-02-05']);
  });
});

describe('an amount scheme, five of eleven paid (the demo household and the board)', () => {
  const state = schemeState(AMOUNT, FIVE, '2026-10-30');

  it('says what is paid so far and what is left', () => {
    expect(state.paidCount).toBe(5);
    expect(state.paidMinor).toBe(2500000n);
    expect(state.left).toBe(6);
  });

  it('says when the next is due, and when the scheme matures: the month after the last instalment', () => {
    expect(state.nextDue).toBe('2026-11-10');
    expect(state.matures).toBe('2027-05-10');
  });

  it('says what is redeemable if every instalment is paid, with the bonus the jeweller states', () => {
    expect(state.atMaturity).toEqual({ minor: 6000000n, currency: 'INR', includesBonus: true });
  });

  it('has missed nothing on the day, since the October instalment is paid', () => {
    expect(state.missed).toEqual([]);
  });

  it('misses an instalment that fell due and is not recorded, and names its date', () => {
    expect(schemeState(AMOUNT, FIVE, '2026-11-12').missed).toEqual(['2026-11-10']);
    expect(schemeState(AMOUNT, FIVE, '2026-12-20').missed).toEqual(['2026-11-10', '2026-12-10']);
  });

  it('does not count an instalment as missed on the day it falls due, until the day has passed', () => {
    expect(schemeState(AMOUNT, FIVE, '2026-11-10').missed).toEqual([]);
    expect(schemeState(AMOUNT, FIVE, '2026-11-11').missed).toEqual(['2026-11-10']);
  });
});

describe('a scheme that has not started, and one that is complete', () => {
  it('has paid nothing and owes nothing before its first instalment', () => {
    const state = schemeState(AMOUNT, [], '2026-05-01');
    expect(state.paidCount).toBe(0);
    expect(state.paidMinor).toBe(0n);
    expect(state.nextDue).toBe('2026-06-10');
    expect(state.missed).toEqual([]);
  });

  it('has no next instalment once all are paid, and a bonus that is still not in its value', () => {
    const all = Array.from({ length: 11 }, (_, index) => ({ date: dueDates(AMOUNT)[index] ?? '', amountMinor: 500000n, grams: null }));
    const state = schemeState(AMOUNT, all, '2027-05-01');
    expect(state.left).toBe(0);
    expect(state.nextDue).toBeNull();
    expect(state.paidMinor).toBe(5500000n);
    const value = goldValue(AMOUNT, all, [], '2027-05-01');
    expect(value).toEqual({ ok: true, value: { minor: 5500000n, currency: 'INR' } });
  });

  it('keeps counting an overpayment as paid, and says it', () => {
    const state = schemeState({ ...AMOUNT, instalments: 2 }, paid('2026-06-10', '2026-07-10', '2026-08-10'), '2026-09-01');
    expect(state.paidCount).toBe(3);
    expect(state.left).toBe(0);
    expect(state.overpaid).toBe(true);
  });
});

describe('what the redeemable total says when the bonus is not a figure', () => {
  it('leaves the bonus out and says it did', () => {
    const state = schemeState({ ...AMOUNT, bonusMinor: null, bonusText: 'a discount on making charges' }, FIVE, '2026-10-30');
    expect(state.atMaturity).toEqual({ minor: 5500000n, currency: 'INR', includesBonus: false });
  });
});

describe('what a scheme is worth (GD-I2, GD-I3)', () => {
  it('is the instalments paid, for an amount scheme, and needs no rate', () => {
    expect(goldValue(AMOUNT, FIVE, [], '2026-10-30')).toEqual({ ok: true, value: { minor: 2500000n, currency: 'INR' } });
  });

  it('leaves the bonus out of the value until it is credited', () => {
    const value = goldValue(AMOUNT, FIVE, [], '2026-10-30');
    expect(value.ok && value.value.minor).toBe(2500000n);
  });

  const WEIGHT: GoldTerms = { ...AMOUNT, variant: 'weight', purity: '22k', bonusMinor: null, bonusText: null };
  const grams = (date: string, g: string): Instalment => ({ date, amountMinor: 500000n, grams: g });
  const bought = [grams('2026-06-10', '0.85000000'), grams('2026-07-10', '0.84000000'), grams('2026-08-10', '0.83500000')];
  const rates: GoldRate[] = [
    { purity: '22k', asOf: '2026-06-01', perGramMinor: 650000n, currency: 'INR' },
    { purity: '22k', asOf: '2026-10-01', perGramMinor: 700000n, currency: 'INR' },
    { purity: '24k', asOf: '2026-10-01', perGramMinor: 760000n, currency: 'INR' },
  ];

  it('is grams times the latest rate for its purity on or before the day, for a weight scheme', () => {
    // 0.85 + 0.84 + 0.835 = 2.525 grams at 7,000.00 a gram = 17,675.00
    expect(goldValue(WEIGHT, bought, rates, '2026-10-30')).toEqual({ ok: true, value: { minor: 1767500n, currency: 'INR' } });
    // On 15 September the October rate is not yet known: the June one is the latest.
    expect(goldValue(WEIGHT, bought, rates, '2026-09-15')).toEqual({ ok: true, value: { minor: 1641250n, currency: 'INR' } });
  });

  it('uses the rate for its own purity and never another’s', () => {
    const only24 = rates.filter((rate) => rate.purity === '24k');
    expect(goldValue(WEIGHT, bought, only24, '2026-10-30')).toEqual({ ok: false, reason: 'no-rate' });
  });

  it('is not valued without a rate, rather than valued at what was paid, and never from a typed value', () => {
    expect(goldValue(WEIGHT, bought, [], '2026-10-30')).toEqual({ ok: false, reason: 'no-rate' });
  });

  it('refuses a rate in another currency, and a weight scheme with instalments that carry no grams', () => {
    expect(goldValue(WEIGHT, bought, [{ ...(rates[1] as GoldRate), currency: 'USD' }], '2026-10-30')).toEqual({ ok: false, reason: 'mixed-currency' });
    expect(goldValue(WEIGHT, [{ date: '2026-06-10', amountMinor: 500000n, grams: null }], rates, '2026-10-30')).toEqual({ ok: false, reason: 'no-grams' });
  });

  it('rounds once, half up, to the minor unit', () => {
    // 0.00000001 gram at 1 paisa a gram is a hundred-millionth of a paisa: nothing. 0.5 paisa rounds up.
    const tiny = [{ date: '2026-06-10', amountMinor: 1n, grams: '0.50000000' }];
    expect(goldValue(WEIGHT, tiny, [{ purity: '22k', asOf: '2026-06-01', perGramMinor: 1n, currency: 'INR' }], '2026-10-30')).toEqual({
      ok: true,
      value: { minor: 1n, currency: 'INR' },
    });
  });

  it('has a weight scheme’s redeemable total unknown, since it depends on a rate that has not been set', () => {
    expect(schemeState(WEIGHT, bought, '2026-10-30').atMaturity).toBeNull();
    expect(schemeState(WEIGHT, bought, '2026-10-30').gramsPaid).toBe(252500000n);
  });
});
