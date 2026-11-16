import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Disposal, FixedIncomeTerms, Lot, PpfEntryRow } from '../../repo/types.ts';
import { fixedIncomeMovesOf, holdingMovesOf, type OpeningCost } from './holdingMoves.ts';

const r = (value: number, currency = 'INR') => money(BigInt(value) * 100n, currency);

const lot = (over: Partial<Lot> = {}): Lot => ({
  id: 'l-1',
  holdingId: 'h-1',
  acquiredOn: '2026-10-12',
  quantity: '10',
  cost: r(55_000),
  kind: 'purchase',
  note: null,
  paidVia: { accountId: 'hdfc', amount: r(55_000) },
  ...over,
});
const sale = (over: Partial<Disposal> = {}): Disposal => ({
  id: 'd-1',
  holdingId: 'h-1',
  disposedOn: '2026-10-20',
  quantity: '2',
  proceeds: r(10_000),
  kind: 'sale',
  note: null,
  paidVia: { accountId: 'sbi', amount: r(10_000) },
  ...over,
});
const ppf = (over: Partial<PpfEntryRow> = {}): PpfEntryRow => ({
  id: 'p-1',
  holdingId: 'h-2',
  date: '2026-10-05',
  amount: r(12_500),
  note: null,
  isVoided: false,
  paidVia: { accountId: 'hdfc', amount: r(12_500) },
  ...over,
});

describe('holdingMovesOf — the entries that named an account, as the month close reads them (LI-I30)', () => {
  it('is a purchase into a holding, a sale out of one, and a PPF payment in and a withdrawal out, each on its own day', () => {
    const result = holdingMovesOf({
      lots: [lot()],
      disposals: [sale()],
      ppf: [ppf(), ppf({ id: 'p-2', date: '2026-10-25', amount: r(-5_000), paidVia: { accountId: 'sbi', amount: r(5_000) } })],
    });
    expect(result.moves).toEqual([
      { accountId: 'hdfc', direction: 'into', amount: r(55_000), date: '2026-10-12' },
      { accountId: 'sbi', direction: 'out', amount: r(10_000), date: '2026-10-20' },
      { accountId: 'hdfc', direction: 'into', amount: r(12_500), date: '2026-10-05' },
      { accountId: 'sbi', direction: 'out', amount: r(5_000), date: '2026-10-25' },
    ]);
    expect(result.unnamed).toBe(0);
  });

  it("is in the account's own currency: a dollar purchase paid from a rupee account moves the rupees that left it", () => {
    const abroad = lot({ cost: r(100, 'USD'), paidVia: { accountId: 'hdfc', amount: r(8_500) } });
    expect(holdingMovesOf({ lots: [abroad], disposals: [], ppf: [] }).moves).toEqual([
      { accountId: 'hdfc', direction: 'into', amount: r(8_500), date: '2026-10-12' },
    ]);
  });

  it('counts what named no account, and moves nothing for it', () => {
    const result = holdingMovesOf({
      lots: [lot({ paidVia: null }), lot({ id: 'l-2' })],
      disposals: [sale({ paidVia: null })],
      ppf: [ppf({ paidVia: null })],
    });
    expect(result.moves).toHaveLength(1);
    expect(result.unnamed).toBe(3);
  });

  it('leaves out what moved no money: a bonus issue, a split, a transfer, a gift, an ESOP vest, and a voided PPF entry', () => {
    const result = holdingMovesOf({
      lots: [lot({ kind: 'bonus', cost: r(0), paidVia: null }), lot({ id: 'l-3', kind: 'gift', paidVia: null }), lot({ id: 'l-4', kind: 'esop', paidVia: null })],
      disposals: [sale({ kind: 'gift', paidVia: null }), sale({ id: 'd-2', kind: 'transfer', paidVia: null })],
      ppf: [ppf({ isVoided: true, paidVia: null })],
    });
    expect(result.moves).toEqual([]);
    expect(result.unnamed).toBe(0);
  });

  it('counts a redemption and a maturity as taken out, like a sale', () => {
    const kinds = ['redemption', 'maturity'] as const;
    const result = holdingMovesOf({ lots: [], disposals: kinds.map((kind, i) => sale({ id: `d-${String(i)}`, kind })), ppf: [] });
    expect(result.moves.map((m) => m.direction)).toEqual(['out', 'out']);
  });
});

describe('fixedIncomeMovesOf — a deposit, a bond and an opening cost, as the month close reads them (LI-I32 to LI-I35)', () => {
  const terms = (over: Partial<FixedIncomeTerms> = {}): FixedIncomeTerms => ({
    holdingId: 'd-1',
    householdId: 'hh',
    kind: 'deposit',
    principal: r(100_000),
    ratePct: '7.000',
    start: '2026-10-05',
    maturity: '2027-10-05',
    compounding: 'yearly',
    couponFrequency: null,
    rating: null,
    repayMode: null,
    autoRenew: false,
    renewalRatePct: null,
    institution: null,
    accountLast4: null,
    note: null,
    paidVia: { accountId: 'hdfc', amount: r(100_000) },
    payoutAccountId: null,
    ...over,
  });
  const opening = (over: Partial<OpeningCost> = {}): OpeningCost => ({
    holdingId: 'o-1',
    openedOn: '2026-10-08',
    cost: r(40_000),
    accountId: 'hdfc',
    hasLot: false,
    ...over,
  });
  const base = { renewals: [], openings: [], recurring: new Set<string>(), from: '2026-10-01', to: '2026-10-31', today: '2026-11-02' } as const;

  it('is a principal into a holding on the day the deposit started, from the account that named it', () => {
    const result = fixedIncomeMovesOf({ ...base, terms: [terms()] });
    expect(result.moves).toEqual([{ accountId: 'hdfc', direction: 'into', amount: r(100_000), date: '2026-10-05' }]);
    expect(result.unnamed).toBe(0);
  });

  it('is what left a rupee account for a deposit in dollars, in rupees', () => {
    const abroad = terms({ principal: r(1_000, 'USD'), paidVia: { accountId: 'hdfc', amount: r(85_000) } });
    expect(fixedIncomeMovesOf({ ...base, terms: [abroad] }).moves).toEqual([
      { accountId: 'hdfc', direction: 'into', amount: r(85_000), date: '2026-10-05' },
    ]);
  });

  it('counts a principal that named no account, and moves nothing for it', () => {
    const result = fixedIncomeMovesOf({ ...base, terms: [terms({ paidVia: null })] });
    expect(result.moves).toEqual([]);
    expect(result.unnamed).toBe(1);
  });

  it('leaves out a deposit that started in another month, and a recurring deposit, which invested keeps out of every part of it', () => {
    const result = fixedIncomeMovesOf({
      ...base,
      terms: [terms({ holdingId: 'sept', start: '2026-09-30' }), terms({ holdingId: 'rd-1' }), terms({ holdingId: 'nov', start: '2026-11-01' })],
      recurring: new Set(['rd-1']),
    });
    expect(result.moves).toEqual([]);
    expect(result.unnamed).toBe(0);
  });

  it('is a payout out of a holding on the day it paid out, at what it paid, into the account that named it', () => {
    const matured = terms({ start: '2025-10-05', maturity: '2026-10-05', payoutAccountId: 'sbi', paidVia: null });
    const result = fixedIncomeMovesOf({ ...base, terms: [matured] });
    const payout = result.moves.find((move) => move.direction === 'out');
    expect(payout?.accountId).toBe('sbi');
    expect(payout?.date).toBe('2026-10-05');
    expect(payout?.amount.currency).toBe('INR');
    // 7% for a year on ₹1,00,000, compounded yearly: ₹1,07,000.
    expect(payout?.amount.minor).toBe(10_700_000n);
  });

  it('counts a payout that named no account, and moves nothing for it', () => {
    const matured = terms({ start: '2025-10-05', maturity: '2026-10-05', payoutAccountId: null, paidVia: null });
    const result = fixedIncomeMovesOf({ ...base, terms: [matured] });
    expect(result.moves).toEqual([]);
    expect(result.unnamed).toBe(1);
  });

  it('does not count a payout before the deposit has matured, nor one in another month', () => {
    const later = terms({ start: '2026-09-05', maturity: '2027-09-05', payoutAccountId: 'sbi', paidVia: null });
    const earlier = terms({ holdingId: 'e', start: '2025-08-05', maturity: '2026-08-05', payoutAccountId: 'sbi', paidVia: null });
    const result = fixedIncomeMovesOf({ ...base, terms: [later, earlier] });
    expect(result.moves).toEqual([]);
    expect(result.unnamed).toBe(0);
  });

  it('is the cost of a holding opened with one and no purchase, on its opening day, from the account that named it', () => {
    const result = fixedIncomeMovesOf({ ...base, terms: [], openings: [opening()] });
    expect(result.moves).toEqual([{ accountId: 'hdfc', direction: 'into', amount: r(40_000), date: '2026-10-08' }]);
  });

  it('leaves out an opening cost with a purchase, with terms, in another month, of a recurring deposit, or with no cost', () => {
    const result = fixedIncomeMovesOf({
      ...base,
      terms: [terms({ holdingId: 'has-terms', start: '2026-09-01', paidVia: null })],
      openings: [
        opening({ holdingId: 'a', hasLot: true }),
        opening({ holdingId: 'has-terms' }),
        opening({ holdingId: 'b', openedOn: '2026-09-30' }),
        opening({ holdingId: 'rd-2' }),
        opening({ holdingId: 'c', cost: null }),
      ],
      recurring: new Set(['rd-2']),
    });
    expect(result.moves).toEqual([]);
    expect(result.unnamed).toBe(0);
  });

  it('counts an opening cost that named no account', () => {
    const result = fixedIncomeMovesOf({ ...base, terms: [], openings: [opening({ accountId: null })] });
    expect(result.moves).toEqual([]);
    expect(result.unnamed).toBe(1);
  });
});
