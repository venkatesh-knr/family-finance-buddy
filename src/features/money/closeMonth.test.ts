import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Account, AccountBalance, Credit, Transfer } from '../../repo/types.ts';
import {
  accountSteps,
  cardCycles,
  closeFigures,
  isClosed,
  typedDueBalances,
  itemisedFigures,
  lastBalanceMonth,
  lastDayOf,
  monthToClose,
  monthWord,
  monthlyPlanned,
  offersClose,
  parseBalance,
  planYearOf,
} from './closeMonth.ts';

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

describe('closeFigures — a loan payment named for an account (LI-I23, LI-I38)', () => {
  // The ₹32,000 EMI left HDFC, so HDFC closes ₹32,000 lower than the worked example's.
  const afterEmi = balances.map((b) => (b.accountId === 'hdfc' && b.asAt === '2026-10-31' ? balance('hdfc', '2026-10-31', 188_380) : b));
  const emi = { accountId: 'hdfc', amount: r(32_000), date: '2026-10-15' };

  it('is paid to loans and not spent: spent and saved are as in the worked example, and the split adds up', () => {
    const result = closeFigures({ ...base, balances: afterEmi, loanPayments: [emi] });
    const inr = result.status === 'figures' ? result.currencies[0] : undefined;
    expect(inr?.spent).toBe(6_967_000n);
    expect(inr?.paidToLoans).toBe(3_200_000n);
    expect(inr?.saved).toBe(7_358_000n);
    expect(inr?.gapMinor).toBe(0n);
  });

  it('read as none, the same EMI would sit in spent, which is why the close waits for them', () => {
    const result = closeFigures({ ...base, balances: afterEmi });
    expect(result.status === 'figures' && result.currencies[0]?.spent).toBe(6_967_000n + 3_200_000n);
  });

  it('counts a payment of its month only, and not a voided one', () => {
    const other = { ...emi, date: '2026-09-15' };
    const result = closeFigures({ ...base, balances: afterEmi, loanPayments: [other] });
    expect(result.status === 'figures' && result.currencies[0]?.paidToLoans).toBe(0n);
    const voided = closeFigures({ ...base, balances: afterEmi, loanPayments: [{ ...emi, isVoided: true }] });
    expect(voided.status === 'figures' && voided.currencies[0]?.paidToLoans).toBe(0n);
  });

  it('counts none naming no account', () => {
    const result = closeFigures({ ...base, balances: afterEmi, loanPayments: [{ ...emi, accountId: null }] });
    expect(result.status === 'figures' && result.currencies[0]?.paidToLoans).toBe(0n);
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

describe('closeFigures — what the database sums of the money the caller cannot read', () => {
  // The partner's private ₹90,000 salary into HDFC: the screen reads no credit for it, and HDFC's closing balance is ₹90,000 higher with it.
  const raised = balances.map((b) => (b.accountId === 'hdfc' && b.asAt === '2026-10-31' ? { ...b, balance: r(310_380) } : b));
  const hiddenSalary = { currency: 'INR', left: 9_000_000n, outside: 0n, refunds: 0n, cameIn: 9_000_000n };

  it('adds a private credit to what came in and to what left, so spent is the same as when it is read and saved is higher by it', () => {
    const result = closeFigures({ ...base, balances: raised, unreadable: [hiddenSalary] });
    expect(result.status === 'figures' && result.currencies[0]?.spent).toBe(6_967_000n);
    expect(result.status === 'figures' && result.currencies[0]?.saved).toBe(7_358_000n + 9_000_000n);
    expect(result.status === 'figures' && result.currencies[0]?.gapMinor).toBe(0n);
  });

  it('draws no currency in which no account is read: a private credit alone is not a month', () => {
    const usd = { currency: 'USD', left: 0n, outside: 0n, refunds: 0n, cameIn: 0n };
    const result = closeFigures({ ...base, balances: raised, unreadable: [hiddenSalary, usd] });
    expect(result.status === 'figures' && result.currencies.map((c) => c.currency)).toEqual(['INR']);
  });

  it('is read wrong without it', () => {
    const result = closeFigures({ ...base, balances: raised });
    expect(result.status === 'figures' && result.currencies[0]?.spent).not.toBe(6_967_000n);
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

describe('lastBalanceMonth — the month the cash reserve is as at', () => {
  it('is the latest month-end on which an account in use has a balance', () => {
    expect(lastBalanceMonth({ today: '2026-11-14', accounts, balances })).toBe('2026-10');
  });

  it('is still that month when an account was added after the close and has no balance: the reserve then says it counts 3 of 4, and does not say there was no close', () => {
    const added = [...accounts, account('new', 'savings', 'New account')];
    expect(lastBalanceMonth({ today: '2026-11-14', accounts: added, balances })).toBe('2026-10');
  });

  it('is still that month after a partial close, where only some accounts were typed', () => {
    const partial = balances.filter((b) => !(b.asAt === '2026-10-31' && b.accountId !== 'hdfc'));
    expect(lastBalanceMonth({ today: '2026-11-14', accounts, balances: partial })).toBe('2026-10');
  });

  it('looks back past a month with no balance, and finds the one that has', () => {
    expect(lastBalanceMonth({ today: '2026-12-14', accounts, balances })).toBe('2026-10');
  });

  it('is nothing before a first close, and nothing with no account in use', () => {
    expect(lastBalanceMonth({ today: '2026-11-14', accounts, balances: [] })).toBeNull();
    expect(lastBalanceMonth({ today: '2026-11-14', accounts: [], balances })).toBeNull();
  });

  it('does not look further back than a year', () => {
    const old = [balance('hdfc', '2025-01-31', 1)];
    expect(lastBalanceMonth({ today: '2026-11-14', accounts, balances: old })).toBeNull();
  });
});

describe('offersClose — when Close October is offered', () => {
  const input = { month: '2026-10', accounts, balances: [] as AccountBalance[], canRecord: true, moneyReady: true };

  it('is offered to someone who can record, once the credits and moves are read, until every account has a closing balance', () => {
    expect(offersClose(input)).toBe(true);
    expect(offersClose({ ...input, balances })).toBe(false);
  });

  it('is not offered before what it needs has been read, to someone who cannot record, or with no account in use', () => {
    expect(offersClose({ ...input, moneyReady: false })).toBe(false);
    expect(offersClose({ ...input, canRecord: false })).toBe(false);
    expect(offersClose({ ...input, accounts: [] })).toBe(false);
    expect(offersClose({ ...input, accounts: accounts.map((a) => ({ ...a, isArchived: true })) })).toBe(false);
  });
});

describe('the plan a month is measured against', () => {
  const budget = (categoryId: string, cadence: 'monthly' | 'yearly', rupees: number, currency = 'INR') => ({
    id: `bd-${categoryId}-${cadence}`,
    categoryId,
    fy: 2026,
    cadence,
    period: null,
    planned: money(BigInt(rupees) * 100n, currency),
    memberId: null,
  });
  const categories = [
    { id: 'rent', isArchived: false },
    { id: 'food', isArchived: false },
    { id: 'old', isArchived: true },
  ];

  it('is the planning year the month falls in: April to March', () => {
    expect(planYearOf('2026-10')).toBe(2026);
    expect(planYearOf('2027-03')).toBe(2026);
    expect(planYearOf('2027-04')).toBe(2027);
  });

  it('SC section 5 — adds the monthly plans of the categories in use, in the currency asked', () => {
    const budgets = [budget('rent', 'monthly', 40_000), budget('food', 'monthly', 20_000), budget('old', 'monthly', 9_000), budget('food', 'monthly', 500, 'USD')];
    expect(monthlyPlanned(budgets, categories, 'INR')).toBe(6_000_000n);
    expect(monthlyPlanned(budgets, categories, 'USD')).toBe(50_000n);
  });

  it('leaves a yearly plan out of a month, as the Expenses screen does: a twelfth of a school fee is no monthly budget', () => {
    expect(monthlyPlanned([budget('rent', 'monthly', 40_000), budget('food', 'yearly', 120_000)], categories, 'INR')).toBe(4_000_000n);
  });

  it('is nothing, not zero, when no monthly plan is set in the currency', () => {
    expect(monthlyPlanned([budget('food', 'yearly', 120_000)], categories, 'INR')).toBeNull();
    expect(monthlyPlanned([], categories, 'INR')).toBeNull();
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

/**
 * A card that closes on its statement date (docs/design/card-cycles.md sections 2 and 3; CY-I1 to CY-I5, CY-I13, CY-I14). Its window for a month runs from the day after the balance before the
 * statement to the statement dated in the month, and the month waits for that statement. The figures are the design's own worked example (section 9): the card is billed on the 17th, its
 * statements are ₹20,200 on 17 September and ₹28,640 on 17 October, and October is ₹69,670 spent with the payments typed as moves and ₹75,910 without.
 */
describe('a card that closes on its statement date', () => {
  const cycleCard: Account = { ...account('card', 'card', 'HDFC Regalia'), cycleEnds: 'statement' };
  const bankBalances = [
    balance('hdfc', '2026-09-30', 200_000),
    balance('sbi', '2026-09-30', 50_000),
    balance('hdfc', '2026-10-31', 220_380),
    balance('sbi', '2026-10-31', 50_400),
  ];
  const statements = [balance('card', '2026-09-17', 20_200, 'statement'), balance('card', '2026-10-17', 28_640, 'statement')];
  const moveOf = (from: string, to: string, rupees: number, date: string): Transfer => ({ ...transfer, id: `t-${date}`, fromAccountId: from, toAccountId: to, amount: r(rupees), date });
  const ledger = {
    credits: [credit('hdfc', 'salary', 142_000, '2026-10-01'), credit('sbi', 'interest', 1_250, '2026-10-05'), credit('card', 'refund', 1_299, '2026-10-10')],
    holdingMoves: [{ accountId: 'hdfc', direction: 'into' as const, amount: r(55_000), date: '2026-10-12' }],
  };
  const october = (over: Partial<Parameters<typeof closeFigures>[0]> = {}): Parameters<typeof closeFigures>[0] => ({
    month: '2026-10',
    today: '2026-11-13',
    accounts: [account('hdfc', 'savings', 'HDFC'), account('sbi', 'savings', 'SBI'), cycleCard],
    balances: [...bankBalances, ...statements],
    credits: ledger.credits,
    transfers: [],
    holdingMoves: ledger.holdingMoves,
    typed: {},
    ...over,
  });

  it('CY-I2 — takes the cycle from its statements: 18 September to 17 October, due ₹20,200 to ₹28,640', () => {
    const cycles = cardCycles(october());
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ kind: 'cycle', accountId: 'card', from: '2026-09-18', to: '2026-10-17' });
    expect(cycles[0]?.kind === 'cycle' && cycles[0].opening.minor).toBe(2_020_000n);
    expect(cycles[0]?.kind === 'cycle' && cycles[0].closing.minor).toBe(2_864_000n);
  });

  it('CY-I5 — closes October at ₹75,910 spent with its payments skipped (§9 b), counting the card over its cycle and the banks over the month', () => {
    const out = closeFigures(october());
    expect(out.status).toBe('figures');
    const inr = out.status === 'figures' ? out.currencies[0] : undefined;
    expect(inr?.spent).toBe(7_591_000n);
    expect(inr?.saved).toBe(6_734_000n);
    expect(inr?.gapMinor).toBe(0n);
  });

  it('CY-I5 — and at ₹69,670 with the payments typed as moves (§9 a), with ₹6,240 in transit', () => {
    const out = closeFigures(
      october({
        transfers: [moveOf('hdfc', 'card', 12_000, '2026-10-05'), moveOf('hdfc', 'card', 6_240, '2026-10-25')],
      }),
    );
    const inr = out.status === 'figures' ? out.currencies[0] : undefined;
    expect(inr?.spent).toBe(6_967_000n);
    expect(inr?.paymentsInTransit).toBe(624_000n);
    expect(inr?.gapMinor).toBe(0n);
  });

  it('CY-I3 — waits for the statement dated in the month, and names the card', () => {
    const out = closeFigures(october({ balances: bankBalances }));
    expect(out).toMatchObject({ status: 'missing', missing: ['card'] });
    expect(cardCycles(october({ balances: bankBalances }))[0]).toMatchObject({ kind: 'waiting', accountId: 'card' });
  });

  it('CY-I3 — a statement dated in the month is the one the month takes, and the latest of two is the cycle’s end', () => {
    const cycles = cardCycles(october({ balances: [...bankBalances, ...statements, balance('card', '2026-10-25', 30_000, 'statement')] }));
    expect(cycles[0]).toMatchObject({ kind: 'cycle', from: '2026-10-18', to: '2026-10-25' });
  });

  it('CY-I3 — with no statement dated in February and one on 1 March whose balance before it is 31 January, February closes with the card adding nothing and March covers the whole of it', () => {
    const jan = balance('card', '2026-01-31', 10_000, 'statement');
    const mar = balance('card', '2026-03-01', 16_000, 'statement');
    const feb = cardCycles({ ...october({ month: '2026-02', today: '2026-03-10' }), balances: [jan, mar] });
    expect(feb[0]).toMatchObject({ kind: 'none-this-month', accountId: 'card' });
    const march = cardCycles({ ...october({ month: '2026-03', today: '2026-04-10' }), balances: [jan, mar] });
    expect(march[0]).toMatchObject({ kind: 'cycle', from: '2026-02-01', to: '2026-03-01' });

    const closedFeb = closeFigures({
      ...october({ month: '2026-02', today: '2026-03-10' }),
      balances: [balance('hdfc', '2026-01-31', 100_000), balance('sbi', '2026-01-31', 20_000), balance('hdfc', '2026-02-28', 90_000), balance('sbi', '2026-02-28', 20_000), jan, mar],
      credits: [],
      holdingMoves: [],
    });
    expect(closedFeb.status).toBe('figures');
    const inr = closedFeb.status === 'figures' ? closedFeb.currencies[0] : undefined;
    expect(inr?.left.find((l) => l.accountId === 'card')?.leftMinor).toBe(0n);
    expect(inr?.spent).toBe(1_000_000n);
    expect(inr?.gapMinor).toBe(0n);
  });

  it('CY-I4 — a first statement whose printed previous balance is there gives its cycle in full: October starts from the 17 September balance, and September is the one left out', () => {
    expect(cardCycles(october())[0]).toMatchObject({ kind: 'cycle', from: '2026-09-18', to: '2026-10-17' });
    const sep = cardCycles({ ...october({ month: '2026-09', today: '2026-10-05' }) });
    expect(sep[0]).toMatchObject({ kind: 'first-left-out', accountId: 'card', to: '2026-09-17' });
  });

  it('CY-I4 — a first statement with none printed has its first cycle left out: the card adds nothing that month, and the arithmetic still balances', () => {
    const only = [balance('card', '2026-10-17', 28_640, 'statement')];
    expect(cardCycles(october({ balances: [...bankBalances, ...only] }))[0]).toMatchObject({ kind: 'first-left-out', to: '2026-10-17' });
    const out = closeFigures(october({ balances: [...bankBalances, ...only], credits: ledger.credits.filter((c) => c.accountId !== 'card') }));
    const inr = out.status === 'figures' ? out.currencies[0] : undefined;
    expect(inr?.left.find((l) => l.accountId === 'card')?.leftMinor).toBe(0n);
    // The banks' spending less the ₹55,000 into holdings, and the card adds nothing: no refund is credited to it here.
    expect(inr?.spent).toBe(6_747_000n);
    expect(inr?.gapMinor).toBe(0n);
  });

  it('CY-I13 — a typed due and a statement for the same cycle are one figure: the statement’s, whatever day each is dated, and the typed one is not read for the next month', () => {
    const typed = balance('card', '2026-10-17', 29_000, 'typed');
    const stated = balance('card', '2026-10-18', 28_640, 'statement');
    const cycles = cardCycles(october({ balances: [...bankBalances, balance('card', '2026-09-17', 20_200, 'statement'), typed, stated] }));
    expect(cycles[0]).toMatchObject({ kind: 'cycle', from: '2026-09-18', to: '2026-10-18' });
    expect(cycles[0]?.kind === 'cycle' && cycles[0].closing.minor).toBe(2_864_000n);
    // November opens from the statement, not from the typed figure.
    const november = cardCycles(october({ month: '2026-11', today: '2026-12-05', balances: [balance('card', '2026-10-18', 28_640, 'statement'), typed, balance('card', '2026-11-17', 22_400, 'statement')] }));
    expect(november[0]?.kind === 'cycle' && november[0].opening.minor).toBe(2_864_000n);
  });

  it('CY-I13 — a typed due is the cycle’s figure when no statement is dated in the month', () => {
    const cycles = cardCycles(october({ balances: [...bankBalances, balance('card', '2026-09-17', 20_200, 'statement'), balance('card', '2026-10-17', 28_640, 'typed')] }));
    expect(cycles[0]).toMatchObject({ kind: 'cycle', to: '2026-10-17' });
  });

  it('CY-I14 — closed without the card, the card adds nothing and its payments count as spent instead; the statement arriving later corrects the month with nothing reopened', () => {
    const payments = [moveOf('hdfc', 'card', 12_000, '2026-10-05'), moveOf('hdfc', 'card', 6_240, '2026-10-25')];
    const without = october({ balances: bankBalances, transfers: payments, credits: ledger.credits.filter((c) => c.accountId !== 'card'), closedWithout: [{ accountId: 'card', month: '2026-10' }] });
    expect(cardCycles(without)[0]).toMatchObject({ kind: 'closed-without', accountId: 'card' });
    const out = closeFigures(without);
    const inr = out.status === 'figures' ? out.currencies[0] : undefined;
    expect(inr?.left.map((l) => l.accountId)).toEqual(['hdfc', 'sbi']);
    // The banks' spending, the ₹18,240 paid to the card among it, less the ₹55,000 into holdings.
    expect(inr?.spent).toBe(6_747_000n);
    expect(inr?.gapMinor).toBe(0n);

    const later = closeFigures({ ...without, balances: [...bankBalances, ...statements], credits: ledger.credits });
    const corrected = later.status === 'figures' ? later.currencies[0] : undefined;
    expect(cardCycles({ ...without, balances: [...bankBalances, ...statements] })[0]?.kind).toBe('cycle');
    expect(corrected?.spent).toBe(6_967_000n);
  });

  it('CY-I1 — a household with no statement-date card has no cycles and every figure as before', () => {
    const plain = { ...october(), accounts: accounts, balances, credits: [], holdingMoves: [] };
    expect(cardCycles(plain)).toEqual([]);
    const out = closeFigures(plain);
    expect(out.status).toBe('figures');
  });

  it('CY-I15 — takes a cycle’s EMI figures from its statement: converted ₹60,000 is spent in the cycle and −₹60,000 paid to loans', () => {
    const emi: AccountBalance = { ...balance('card', '2026-10-17', 20_200, 'statement'), emiConvertedMinor: 6_000_000n };
    const out = closeFigures(october({ balances: [...bankBalances, balance('card', '2026-09-17', 20_200, 'statement'), emi], credits: [], holdingMoves: [] }));
    const inr = out.status === 'figures' ? out.currencies[0] : undefined;
    expect(inr?.paidToLoans).toBe(-6_000_000n);
    expect(inr?.left.find((l) => l.accountId === 'card')?.leftMinor).toBe(6_000_000n);
    expect(inr?.gapMinor).toBe(0n);
  });

  it('CY-I3 — a month with a waiting card is not closed, and one with its statement is; typing is not how a statement-date card is closed', () => {
    const input = { month: '2026-10', accounts: [account('hdfc', 'savings', 'HDFC'), cycleCard] };
    expect(isClosed({ ...input, balances: [balance('hdfc', '2026-10-31', 1)] })).toBe(false);
    expect(isClosed({ ...input, balances: [balance('hdfc', '2026-10-31', 1), balance('card', '2026-10-17', 1, 'statement')] })).toBe(true);
    expect(isClosed({ ...input, balances: [balance('hdfc', '2026-10-31', 1)], closedWithout: [{ accountId: 'card', month: '2026-10' }] })).toBe(true);
  });
});

/**
 * A due typed for a statement-date card at the close (card-cycles.md 8.2; CY-I13): an amount and the statement's date, which must fall in the month. It is a typed balance on that day, read
 * as the card's cycle until a statement for the same cycle replaces it.
 */
describe('typedDueBalances', () => {
  const card: Account = { ...account('card', 'card', 'HDFC Regalia'), cycleEnds: 'statement' };
  const input = (typed: Record<string, { amount: string; date: string }>) => ({ month: '2026-10', accounts: [card, account('hdfc', 'savings', 'HDFC')], typed });

  it('makes a typed balance on the statement date from an amount and a date in the month', () => {
    const out = typedDueBalances(input({ card: { amount: '28,640', date: '2026-10-17' } }));
    expect(out.problems).toEqual({});
    expect(out.balances).toHaveLength(1);
    expect(out.balances[0]).toMatchObject({ accountId: 'card', asAt: '2026-10-17', source: 'typed' });
    expect(out.balances[0]?.balance.minor).toBe(2_864_000n);
  });

  it('says nothing for a card with nothing typed, and makes nothing for it', () => {
    expect(typedDueBalances(input({ card: { amount: '', date: '' } }))).toEqual({ balances: [], problems: {}, fields: {} });
    expect(typedDueBalances(input({}))).toEqual({ balances: [], problems: {}, fields: {} });
  });

  it('refuses a date outside the month, a date with no amount and an amount with no date, in words', () => {
    expect(typedDueBalances(input({ card: { amount: '28640', date: '2026-11-02' } })).problems['card']).toBe('The statement date must fall in October.');
    // And says which field it is about, so it is shown under that one.
    expect(typedDueBalances(input({ card: { amount: '28640', date: '2026-11-02' } })).fields['card']).toBe('date');
    expect(typedDueBalances(input({ card: { amount: '', date: '2026-10-17' } })).fields['card']).toBe('amount');
    expect(typedDueBalances(input({ card: { amount: 'lots', date: '2026-10-17' } })).fields['card']).toBe('amount');
    expect(typedDueBalances(input({ card: { amount: '28640', date: '' } })).fields['card']).toBe('date');
    expect(typedDueBalances(input({ card: { amount: '', date: '2026-10-17' } })).problems['card']).toBe('Type the amount due.');
    expect(typedDueBalances(input({ card: { amount: '28640', date: '' } })).problems['card']).toBe('Say the date on the statement.');
  });

  it('refuses an amount that is not an amount, and makes nothing of it', () => {
    const out = typedDueBalances(input({ card: { amount: 'lots', date: '2026-10-17' } }));
    expect(out.balances).toEqual([]);
    expect(out.problems['card']).toBeDefined();
  });

  it('makes nothing for an account that is not a statement-date card, which is closed by its balance on the last day', () => {
    expect(typedDueBalances(input({ hdfc: { amount: '1000', date: '2026-10-17' } })).balances).toEqual([]);
  });

  it('CY-I13 — a typed due makes the card’s cycle, from what was typed, and a statement for the same cycle then replaces it', () => {
    const typed = typedDueBalances(input({ card: { amount: '28,640', date: '2026-10-17' } })).balances;
    const base = { month: '2026-10', accounts: [card], balances: [balance('card', '2026-09-17', 20_200, 'statement'), ...typed] };
    const cycle = cardCycles(base)[0];
    expect(cycle).toMatchObject({ kind: 'cycle', from: '2026-09-18', to: '2026-10-17' });
    expect(cycle?.kind === 'cycle' && cycle.sources).toEqual({ opening: 'statement', closing: 'typed' });
    const replaced = cardCycles({ ...base, balances: [...base.balances, balance('card', '2026-10-18', 28_700, 'statement')] })[0];
    expect(replaced).toMatchObject({ kind: 'cycle', to: '2026-10-18' });
    expect(replaced?.kind === 'cycle' && replaced.sources.closing).toBe('statement');
  });
});
