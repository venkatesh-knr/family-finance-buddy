import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type {
  Household,
  Member,
  Property,
  PropertyImprovement,
  PropertyListing,
  PropertyLoan,
  PropertyValuation,
} from '../../repo/types.ts';
import { propertyFacts } from './propertyFacts.ts';

/**
 * What the property screen says, on the prototype's own figures (docs/design/prototype.html, Property): a house
 * bought for 42,00,000 with 2,94,000 of duty and registration and 3,50,000 of capital work, a plot, and a plot held
 * half and half. Worked by hand in rupees.
 */

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');
const TODAY = '2026-10-26';

const venkat: Member = { id: 'm-1', displayName: 'Venkat', colour: 'c1', isArchived: false };

const property = (over: Partial<Property> & { id: string }): Property => ({
  member: venkat,
  kind: 'apartment',
  label: over.id,
  currency: 'INR',
  purchaseDate: '2019-03-01',
  purchaseCost: inr(4_200_000),
  stampDuty: inr(294_000),
  registration: inr(0),
  sharePct: '100',
  isSelfOccupied: false,
  linkedLiabilityId: null,
  visibility: 'household',
  isArchived: false,
  archivedOn: null,
  note: null,
  ...over,
});

const work = (over: Partial<PropertyImprovement> & { id: string; propertyId: string }): PropertyImprovement => ({
  date: '2022-11-10',
  description: 'Work',
  amount: inr(280_000),
  isCapital: true,
  isVoided: false,
  ...over,
});

const valuation = (over: Partial<PropertyValuation> & { id: string; propertyId: string }): PropertyValuation => ({
  asOf: '2026-08-12',
  value: inr(6_400_000),
  basis: 'broker',
  note: null,
  ...over,
});

const listing = (over: Partial<PropertyListing>): PropertyListing => ({
  household: { id: 'h-1', name: 'Home', baseCurrency: 'INR' } as Household,
  staleMonths: 12,
  viewer: { accountId: 'a', memberId: 'm-1', role: 'owner', canRecord: true, canFileForOthers: true },
  members: [venkat],
  properties: [],
  improvements: [],
  valuations: [],
  loans: [],
  ...over,
});

describe('a property on its own', () => {
  const house = property({ id: 'house', isSelfOccupied: true });
  const base = listing({
    properties: [house],
    improvements: [
      work({ id: 'w1', propertyId: 'house', amount: inr(280_000) }),
      work({ id: 'w2', propertyId: 'house', date: '2024-07-05', amount: inr(70_000) }),
      work({ id: 'w3', propertyId: 'house', date: '2026-02-10', amount: inr(45_000), isCapital: false }),
    ],
    valuations: [valuation({ id: 'v1', propertyId: 'house' })],
  });

  it('works out the cost basis the prototype shows: 42,00,000 + 2,94,000 + 3,50,000 = 48,44,000', () => {
    const [facts] = propertyFacts(base, TODAY).byProperty;
    expect(facts?.cost).toMatchObject({ ok: true, whole: inr(4_844_000), share: inr(4_844_000) });
    // The repair is recorded and not counted.
    expect(facts?.cost).toMatchObject({ ok: true, repairsExcluded: inr(45_000) });
  });

  it('values it at the latest valuation, and says how it was arrived at', () => {
    const [facts] = propertyFacts(base, TODAY).byProperty;
    expect(facts?.value).toMatchObject({ asOf: '2026-08-12', basis: 'broker', share: inr(6_400_000) });
    expect(facts?.age).toEqual({ months: 2, stale: false });
  });

  it('leaves a voided entry in the log and out of the cost', () => {
    const withVoid = listing({
      ...base,
      improvements: [...base.improvements, work({ id: 'w4', propertyId: 'house', amount: inr(1_000_000), isVoided: true })],
    });
    const [facts] = propertyFacts(withVoid, TODAY).byProperty;
    expect(facts?.cost).toMatchObject({ ok: true, whole: inr(4_844_000) });
    expect(facts?.voided).toHaveLength(1);
    expect(facts?.work).toHaveLength(3);
  });

  it('is not valued, and says so, until somebody has said what it is worth', () => {
    const [facts] = propertyFacts(listing({ properties: [house] }), TODAY).byProperty;
    expect(facts?.value).toBeNull();
    expect(facts?.age).toBeNull();
  });

  it('does not use a valuation dated after today', () => {
    const future = listing({ properties: [house], valuations: [valuation({ id: 'v9', propertyId: 'house', asOf: '2027-01-01' })] });
    expect(propertyFacts(future, TODAY).byProperty[0]?.value).toBeNull();
  });

  it('marks a valuation stale past the household setting', () => {
    const old = listing({
      properties: [house],
      valuations: [valuation({ id: 'v1', propertyId: 'house', asOf: '2025-04-03' })],
    });
    expect(propertyFacts(old, TODAY).byProperty[0]?.age).toEqual({ months: 18, stale: true });
    expect(propertyFacts({ ...old, staleMonths: 24 }, TODAY).byProperty[0]?.age).toEqual({ months: 18, stale: false });
  });
});

describe("the household's share", () => {
  it('takes half of the cost and of the value for a half share, as Land2 on the prototype is held', () => {
    const land = property({
      id: 'land2',
      kind: 'plot',
      sharePct: '50',
      purchaseCost: inr(300_000),
      stampDuty: inr(50_000),
    });
    const all = propertyFacts(
      listing({
        properties: [land],
        valuations: [valuation({ id: 'v2', propertyId: 'land2', value: inr(2_700_000) })],
      }),
      TODAY,
    );
    // 3,50,000 is the whole cost; the household's half is 1,75,000, and half of 27,00,000 is 13,50,000.
    expect(all.byProperty[0]?.cost).toMatchObject({ ok: true, whole: inr(350_000), share: inr(175_000) });
    expect(all.byProperty[0]?.value?.share).toEqual(inr(1_350_000));
    expect(all.totals[0]?.value).toEqual(inr(1_350_000));
    expect(all.totals[0]?.cost).toEqual(inr(175_000));
  });
});

describe('equity after the loan', () => {
  const house = property({ id: 'house', linkedLiabilityId: 'loan-1' });
  const loan = (over: Partial<PropertyLoan>): PropertyLoan => ({
    id: 'loan-1',
    name: 'Home loan',
    isClosed: false,
    outstanding: inr(2_000_000),
    outstandingAsOf: '2026-10-01',
    ...over,
  });
  const valued = [valuation({ id: 'v1', propertyId: 'house', value: inr(6_400_000) })];

  it('is the value less what is owed: 64,00,000 less 20,00,000 is 44,00,000', () => {
    const all = propertyFacts(listing({ properties: [house], valuations: valued, loans: [loan({})] }), TODAY);
    expect(all.byProperty[0]?.equity).toEqual(inr(4_400_000));
    expect(all.totals[0]?.equity).toEqual(inr(4_400_000));
    expect(all.totals[0]?.withLoan).toBe(1);
  });

  it('is said to be unknown, not the whole value, when the loan has no balance recorded', () => {
    const all = propertyFacts(
      listing({ properties: [house], valuations: valued, loans: [loan({ outstanding: null, outstandingAsOf: null })] }),
      TODAY,
    );
    expect(all.byProperty[0]?.equity).toBeNull();
    expect(all.byProperty[0]?.equityWhy).toBe('no-balance');
    expect(all.totals[0]?.equity).toBeNull();
    expect(all.totals[0]?.equityGaps).toBe(1);
  });

  it('treats a closed loan as paid off', () => {
    const all = propertyFacts(
      listing({ properties: [house], valuations: valued, loans: [loan({ isClosed: true, outstanding: null })] }),
      TODAY,
    );
    expect(all.byProperty[0]?.equity).toEqual(inr(6_400_000));
  });

  it('says there is no value to take it from, when there is a loan and nobody has valued the property', () => {
    const all = propertyFacts(listing({ properties: [house], loans: [loan({})] }), TODAY);
    expect(all.byProperty[0]?.equityWhy).toBe('no-value');
  });

  it('can be negative', () => {
    const all = propertyFacts(
      listing({ properties: [house], valuations: valued, loans: [loan({ outstanding: inr(7_000_000) })] }),
      TODAY,
    );
    expect(all.byProperty[0]?.equity).toEqual(inr(-600_000));
  });

  it("takes the household's share of the loan off the household's share of the value", () => {
    // A half share of a 64,00,000 property is 32,00,000, and half of a 20,00,000 loan is 10,00,000: equity 22,00,000.
    // Taking the whole loan off the half share would say 12,00,000, which is the figure this is here to refuse.
    const half = property({ id: 'half', linkedLiabilityId: 'loan-1', sharePct: '50' });
    const all = propertyFacts(
      listing({ properties: [half], valuations: [valuation({ id: 'vh', propertyId: 'half', value: inr(6_400_000) })], loans: [loan({})] }),
      TODAY,
    );
    expect(all.byProperty[0]?.equity).toEqual(inr(2_200_000));
    expect(all.totals[0]?.equity).toEqual(inr(2_200_000));
  });

  it('is the value itself for a property with no loan, in the total', () => {
    const plot = property({ id: 'plot', kind: 'plot' });
    const all = propertyFacts(
      listing({
        properties: [plot],
        valuations: [valuation({ id: 'v3', propertyId: 'plot', value: inr(1_500_000) })],
      }),
      TODAY,
    );
    expect(all.totals[0]?.equity).toEqual(inr(1_500_000));
  });
});

describe('the totals', () => {
  it('are per currency, and never add a dollar property to the rupee ones', () => {
    const house = property({ id: 'house' });
    const abroad = property({
      id: 'abroad',
      currency: 'USD',
      purchaseCost: usd(400_000),
      stampDuty: usd(8_000),
      registration: usd(1_500),
    });
    const all = propertyFacts(
      listing({
        properties: [house, abroad],
        valuations: [
          valuation({ id: 'v1', propertyId: 'house', value: inr(6_400_000) }),
          valuation({ id: 'v2', propertyId: 'abroad', value: usd(450_000) }),
        ],
      }),
      TODAY,
    );
    expect(all.totals.map((t) => t.currency).sort()).toEqual(['INR', 'USD']);
    const rupees = all.totals.find((t) => t.currency === 'INR');
    const dollars = all.totals.find((t) => t.currency === 'USD');
    expect(rupees?.value).toEqual(inr(6_400_000));
    expect(dollars?.value).toEqual(usd(450_000));
    expect(dollars?.cost).toEqual(usd(409_500));
  });

  it('sum the cost, the duty and registration in it, and the capital work in it', () => {
    const house = property({ id: 'house' });
    const plot = property({ id: 'plot', kind: 'plot', purchaseCost: inr(900_000), stampDuty: inr(90_000) });
    const all = propertyFacts(
      listing({
        properties: [house, plot],
        improvements: [work({ id: 'w1', propertyId: 'house', amount: inr(350_000) })],
      }),
      TODAY,
    );
    // 48,44,000 + 9,90,000 = 58,34,000; duty 2,94,000 + 90,000 = 3,84,000; capital work 3,50,000.
    expect(all.totals[0]).toMatchObject({
      cost: inr(5_834_000),
      dutyAndRegistration: inr(384_000),
      capitalWork: inr(350_000),
      unvalued: 2,
      count: 2,
    });
  });

  it('count what is not valued, and leave it out of the value', () => {
    const house = property({ id: 'house' });
    const plot = property({ id: 'plot', kind: 'plot' });
    const all = propertyFacts(
      listing({
        properties: [house, plot],
        valuations: [valuation({ id: 'v1', propertyId: 'house', value: inr(6_400_000) })],
      }),
      TODAY,
    );
    expect(all.totals[0]).toMatchObject({ value: inr(6_400_000), unvalued: 1 });
  });

  it('name the oldest valuation, and how many are stale', () => {
    const a = property({ id: 'a' });
    const b = property({ id: 'b' });
    const c = property({ id: 'c' });
    const all = propertyFacts(
      listing({
        properties: [a, b, c],
        valuations: [
          valuation({ id: 'va', propertyId: 'a', asOf: '2026-08-12' }),
          valuation({ id: 'vb', propertyId: 'b', asOf: '2025-04-03' }),
          valuation({ id: 'vc', propertyId: 'c', asOf: '2024-10-01' }),
        ],
      }),
      TODAY,
    );
    expect(all.oldest).toEqual({ months: 24, stale: true });
    expect(all.staleCount).toBe(2);
  });

  it('are nothing, and not an error, with no property', () => {
    const all = propertyFacts(listing({}), TODAY);
    expect(all.totals).toEqual([]);
    expect(all.oldest).toBeNull();
  });
});
