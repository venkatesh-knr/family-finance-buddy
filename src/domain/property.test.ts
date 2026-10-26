import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { propertyCostBasis, type PropertyImprovement } from './property.ts';

/**
 * What a property cost, for the day it is sold.
 *
 * docs/blueprint.md, Property: "Purchase price, stamp duty and registration all form part of what you actually paid
 * ... Capital improvements are dated entries that add to the basis; repairs are recorded but don't." These are the
 * known answers, worked by hand in rupees, written before the function.
 */

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');

const improvement = (date: string, rupees: number, isCapital: boolean): PropertyImprovement => ({
  date,
  amount: inr(rupees),
  isCapital,
});

describe('the cost of a property is everything paid to hold it', () => {
  it('adds the price, the stamp duty and the registration', () => {
    // 80,00,000 + 5,60,000 (7%) + 80,000 (1%) = 86,40,000.
    const result = propertyCostBasis({
      purchaseCost: inr(8_000_000),
      stampDuty: inr(560_000),
      registration: inr(80_000),
      improvements: [],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.whole).toEqual(inr(8_640_000));
    expect(result.share).toEqual(inr(8_640_000));
    expect(result.capitalImprovements).toEqual(inr(0));
  });

  it('allows a nil stamp duty and registration, as on a gift or an inheritance', () => {
    const result = propertyCostBasis({
      purchaseCost: inr(2_500_000),
      stampDuty: inr(0),
      registration: inr(0),
      improvements: [],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.whole).toEqual(inr(2_500_000));
  });
});

describe('capital improvements add to it and repairs do not', () => {
  const base = {
    purchaseCost: inr(8_000_000),
    stampDuty: inr(560_000),
    registration: inr(80_000),
  };

  it('counts the capital work and leaves the repair out, and says what it left out', () => {
    // 86,40,000 + 3,50,000 (a new kitchen) + 1,20,000 (waterproofing) = 91,10,000. The 40,000 repainting is a repair.
    const result = propertyCostBasis({
      ...base,
      improvements: [
        improvement('2019-03-10', 350_000, true),
        improvement('2021-07-02', 120_000, true),
        improvement('2022-01-15', 40_000, false),
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.capitalImprovements).toEqual(inr(470_000));
    expect(result.repairsExcluded).toEqual(inr(40_000));
    expect(result.whole).toEqual(inr(9_110_000));
  });

  it('counts only the work done by the day it is read for, the day itself included', () => {
    const improvements = [
      improvement('2019-03-10', 350_000, true),
      improvement('2021-07-02', 120_000, true),
      improvement('2024-09-01', 200_000, true),
    ];
    const at = (asOf: string) => {
      const result = propertyCostBasis({ ...base, improvements, asOf });
      if (!result.ok) throw new Error('refused');
      return result.whole;
    };
    // A sale on 2 July 2021 takes the work done that day; one on 1 July 2021 does not; the 2024 work is after both.
    expect(at('2021-07-02')).toEqual(inr(9_110_000));
    expect(at('2021-07-01')).toEqual(inr(8_990_000));
    expect(at('2019-03-09')).toEqual(inr(8_640_000));
    // And with no day given, all of it.
    expect(at('2030-01-01')).toEqual(inr(9_310_000));
  });

  it('does not count a repair dated before the day either way', () => {
    const result = propertyCostBasis({ ...base, improvements: [improvement('2019-03-10', 90_000, false)], asOf: '2020-01-01' });
    if (!result.ok) throw new Error('refused');
    expect(result.whole).toEqual(inr(8_640_000));
    expect(result.repairsExcluded).toEqual(inr(90_000));
  });
});

describe("the household's share of a jointly owned property", () => {
  const whole = {
    purchaseCost: inr(8_000_000),
    stampDuty: inr(560_000),
    registration: inr(80_000),
    improvements: [improvement('2019-03-10', 470_000, true)],
  };

  it('is the whole when no share is given', () => {
    const result = propertyCostBasis(whole);
    if (!result.ok) throw new Error('refused');
    expect(result.sharePct).toBe('100');
    expect(result.share).toEqual(result.whole);
  });

  it('is half of the cost for a half share: 91,10,000 becomes 45,55,000', () => {
    const result = propertyCostBasis({ ...whole, sharePct: '50' });
    if (!result.ok) throw new Error('refused');
    expect(result.whole).toEqual(inr(9_110_000));
    expect(result.share).toEqual(inr(4_555_000));
  });

  it('takes a share to two decimal places, in integer arithmetic', () => {
    // 91,10,000 rupees is 911,000,000 paise; 33.33% of that is 303,636,300 paise, exactly (911 x 3333 = 3,036,363).
    const result = propertyCostBasis({ ...whole, sharePct: '33.33' });
    if (!result.ok) throw new Error('refused');
    expect(result.share.minor).toBe(303_636_300n);
  });

  it('rounds a half paisa up, once, on the share and not on the parts', () => {
    // 5 paise at 50% is 2.5: up to 3. 3 paise at 50% is 1.5: up to 2. 4 paise at 33.33% is 1.3332: down to 1.
    const paise = (minor: bigint, sharePct: string) => {
      const result = propertyCostBasis({
        purchaseCost: money(minor, 'INR'),
        stampDuty: money(0n, 'INR'),
        registration: money(0n, 'INR'),
        improvements: [],
        sharePct,
      });
      if (!result.ok) throw new Error('refused');
      return result.share.minor;
    };
    expect(paise(5n, '50')).toBe(3n);
    expect(paise(3n, '50')).toBe(2n);
    expect(paise(4n, '33.33')).toBe(1n);
  });
});

describe('what it refuses', () => {
  const parts = {
    purchaseCost: inr(8_000_000),
    stampDuty: inr(560_000),
    registration: inr(80_000),
    improvements: [] as PropertyImprovement[],
  };

  it('refuses amounts in two currencies rather than adding them', () => {
    expect(propertyCostBasis({ ...parts, stampDuty: usd(7_000) })).toEqual({ ok: false, reason: 'mixed-currency' });
    expect(propertyCostBasis({ ...parts, improvements: [{ date: '2020-01-01', amount: usd(5_000), isCapital: true }] })).toEqual({
      ok: false,
      reason: 'mixed-currency',
    });
  });

  it('reads a property bought abroad in its own currency', () => {
    const result = propertyCostBasis({
      purchaseCost: usd(400_000),
      stampDuty: usd(8_000),
      registration: usd(1_500),
      improvements: [{ date: '2022-05-05', amount: usd(25_000), isCapital: true }],
    });
    if (!result.ok) throw new Error('refused');
    expect(result.whole).toEqual(usd(434_500));
  });

  it('refuses a negative amount', () => {
    expect(propertyCostBasis({ ...parts, purchaseCost: inr(-1) })).toEqual({ ok: false, reason: 'negative-amount' });
    expect(propertyCostBasis({ ...parts, improvements: [improvement('2020-01-01', -5, true)] })).toEqual({
      ok: false,
      reason: 'negative-amount',
    });
  });

  it.each(['0', '100.01', '150', '33.333', '-5', 'half', '', '5%'])('refuses a share of %j', (sharePct) => {
    expect(propertyCostBasis({ ...parts, sharePct })).toEqual({ ok: false, reason: 'invalid-share' });
  });

  it.each(['1', '0.01', '99.99', '100', '100.00', '12.5'])('accepts a share of %j', (sharePct) => {
    expect(propertyCostBasis({ ...parts, sharePct })).toMatchObject({ ok: true });
  });
});
