import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Account, AccountBalance, Credit, Transfer } from '../../repo/types.ts';
import { closeFigures } from '../money/closeMonth.ts';
import { coverMonthlyExpenses, closedSpend } from './coverFigures.ts';

/**
 * Months of cover reads the close (the owner, 23 November 2026; card-cycles.md 8.4). The close's own worked example is the household here: HDFC, SBI and the ICICI card, closed at month end,
 * October spending ₹69,670 by the balances (LI-I6). The test that matters is that the two cannot disagree: a household that only ever closes at month end gets, for the month, the very figure
 * the close shows as spent, and not the itemised sum beside it.
 */

const r = (rupees: number) => money(BigInt(rupees) * 100n, 'INR');

const account = (id: string, type: Account['type'], name: string): Account => ({
  id,
  householdId: 'h-1',
  memberId: 'm-1',
  name,
  institution: null,
  type,
  currency: 'INR',
  last4: null,
  isForeign: false,
  openedOn: null,
  isArchived: false,
});

const balance = (accountId: string, asAt: string, rupees: number): AccountBalance => ({
  id: `b-${accountId}-${asAt}`,
  householdId: 'h-1',
  accountId,
  asAt,
  balance: r(rupees),
  source: 'typed',
  note: null,
});

const credit = (accountId: string | null, category: Credit['category'], rupees: number, date: string): Credit => ({
  id: `c-${category}-${date}`,
  householdId: 'h-1',
  memberId: 'm-1',
  accountId,
  category,
  amount: r(rupees),
  date,
  visibility: 'household',
  source: 'typed',
  ruleId: null,
  dueDate: null,
  payer: null,
  note: null,
  isVoided: false,
});

const transfer: Transfer = {
  id: 't-1',
  householdId: 'h-1',
  fromAccountId: 'hdfc',
  toAccountId: 'card',
  amount: r(18_240),
  date: '2026-10-10',
  source: 'typed',
  note: null,
  isVoided: false,
};

const octoberInput = {
  month: '2026-10',
  today: '2026-11-14',
  accounts: [account('hdfc', 'savings', 'HDFC'), account('sbi', 'savings', 'SBI'), account('card', 'card', 'ICICI card')],
  balances: [
    balance('hdfc', '2026-09-30', 200_000),
    balance('sbi', '2026-09-30', 50_000),
    balance('card', '2026-09-30', 10_000),
    balance('hdfc', '2026-10-31', 220_380),
    balance('sbi', '2026-10-31', 50_400),
    balance('card', '2026-10-31', 12_200),
  ],
  credits: [credit('hdfc', 'salary', 142_000, '2026-10-01'), credit('sbi', 'interest', 1_250, '2026-10-05'), credit('card', 'refund', 1_299, '2026-10-07')],
  transfers: [transfer],
  holdingMoves: [{ accountId: 'hdfc', direction: 'into' as const, amount: r(55_000), date: '2026-10-12' }],
  typed: {},
};

/** What the close itself shows as spent, read from the close and not from the step under test. */
const closeShowsSpent = () => {
  const figures = closeFigures(octoberInput);
  if (figures.status !== 'figures') throw new Error('the worked example closes');
  const inr = figures.currencies[0];
  if (inr === undefined) throw new Error('rupees');
  return inr.spent;
};

describe('coverMonthlyExpenses', () => {
  it('a household that closes at month end reads, for the month, the close’s spent — and not what was itemised beside it', () => {
    expect(closeShowsSpent()).toBe(6_967_000n);
    // From the balances and the ledger, through the step the hook makes, to the figure cover is divided by.
    const spent = closedSpend(octoberInput);
    expect(spent).toEqual([r(69_670)]);
    const out = coverMonthlyExpenses({
      window: ['2026-10'],
      display: 'INR',
      rates: [],
      closed: new Map([['2026-10', spent ?? []]]),
      // A statement for a month closed from balances is not used (SC-I17), and what was itemised is a part of the month, never added to it.
      stated: [],
      itemised: new Map([['2026-10', [r(41_000)]]]),
    });
    expect(out).toEqual({ ok: true, monthlyExpenses: [{ month: '2026-10', spent: money(closeShowsSpent(), 'INR') }] });
  });

  it('is nothing at all where the balances are not all in, so the month is read from the next source and is not named as from balances', () => {
    expect(closedSpend({ ...octoberInput, balances: octoberInput.balances.filter((each) => each.asAt !== '2026-10-31') })).toBeNull();
  });

  it('a month the close says cost nothing, or less than nothing, is read as nothing from the close, and is never replaced by what was itemised under the name of the balances', () => {
    const lessThanNothing = {
      ...octoberInput,
      // Money came in that no record explains: the balances rose by more than came in, so the close reads spent below nothing.
      balances: octoberInput.balances.map((each) => (each.accountId === 'hdfc' && each.asAt === '2026-10-31' ? { ...each, balance: r(900_000) } : each)),
    };
    const figures = closeFigures(lessThanNothing);
    expect(figures.status === 'figures' && (figures.currencies[0]?.spent ?? 0n) < 0n).toBe(true);
    expect(closedSpend(lessThanNothing)).toEqual([r(0)]);
  });

  it('a month with no close is its stated figure, and then what was itemised, as it was', () => {
    const out = coverMonthlyExpenses({
      window: ['2026-08', '2026-09', '2026-10'],
      display: 'INR',
      rates: [],
      closed: new Map([['2026-10', [r(70_000)]]]),
      stated: [{ month: '2026-09', amount: r(60_000) }],
      itemised: new Map([
        ['2026-08', [r(50_000)]],
        ['2026-09', [r(10_000)]],
        ['2026-10', [r(10_000)]],
      ]),
    });
    expect(out).toEqual({
      ok: true,
      monthlyExpenses: [
        { month: '2026-08', spent: r(50_000) },
        { month: '2026-09', spent: r(60_000) },
        { month: '2026-10', spent: r(70_000) },
      ],
    });
  });

  it('says which currency has no rate, and adds nothing, when one cannot be converted', () => {
    const out = coverMonthlyExpenses({
      window: ['2026-10'],
      display: 'INR',
      rates: [],
      closed: new Map([['2026-10', [money(5_000n, 'USD')]]]),
      stated: [],
      itemised: new Map(),
    });
    expect(out).toEqual({ ok: false, missing: 'USD' });
  });
});
