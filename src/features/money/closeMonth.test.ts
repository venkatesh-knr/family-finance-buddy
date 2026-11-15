import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Account, AccountBalance, Credit, Transfer } from '../../repo/types.ts';
import { accountSteps, closeFigures, isClosed, itemisedFigures, lastDayOf, monthToClose, monthWord, parseBalance } from './closeMonth.ts';

/**
 * The month close (docs/design/spending-capture.md sections 2 and 6; ledger-income.md section 4; the MonthClose board): balances at the month's
 * ends, and from them what was spent. The worked example is the design's own (LI-I6): HDFC opens ₹2,00,000 and closes ₹2,20,380, SBI opens
 * ₹50,000 and closes ₹50,400, the ICICI card's due goes from ₹10,000 to ₹12,200; ₹1,42,000 salary into HDFC, ₹1,250 interest into SBI, a ₹1,299
 * refund on the card, ₹18,240 from HDFC to the card, ₹55,000 into holdings. Spent comes to ₹69,670 and saved to ₹73,580.
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
  visibility: 'household',
  isArchived: false,
});

const accounts = [account('hdfc', 'savings', 'HDFC'), account('sbi', 'savings', 'SBI'), account('card', 'card', 'ICICI card')];

const balance = (accountId: string, asAt: string, rupees: number, source: AccountBalance['source'] = 'typed'): AccountBalance => ({
  id: `b-${accountId}-${asAt}-${source}`,
  householdId: 'h-1',
  accountId,
  asAt,
  balance: r(rupees),
  source,
  note: null,
});

const balances = [
  balance('hdfc', '2026-09-30', 200_000),
  balance('sbi', '2026-09-30', 50_000),
  balance('card', '2026-09-30', 10_000),
  balance('hdfc', '2026-10-31', 220_380),
  balance('sbi', '2026-10-31', 50_400),
  balance('card', '2026-10-31', 12_200),
];

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

const credits = [credit('hdfc', 'salary', 142_000, '2026-10-01'), credit('sbi', 'interest', 1_250, '2026-10-05'), credit('card', 'refund', 1_299, '2026-10-07')];

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

// The ₹55,000 into holdings from HDFC, which the screen does not read yet and so passes none of: the test gives it, as the design's example does.
const holdingMoves = [{ accountId: 'hdfc', direction: 'into' as const, amount: r(55_000), date: '2026-10-12' }];

const base = { month: '2026-10', today: '2026-11-14', accounts, balances, credits, transfers: [transfer], holdingMoves, typed: {} } as const;

describe('lastDayOf and monthWord', () => {
  it('finds the last calendar day of a month, leap years included', () => {
    expect(lastDayOf('2026-10')).toBe('2026-10-31');
    expect(lastDayOf('2026-11')).toBe('2026-11-30');
    expect(lastDayOf('2028-02')).toBe('2028-02-29');
    expect(lastDayOf('2026-02')).toBe('2026-02-28');
  });

  it('names a month', () => {
    expect(monthWord('2026-10')).toBe('October');
  });
});

describe('monthToClose — the prompt from the 1st', () => {
  it('is the month before the one it is, from the 1st', () => {
    expect(monthToClose('2026-11-01')).toBe('2026-10');
    expect(monthToClose('2026-11-14')).toBe('2026-10');
    expect(monthToClose('2027-01-03')).toBe('2026-12');
  });
});

describe('closeFigures — the worked example', () => {
  it('LI-I6 — spent is ₹69,670 and saved ₹73,580, from the balances at the two ends of the month', () => {
    const result = closeFigures(base);
    expect(result.status).toBe('figures');
    if (result.status !== 'figures') return;
    const inr = result.currencies[0];
    expect(inr?.spent).toBe(6_967_000n);
    expect(inr?.saved).toBe(7_358_000n);
    expect(inr?.gapMinor).toBe(0n);
  });

  it('opens from the last day of the month before and closes on the last day of the month, a statement beating a typed figure of that day', () => {
    const withStatement = [...balances, balance('hdfc', '2026-10-31', 230_380, 'statement')];
    const result = closeFigures({ ...base, balances: withStatement });
    expect(result.status === 'figures' && result.currencies[0]?.spent).toBe(5_967_000n);
  });

  it('LI-I6 — a credit with no account is spent outside the accounts and is in came in, leaving saved as it was', () => {
    const result = closeFigures({ ...base, credits: [...credits, credit(null, 'other_income', 5_000, '2026-10-20')] });
    expect(result.status === 'figures' && result.currencies[0]?.spent).toBe(6_967_000n + 500_000n);
    expect(result.status === 'figures' && result.currencies[0]?.saved).toBe(7_358_000n);
  });

  it('says a month that has not ended cannot be closed', () => {
    expect(closeFigures({ ...base, today: '2026-10-31' }).status).toBe('not-ended');
  });
});

describe('closeFigures — what is typed and what is missing', () => {
  const withoutClosing = balances.filter((b) => !(b.asAt === '2026-10-31' && b.accountId === 'card'));

  it('names an account with no closing balance, so the screen asks for it, and gives no figure', () => {
    const result = closeFigures({ ...base, balances: withoutClosing });
    expect(result).toEqual({ status: 'missing', missing: ['card'] });
  });

  it('uses a closing balance typed on the screen for an account that has none yet, and the figure follows', () => {
    const result = closeFigures({ ...base, balances: withoutClosing, typed: { card: { closing: r(12_200) } } });
    expect(result.status === 'figures' && result.currencies[0]?.spent).toBe(6_967_000n);
  });

  it('asks for the opening as well at the first close, when there is none at the month before', () => {
    const first = balances.filter((b) => b.asAt === '2026-10-31');
    expect(closeFigures({ ...base, balances: first })).toEqual({ status: 'missing', missing: ['hdfc', 'sbi', 'card'] });
    const typed = { hdfc: { opening: r(200_000) }, sbi: { opening: r(50_000) }, card: { opening: r(10_000) } };
    expect(closeFigures({ ...base, balances: first, typed }).status).toBe('figures');
  });

  it('leaves an archived account out: it is not in a close', () => {
    const archived = accounts.map((a) => (a.id === 'sbi' ? { ...a, isArchived: true } : a));
    const result = closeFigures({ ...base, accounts: archived, balances: balances.filter((b) => b.accountId !== 'sbi') });
    expect(result.status).toBe('figures');
  });

  it('is nothing to close for a household with no account in use: itemised, and said so elsewhere', () => {
    expect(closeFigures({ ...base, accounts: [] })).toEqual({ status: 'no-accounts' });
  });
});

describe('accountSteps — one row each, with the closing balance as the only input', () => {
  it('gives each account its opening, its closing, what came in and what was left, and whether the opening still has to be typed', () => {
    const rows = accountSteps(base);
    expect(rows.map((row) => [row.accountId, row.title, row.openingNeeded, row.closingNeeded])).toEqual([
      ['hdfc', 'HDFC', false, false],
      ['sbi', 'SBI', false, false],
      ['card', 'ICICI card', false, false],
    ]);
    expect(rows[0]).toMatchObject({ opening: r(200_000), closing: r(220_380), moneyIn: 14_200_000n, left: 12_162_000n });
    expect(rows[2]).toMatchObject({ opening: r(10_000), closing: r(12_200), left: 2_173_900n });
  });

  it('marks an opening that is not there as needed at the first close, and a closing that is not there as needed', () => {
    const rows = accountSteps({ ...base, balances: balances.filter((b) => b.accountId !== 'card') });
    expect(rows[2]).toMatchObject({ openingNeeded: true, closingNeeded: true, opening: null, closing: null, left: null });
  });
});

describe('itemisedFigures — what was itemised, with the month’s refunds taken off as spent has them', () => {
  const expense = (rupees: number, isVoided = false) => ({ amount: r(rupees), isVoided });

  it('adds the month’s expenses that are not voided, per currency', () => {
    expect(itemisedFigures([expense(400), expense(600), expense(999, true)], [], '2026-10').get('INR')).toBe(100_000n);
  });

  it('LI-I3 — takes a refund off, so a purchase refunded into the same account is not a gap', () => {
    const refund = credit('hdfc', 'refund', 1_000, '2026-10-08');
    expect(itemisedFigures([expense(1_000)], [refund], '2026-10').get('INR')).toBe(0n);
  });

  it('leaves income, a voided refund and another month’s refund out of it', () => {
    const others = [
      credit('hdfc', 'salary', 142_000, '2026-10-01'),
      { ...credit('hdfc', 'refund', 500, '2026-10-09'), isVoided: true },
      credit('hdfc', 'refund', 700, '2026-09-30'),
    ];
    expect(itemisedFigures([expense(1_000)], others, '2026-10').get('INR')).toBe(100_000n);
  });
});

describe('an archived account stays in the closes of the months it was in use', () => {
  const archivedInNovember = accounts.map((a) => (a.id === 'sbi' ? { ...a, isArchived: true, archivedOn: '2026-11-03' } : a));
  const archivedInOctober = accounts.map((a) => (a.id === 'sbi' ? { ...a, isArchived: true, archivedOn: '2026-10-20' } : a));
  const archivedInSeptember = accounts.map((a) => (a.id === 'sbi' ? { ...a, isArchived: true, archivedOn: '2026-09-15' } : a));

  it('ledger-income 1a — is in October’s close when it was archived in November or in October, and out of it from the month after', () => {
    expect(accountSteps({ ...base, accounts: archivedInNovember }).map((s) => s.accountId)).toContain('sbi');
    expect(accountSteps({ ...base, accounts: archivedInOctober }).map((s) => s.accountId)).toContain('sbi');
    expect(accountSteps({ ...base, accounts: archivedInSeptember }).map((s) => s.accountId)).not.toContain('sbi');
  });

  it('keeps its spending in the figure, as the unarchived account would have it', () => {
    const result = closeFigures({ ...base, accounts: archivedInNovember });
    expect(result.status === 'figures' && result.currencies[0]?.spent).toBe(6_967_000n);
  });

  it('is counted by isClosed in the months it was in use', () => {
    const noSbi = balances.filter((b) => !(b.accountId === 'sbi' && b.asAt === '2026-10-31'));
    expect(isClosed({ month: '2026-10', accounts: archivedInNovember, balances: noSbi })).toBe(false);
    expect(isClosed({ month: '2026-10', accounts: archivedInSeptember, balances: noSbi })).toBe(true);
  });
});

describe('parseBalance — a balance typed at the close', () => {
  it('reads an amount, and nothing for a blank: an account not typed yet is not an account with nothing in it', () => {
    expect(parseBalance('2,20,380', 'INR')).toEqual({ ok: true, balance: r(220_380) });
    expect(parseBalance('', 'INR')).toEqual({ ok: true, balance: null });
  });

  it('reads nothing as nothing: an account at zero is a balance', () => {
    expect(parseBalance('0', 'INR')).toEqual({ ok: true, balance: r(0) });
  });

  it('says what is wrong with what is not an amount, and with a minus sign', () => {
    expect(parseBalance('a lot', 'INR').ok).toBe(false);
    expect(parseBalance('-100', 'INR').ok).toBe(false);
  });
});

describe('isClosed — a month is closed when every account in use has a closing balance on its last day', () => {
  it('is closed when all have, and not when one has not', () => {
    expect(isClosed({ month: '2026-10', accounts, balances })).toBe(true);
    expect(isClosed({ month: '2026-10', accounts, balances: balances.filter((b) => !(b.accountId === 'card' && b.asAt === '2026-10-31')) })).toBe(false);
  });

  it('is not closed with no account in use: nothing was closed from balances', () => {
    expect(isClosed({ month: '2026-10', accounts: [], balances })).toBe(false);
  });

  it('leaves an archived account out of it', () => {
    const archived = accounts.map((a) => (a.id === 'card' ? { ...a, isArchived: true } : a));
    expect(isClosed({ month: '2026-10', accounts: archived, balances: balances.filter((b) => b.accountId !== 'card') })).toBe(true);
  });
});
