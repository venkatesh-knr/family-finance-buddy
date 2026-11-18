import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Credit, Expense, Member } from '../../repo/types.ts';
import { ownMonthSpend } from './contributorMonth.ts';

/**
 * A contributor's month (docs/design/spending-capture.md section 11.4 and the MoneyMonthStated board, screen 7): what they spent themselves, itemised by them, in each
 * currency. They read no household total, so nothing here is a household's.
 */
const ME = { id: 'm-me', displayName: 'Me' } as unknown as Member;
const OTHER = { id: 'm-other', displayName: 'Other' } as unknown as Member;

const entry = (over: Partial<Expense> & { amount: ReturnType<typeof money>; date: string }): Expense =>
  ({ id: `e-${over.date}-${String(over.amount.minor)}`, householdId: 'h', member: ME, categoryId: null, payee: null, method: null, note: null, isVoided: false, visibility: 'household', capturedVia: 'typed', ...over }) as Expense;

describe('what a contributor spent in a month', () => {
  const october = { start: '2026-10-01', end: '2026-10-31' };

  it('adds their own entries in the month, in the currency each was entered in', () => {
    const out = ownMonthSpend({
      expenses: [entry({ amount: money(1_000_00n, 'INR'), date: '2026-10-03' }), entry({ amount: money(420_00n, 'INR'), date: '2026-10-30' }), entry({ amount: money(10_00n, 'USD'), date: '2026-10-05' })],
      memberId: ME.id,
      bounds: october,
      currency: 'INR',
    });
    expect(out).toEqual([money(1_420_00n, 'INR'), money(10_00n, 'USD')]);
  });

  it('leaves out a voided entry, another member’s, and one outside the month', () => {
    const out = ownMonthSpend({
      expenses: [
        entry({ amount: money(500_00n, 'INR'), date: '2026-10-03', isVoided: true }),
        entry({ amount: money(700_00n, 'INR'), date: '2026-10-04', member: OTHER }),
        entry({ amount: money(900_00n, 'INR'), date: '2026-09-30' }),
        entry({ amount: money(100_00n, 'INR'), date: '2026-11-01' }),
        entry({ amount: money(300_00n, 'INR'), date: '2026-10-31' }),
      ],
      memberId: ME.id,
      bounds: october,
      currency: 'INR',
    });
    expect(out).toEqual([money(300_00n, 'INR')]);
  });

  it('puts the read currency first, and shows it as nothing when nothing was spent in it', () => {
    expect(ownMonthSpend({ expenses: [entry({ amount: money(10_00n, 'USD'), date: '2026-10-05' })], memberId: ME.id, bounds: october, currency: 'INR' })).toEqual([
      money(0n, 'INR'),
      money(10_00n, 'USD'),
    ]);
    expect(ownMonthSpend({ expenses: [], memberId: ME.id, bounds: october, currency: 'INR' })).toEqual([money(0n, 'INR')]);
  });
});

describe('LI-I3 — a refund the contributor recorded takes away from what they spent, as it does on the owner’s card', () => {
  const october = { start: '2026-10-01', end: '2026-10-31' };
  const refund = (minor: bigint, date: string, over: Partial<Credit> = {}): Credit =>
    ({ id: `c-${date}-${String(minor)}`, householdId: 'h', memberId: ME.id, accountId: null, category: 'refund', amount: money(minor, 'INR'), date, visibility: 'household', source: 'typed', ruleId: null, dueDate: null, payer: null, note: null, isVoided: false, ...over }) as Credit;
  const spend = [entry({ amount: money(10_000_00n, 'INR'), date: '2026-10-03' })];

  it('subtracts their refunds in the month, per currency', () => {
    expect(ownMonthSpend({ expenses: spend, refunds: [refund(2_000_00n, '2026-10-20')], memberId: ME.id, bounds: october, currency: 'INR' })).toEqual([money(8_000_00n, 'INR')]);
  });

  it('counts only a refund that is theirs, in the month and not voided, and never another kind of credit', () => {
    const refunds = [
      refund(100_00n, '2026-10-20', { isVoided: true }),
      refund(200_00n, '2026-10-21', { memberId: OTHER.id }),
      refund(400_00n, '2026-09-30'),
      refund(800_00n, '2026-10-22', { category: 'salary' } as Partial<Credit>),
    ];
    expect(ownMonthSpend({ expenses: spend, refunds, memberId: ME.id, bounds: october, currency: 'INR' })).toEqual([money(10_000_00n, 'INR')]);
  });

  it('keeps a currency’s line when its refunds cancel the spending out, as a line of nothing', () => {
    expect(ownMonthSpend({ expenses: spend, refunds: [refund(10_000_00n, '2026-10-20')], memberId: ME.id, bounds: october, currency: 'INR' })).toEqual([money(0n, 'INR')]);
  });
});
