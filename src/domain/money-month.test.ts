import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { closedMonthFigures, openMonthFigures, type MonthAccount, type MonthInput } from './money-month.ts';

/**
 * The month's money: came in, spent and saved (docs/design/ledger-income.md section 4; spending-capture.md section 2).
 *
 * The worked example is the design's own (LI-I6, LI-I7, LI-I23): Salary ₹1,42,000 to HDFC, Interest ₹1,250 to SBI, a ₹1,299 refund
 * and an ₹18,240 payment to the card, ₹55,000 into holdings from HDFC; HDFC up ₹20,380, SBI up ₹400, the card's due up ₹2,200.
 * Money is integer minor units: ₹1,42,000 is 14,200,000.
 */

const r = (value: number, currency = 'INR') => money(BigInt(value) * 100n, currency);
const paise = (value: number): bigint => BigInt(value) * 100n;

const accounts = (hdfcClosing = 220_380): MonthAccount[] => [
  { id: 'hdfc', type: 'savings', currency: 'INR', opening: r(200_000), closing: r(hdfcClosing) },
  { id: 'sbi', type: 'savings', currency: 'INR', opening: r(50_000), closing: r(50_400) },
  { id: 'card', type: 'card', currency: 'INR', opening: r(10_000), closing: r(12_200) },
];

const example = (over: Partial<MonthInput> = {}): MonthInput => ({
  month: '2026-10',
  today: '2026-11-13',
  accounts: accounts(),
  credits: [
    { accountId: 'hdfc', category: 'salary', amount: r(142_000), date: '2026-10-01' },
    { accountId: 'sbi', category: 'interest', amount: r(1_250), date: '2026-10-05' },
    { accountId: 'card', category: 'refund', amount: r(1_299), date: '2026-10-07' },
  ],
  transfers: [{ fromId: 'hdfc', toId: 'card', amount: r(18_240), date: '2026-10-10' }],
  holdingMoves: [{ accountId: 'hdfc', direction: 'into', amount: r(55_000), date: '2026-10-12' }],
  loanPayments: [],
  ...over,
});

function closed(input: MonthInput) {
  const result = closedMonthFigures(input);
  if (!result.ok) throw new Error(`not closed: ${result.reason}`);
  const inr = result.currencies.find((c) => c.currency === 'INR');
  if (inr === undefined) throw new Error('no INR');
  return inr;
}

describe('closedMonthFigures', () => {
  it('LI-I6 — what left each account: HDFC ₹1,21,620, SBI ₹850 and the card ₹21,739, ₹1,44,209 in all', () => {
    const month = closed(example());
    expect(month.left.map((l) => [l.accountId, l.leftMinor])).toEqual([
      ['hdfc', paise(121_620)],
      ['sbi', paise(850)],
      ['card', paise(21_739)],
    ]);
    expect(month.leftTotal).toBe(paise(144_209));
  });

  it('LI-I6 — spent is ₹1,44,209 less ₹18,240 moved, ₹55,000 into holdings and the ₹1,299 refund: ₹69,670', () => {
    const month = closed(example());
    expect(month.spent).toBe(paise(69_670));
    expect(month.ownTransfers).toBe(paise(18_240));
    expect(month.putIntoHoldings).toBe(paise(55_000));
    expect(month.refunds).toBe(paise(1_299));
  });

  it('saved is came in less spent: ₹1,43,250 less ₹69,670 is ₹73,580', () => {
    const month = closed(example());
    expect(month.cameIn).toBe(paise(143_250));
    expect(month.saved).toBe(paise(73_580));
  });

  it('and splits as ₹55,000 invested and ₹18,580 to the cash reserve, which add up to saved to the paisa', () => {
    const month = closed(example());
    expect(month.invested).toBe(paise(55_000));
    expect(month.cashReserveChange).toBe(paise(18_580));
    expect(month.paidToLoans).toBe(0n);
    expect(month.split).toEqual({ spent: paise(69_670), invested: paise(55_000), paidToLoans: 0n, toCashReserve: paise(18_580) });
    expect(month.gapMinor).toBe(0n);
  });

  it('LI-I23 — with a ₹32,000 EMI from HDFC (HDFC then down ₹11,620) spent is unchanged and saved is ₹55,000 + ₹32,000 − ₹13,420', () => {
    const month = closed(
      example({
        accounts: accounts(188_380),
        loanPayments: [{ accountId: 'hdfc', amount: r(32_000), date: '2026-10-15' }],
      }),
    );
    expect(month.spent).toBe(paise(69_670));
    expect(month.paidToLoans).toBe(paise(32_000));
    expect(month.cashReserveChange).toBe(-paise(13_420));
    expect(month.saved).toBe(paise(73_580));
    expect(month.split).toEqual({ spent: paise(69_670), invested: paise(55_000), paidToLoans: paise(32_000), toCashReserve: -paise(13_420) });
    expect(month.gapMinor).toBe(0n);
  });

  it('LI-I2 — an own transfer, a card payment and an SIP change neither came in nor spent: removing them changes neither', () => {
    const base = closed(example());
    // The same month with no card payment and no SIP: HDFC is then ₹73,240 higher, and the card's due ends ₹18,240 higher because nothing paid it.
    const without = closed(
      example({
        accounts: [
          { id: 'hdfc', type: 'savings', currency: 'INR', opening: r(200_000), closing: r(220_380 + 73_240) },
          { id: 'sbi', type: 'savings', currency: 'INR', opening: r(50_000), closing: r(50_400) },
          { id: 'card', type: 'card', currency: 'INR', opening: r(10_000), closing: r(12_200 + 18_240) },
        ],
        transfers: [],
        holdingMoves: [],
      }),
    );
    expect(without.cameIn).toBe(base.cameIn);
    expect(without.spent).toBe(base.spent);
  });

  it('LI-I3 — a refund takes ₹1,299 off spent in its month and is not in came in, and in the next month it changes the next month alone', () => {
    const withRefund = closed(example());
    const noRefund = closed(
      example({
        accounts: [
          { id: 'hdfc', type: 'savings', currency: 'INR', opening: r(200_000), closing: r(220_380) },
          { id: 'sbi', type: 'savings', currency: 'INR', opening: r(50_000), closing: r(50_400) },
          { id: 'card', type: 'card', currency: 'INR', opening: r(10_000), closing: r(12_200 + 1_299) },
        ],
        credits: [
          { accountId: 'hdfc', category: 'salary', amount: r(142_000), date: '2026-10-01' },
          { accountId: 'sbi', category: 'interest', amount: r(1_250), date: '2026-10-05' },
        ],
      }),
    );
    expect(noRefund.spent - withRefund.spent).toBe(paise(1_299));
    expect(withRefund.cameIn).toBe(noRefund.cameIn);

    // The same refund dated in October is not in November: a month counts only the days it has.
    const november = closedMonthFigures(
      example({ month: '2026-11', today: '2026-12-05', accounts: accounts().map((acct) => ({ ...acct, opening: acct.closing })) }),
    );
    expect(november.ok && november.currencies[0]).toMatchObject({ refunds: 0n, cameIn: 0n, spent: 0n });
  });

  it('a take-out of a holding paid into an account is money in, and is taken from invested', () => {
    const month = closed(
      example({
        accounts: accounts(220_380 + 10_000),
        holdingMoves: [
          { accountId: 'hdfc', direction: 'into', amount: r(55_000), date: '2026-10-12' },
          { accountId: 'hdfc', direction: 'out', amount: r(10_000), date: '2026-10-20' },
        ],
      }),
    );
    expect(month.invested).toBe(paise(45_000));
    expect(month.gapMinor).toBe(0n);
  });

  it('keeps currencies apart: a dollar account is its own month and is never added to the rupees', () => {
    const result = closedMonthFigures(
      example({
        accounts: [...accounts(), { id: 'usd', type: 'savings', currency: 'USD', opening: r(1_000, 'USD'), closing: r(1_150, 'USD') }],
        credits: [...example().credits, { accountId: 'usd', category: 'dividend', amount: r(200, 'USD'), date: '2026-10-09' }],
      }),
    );
    expect(result.ok && result.currencies.map((c) => c.currency)).toEqual(['INR', 'USD']);
    const usd = result.ok ? result.currencies.find((c) => c.currency === 'USD') : undefined;
    expect(usd).toMatchObject({ cameIn: 20_000n, spent: 5_000n, saved: 15_000n });
  });

  it('a month that has not ended cannot be closed', () => {
    expect(closedMonthFigures(example({ today: '2026-10-31' }))).toEqual({ ok: false, reason: 'not-ended', missing: [] });
    expect(closedMonthFigures(example({ today: '2026-11-01' })).ok).toBe(true);
  });

  it('names the accounts with no opening or closing balance, and derives nothing from the rest', () => {
    const incomplete = [{ ...accounts()[0], closing: null } as MonthAccount, accounts()[1] as MonthAccount, { ...accounts()[2], opening: null } as MonthAccount];
    expect(closedMonthFigures(example({ accounts: incomplete }))).toEqual({ ok: false, reason: 'missing-balances', missing: ['hdfc', 'card'] });
  });
});

describe('openMonthFigures', () => {
  it('an open month shows what has come in and what is spent so far, and no saved: after the close', () => {
    const open = openMonthFigures({
      month: '2026-11',
      credits: [
        { accountId: 'hdfc', category: 'salary', amount: r(142_000), date: '2026-11-01' },
        { accountId: 'card', category: 'refund', amount: r(1_299), date: '2026-11-03' },
      ],
      itemised: [r(48_000)],
    });
    expect(open).toEqual([
      { currency: 'INR', cameIn: paise(142_000), refunds: paise(1_299), spentSoFar: paise(48_000) - paise(1_299), saved: null },
    ]);
  });

  it('a month with credits and no spending yet still shows, and spending in a currency with no credits shows too', () => {
    const open = openMonthFigures({ month: '2026-11', credits: [], itemised: [r(500), r(20, 'USD')] });
    expect(open.map((o) => [o.currency, o.cameIn, o.spentSoFar])).toEqual([
      ['INR', 0n, paise(500)],
      ['USD', 0n, paise(20)],
    ]);
  });
});
