import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Disposal, Lot, PpfEntryRow } from '../../repo/types.ts';
import { holdingMovesOf } from './holdingMoves.ts';

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
