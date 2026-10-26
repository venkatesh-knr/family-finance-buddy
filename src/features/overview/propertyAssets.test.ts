import { describe, expect, it } from 'vitest';
import { assetHistory } from '../../domain/history.ts';
import { netWorth } from '../../domain/fx.ts';
import { allocationByKind, assetTotals } from '../../domain/networth.ts';
import { money } from '../../lib/money.ts';
import type { Household, Member, Property, PropertyListing, PropertyValuation } from '../../repo/types.ts';
import { debtAtShare, propertyAssets, splitForCorpus } from './propertyAssets.ts';

/**
 * Property in the shapes net worth reads, on the prototype's figures: a house bought for 42,00,000 with 2,94,000 of
 * duty, a plot, and a plot held half and half. Worked by hand in rupees.
 */

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const TODAY = '2026-10-26';

const venkat: Member = { id: 'm-1', displayName: 'Venkat', colour: 'c1', isArchived: false };
const meera: Member = { id: 'm-2', displayName: 'Meera', colour: 'c2', isArchived: false };

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
  members: [venkat, meera],
  properties: [],
  improvements: [],
  valuations: [],
  loans: [],
  ...over,
});

const household = { scope: 'household', mine: 'm-1' } as const;

describe('a property as a holding of the kind property', () => {
  const house = property({ id: 'house' });
  const base = listing({ properties: [house], valuations: [valuation({ id: 'v1', propertyId: 'house' })] });

  it('is one holding in the property kind, in its own currency, owed a valuation from the day it was bought', () => {
    const { holdings } = propertyAssets(base, household, TODAY);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      id: 'house',
      kind: 'property',
      currency: 'INR',
      openedOn: '2019-03-01',
      isArchived: false,
      costIsShort: false,
    });
  });

  it('carries the cost basis as the cost, capital work included and a repair or a voided entry not', () => {
    const withWork = listing({
      ...base,
      improvements: [
        { id: 'w1', propertyId: 'house', date: '2022-11-10', description: 'Kitchen', amount: inr(280_000), isCapital: true, isVoided: false },
        { id: 'w2', propertyId: 'house', date: '2026-02-10', description: 'Paint', amount: inr(45_000), isCapital: false, isVoided: false },
        { id: 'w3', propertyId: 'house', date: '2023-01-01', description: 'Voided', amount: inr(900_000), isCapital: true, isVoided: true },
      ],
    });
    // 42,00,000 + 2,94,000 + 2,80,000.
    expect(propertyAssets(withWork, household, TODAY).holdings[0]?.cost).toEqual(inr(4_774_000));
  });

  it('reads a valuation as the household share of it, dated as it was, and the cost as the share too', () => {
    const half = property({ id: 'half', sharePct: '50', purchaseCost: inr(300_000), stampDuty: inr(50_000) });
    const l = listing({ properties: [half], valuations: [valuation({ id: 'v2', propertyId: 'half', value: inr(2_700_000) })] });
    const a = propertyAssets(l, household, TODAY);
    expect(a.valuations).toEqual([{ holdingId: 'half', date: '2026-08-12', amount: inr(1_350_000) }]);
    // 3,50,000 of cost, half of it.
    expect(a.holdings[0]?.cost).toEqual(inr(175_000));
  });

  it('leaves out a valuation dated after today, which is not yet a reading', () => {
    const l = listing({ properties: [house], valuations: [valuation({ id: 'v9', propertyId: 'house', asOf: '2027-01-01' })] });
    expect(propertyAssets(l, household, TODAY).valuations).toEqual([]);
    expect(propertyAssets(l, household, TODAY).unvalued).toBe(1);
  });

  it('counts the properties still held that nobody has valued, and not the archived', () => {
    const l = listing({
      properties: [house, property({ id: 'plot', kind: 'plot' }), property({ id: 'gone', isArchived: true, archivedOn: '2026-01-01' })],
      valuations: [valuation({ id: 'v1', propertyId: 'house' })],
    });
    expect(propertyAssets(l, household, TODAY).unvalued).toBe(1);
  });

  it('keeps an archived property, with the day it was archived, so the months before still count', () => {
    const l = listing({ properties: [property({ id: 'gone', isArchived: true, archivedOn: '2026-01-01' })] });
    expect(propertyAssets(l, household, TODAY).holdings[0]).toMatchObject({ isArchived: true, archivedOn: '2026-01-01' });
  });

  it('shows only one’s own in a personal view', () => {
    const hers = property({ id: 'hers', member: meera });
    const l = listing({
      properties: [house, hers],
      valuations: [valuation({ id: 'v1', propertyId: 'house' }), valuation({ id: 'v2', propertyId: 'hers' })],
    });
    const mine = propertyAssets(l, { scope: 'mine', mine: 'm-1' }, TODAY);
    expect(mine.holdings.map((h) => h.id)).toEqual(['house']);
    expect(mine.valuations.map((v) => v.holdingId)).toEqual(['house']);
    expect(propertyAssets(l, household, TODAY).holdings).toHaveLength(2);
  });
});

describe('what the existing calculations make of it', () => {
  const house = property({ id: 'house' });
  const half = property({ id: 'half', kind: 'plot', sharePct: '50', purchaseCost: inr(300_000), stampDuty: inr(50_000) });
  const l = listing({
    properties: [house, half],
    valuations: [
      valuation({ id: 'v1', propertyId: 'house', value: inr(6_400_000) }),
      valuation({ id: 'v2', propertyId: 'half', value: inr(2_700_000) }),
    ],
  });
  const { holdings, valuations } = propertyAssets(l, household, TODAY);

  it('adds the household share of the values into a total: 64,00,000 + 13,50,000', () => {
    const [total] = assetTotals({ holdings, valuations });
    expect(total?.value).toEqual(inr(7_750_000));
    // The gain is the share of the value against the share of the cost: 77,50,000 less (44,94,000 + 1,75,000).
    expect(total?.invested).toEqual(inr(4_669_000));
    expect(total?.gain).toEqual(inr(3_081_000));
  });

  it('makes property a row of the allocation, with its share of the whole', () => {
    const rows = allocationByKind({ holdings, valuations, currency: 'INR' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'property', value: inr(7_750_000), share: 1 });
  });

  it('adds into net worth with the debts subtracted: 77,50,000 less a 20,00,000 loan', () => {
    const [total] = assetTotals({ holdings, valuations });
    const worth = netWorth({
      assets: total === undefined ? [] : [total.value],
      debts: [inr(2_000_000)],
      base: 'INR',
      rates: [],
      on: TODAY,
    });
    expect(worth).toEqual({ ok: true, amount: inr(5_750_000) });
  });

  it('draws the history from the valuations, and says where a property stopped it: bought in 2019 and first valued in August 2026', () => {
    const only = listing({ properties: [house], valuations: [valuation({ id: 'v1', propertyId: 'house', asOf: '2026-08-12' })] });
    const a = propertyAssets(only, household, TODAY);
    const history = assetHistory({
      holdings: [
        ...a.holdings.map((h) => ({
          id: h.id,
          currency: h.currency,
          openedOn: h.openedOn,
          isArchived: h.isArchived,
          archivedOn: h.archivedOn,
        })),
        // A fund read every month since May, which is what the property is measured against.
        { id: 'fund', currency: 'INR', openedOn: '2026-01-01', isArchived: false, archivedOn: null },
      ],
      readings: [
        ...a.valuations.map((v) => ({ holdingId: v.holdingId, date: v.date, amount: v.amount })),
        { holdingId: 'fund', date: '2026-05-31', amount: inr(100_000) },
        { holdingId: 'fund', date: '2026-06-30', amount: inr(110_000) },
        { holdingId: 'fund', date: '2026-07-31', amount: inr(120_000) },
        { holdingId: 'fund', date: '2026-08-31', amount: inr(130_000) },
        { holdingId: 'fund', date: '2026-09-30', amount: inr(140_000) },
      ],
      rates: [],
      display: 'INR',
      asOf: TODAY,
    });
    // Before 12 August the property was owed a valuation and has none, so the line begins where it was first valued and
    // says so, which is what a person can fix by recording an earlier valuation.
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.points[0]?.date).toBe('2026-08-31');
    expect(history.points[0]?.total).toEqual(inr(6_530_000));
    expect(history.limitedBy).toMatchObject({ reason: 'unread', holdingIds: ['house'] });
  });
});

describe('the loan on a part-owned property', () => {
  it('is taken at the property share, and whole for a property held entirely', () => {
    const l = listing({
      properties: [
        property({ id: 'full', linkedLiabilityId: 'loan-a' }),
        property({ id: 'half', sharePct: '50', linkedLiabilityId: 'loan-b' }),
      ],
    });
    const { loanShares, linkedLoanIds } = propertyAssets(l, household, TODAY);
    expect(debtAtShare(inr(2_000_000), 'loan-a', loanShares)).toEqual(inr(2_000_000));
    expect(debtAtShare(inr(2_000_000), 'loan-b', loanShares)).toEqual(inr(1_000_000));
    expect(debtAtShare(inr(2_000_000), 'loan-unlinked', loanShares)).toEqual(inr(2_000_000));
    expect(debtAtShare(inr(2_000_000), null, loanShares)).toEqual(inr(2_000_000));
    expect([...linkedLoanIds].sort()).toEqual(['loan-a', 'loan-b']);
  });

  it('is taken once, at the first property, when two are linked to it', () => {
    const l = listing({
      properties: [
        property({ id: 'one', sharePct: '50', linkedLiabilityId: 'loan-a' }),
        property({ id: 'two', sharePct: '100', linkedLiabilityId: 'loan-a' }),
      ],
    });
    expect(propertyAssets(l, household, TODAY).loanShares.get('loan-a')).toBe('50');
  });

  it('is taken at the share in a personal view too, when the property it is shared against is another member', () => {
    const l = listing({
      properties: [property({ id: 'hers', member: meera, sharePct: '50', linkedLiabilityId: 'loan-a' })],
    });
    const mine = propertyAssets(l, { scope: 'mine', mine: 'm-1' }, TODAY);
    // The property is not in his view and the loan can be, so the loan is still the household's half.
    expect(mine.holdings).toEqual([]);
    expect(debtAtShare(inr(2_000_000), 'loan-a', mine.loanShares)).toEqual(inr(1_000_000));
  });

  it('is not linked once the property is archived: the loan is the household whole again', () => {
    const l = listing({
      properties: [property({ id: 'gone', sharePct: '50', linkedLiabilityId: 'loan-a', isArchived: true, archivedOn: '2026-01-01' })],
    });
    const { loanShares, linkedLoanIds } = propertyAssets(l, household, TODAY);
    expect(loanShares.size).toBe(0);
    expect(linkedLoanIds.size).toBe(0);
  });
});

describe('what the Overview says about the valuations', () => {
  const house = property({ id: 'house', label: 'House' });

  it('names a property whose latest valuation is older than the household months, with how old', () => {
    const l = listing({
      properties: [house, property({ id: 'plot', label: 'Plot', kind: 'plot' })],
      valuations: [
        valuation({ id: 'v1', propertyId: 'house', asOf: '2025-04-03' }),
        valuation({ id: 'v2', propertyId: 'plot', asOf: '2026-08-12' }),
      ],
    });
    expect(propertyAssets(l, household, TODAY).stale).toEqual([{ name: 'House', months: 18, livedIn: false }]);
    expect(propertyAssets({ ...l, staleMonths: 24 }, household, TODAY).stale).toEqual([]);
  });

  it('does not call a property stale that has no valuation: that is unvalued, a different thing', () => {
    const a = propertyAssets(listing({ properties: [house] }), household, TODAY);
    expect(a.stale).toEqual([]);
    expect(a.unvalued).toBe(1);
  });

  it('counts the unvalued by currency, so a per-currency total can say which', () => {
    const abroad = property({ id: 'abroad', currency: 'USD' });
    const a = propertyAssets(listing({ properties: [house, abroad] }), household, TODAY);
    expect([...a.unvaluedByCurrency.entries()].sort()).toEqual([['INR', 1], ['USD', 1]]);
  });

  it('gives the newest valuation on or before today, which is the day a total with property in it is as at', () => {
    const l = listing({
      properties: [house],
      valuations: [
        valuation({ id: 'v1', propertyId: 'house', asOf: '2026-03-01' }),
        valuation({ id: 'v2', propertyId: 'house', asOf: '2026-10-20' }),
        valuation({ id: 'v3', propertyId: 'house', asOf: '2027-01-01' }),
      ],
    });
    expect(propertyAssets(l, household, TODAY).newestValuation).toBe('2026-10-20');
    expect(propertyAssets(listing({ properties: [house] }), household, TODAY).newestValuation).toBeNull();
  });
});

describe('the FIRE corpus holds a property that is not lived in, and leaves out a home that is', () => {
  const home = property({ id: 'home', label: 'Home', isSelfOccupied: true, linkedLiabilityId: 'loan-home' });
  const plot = property({ id: 'plot', label: 'Plot', kind: 'plot', linkedLiabilityId: 'loan-plot', purchaseCost: inr(1_000_000), stampDuty: inr(0) });
  const l = listing({
    properties: [home, plot],
    valuations: [
      valuation({ id: 'v1', propertyId: 'home', value: inr(6_400_000) }),
      valuation({ id: 'v2', propertyId: 'plot', value: inr(1_500_000) }),
    ],
  });
  const assets = propertyAssets(l, household, TODAY);

  it('splits the two by whether the family lives in it', () => {
    const { counted, leftOut } = splitForCorpus(assets);
    expect(counted.holdings.map((h) => h.id)).toEqual(['plot']);
    expect(leftOut.holdings.map((h) => h.id)).toEqual(['home']);
    expect(counted.valuations.map((v) => v.holdingId)).toEqual(['plot']);
    expect(leftOut.valuations.map((v) => v.holdingId)).toEqual(['home']);
  });

  it('counts 15,00,000 of the plot in the corpus and leaves out 64,00,000 of the home', () => {
    const { counted, leftOut } = splitForCorpus(assets);
    expect(assetTotals(counted)[0]?.value).toEqual(inr(1_500_000));
    expect(assetTotals(leftOut)[0]?.value).toEqual(inr(6_400_000));
  });

  it("names the loan on the home as left out and not the loan on the plot, which stays subtracted with its property", () => {
    expect([...assets.livedInLoanIds]).toEqual(['loan-home']);
    expect([...assets.linkedLoanIds].sort()).toEqual(['loan-home', 'loan-plot']);
  });

  it('says a property that is not lived in and has no valuation is what the corpus is short of, and a home is not', () => {
    const none = propertyAssets(listing({ properties: [home, plot] }), household, TODAY);
    expect(none.unvalued).toBe(2);
    expect(none.unvaluedForCorpus).toBe(1);
  });

  it('takes the loan on a home from the lived-in set in a personal view too, whoever the home is held by', () => {
    const hers = propertyAssets(
      listing({ properties: [property({ id: 'hers', member: meera, isSelfOccupied: true, linkedLiabilityId: 'loan-hers' })] }),
      { scope: 'mine', mine: 'm-1' },
      TODAY,
    );
    expect(hers.holdings).toEqual([]);
    expect([...hers.livedInLoanIds]).toEqual(['loan-hers']);
  });
});
