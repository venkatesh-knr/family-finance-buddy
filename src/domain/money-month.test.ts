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

  it('PF-C10 — a transfer between the household’s own accounts is in neither came in nor spent: the same month without it, its two accounts each ₹18,240 apart, has the same totals', () => {
    const base = closed(example());
    const without = closed(
      example({
        accounts: [
          { id: 'hdfc', type: 'savings', currency: 'INR', opening: r(200_000), closing: r(220_380 + 18_240) },
          { id: 'sbi', type: 'savings', currency: 'INR', opening: r(50_000), closing: r(50_400) },
          { id: 'card', type: 'card', currency: 'INR', opening: r(10_000), closing: r(12_200 + 18_240) },
        ],
        transfers: [],
      }),
    );
    expect(without.cameIn).toBe(base.cameIn);
    expect(without.spent).toBe(base.spent);
  });

  it('SC-I4 — a move from one savings account to another, a card payment and money into a holding each leave spent where it was', () => {
    const base = closed(example());
    // ₹5,000 moved from HDFC to SBI: HDFC ends ₹5,000 lower and SBI ₹5,000 higher.
    const moved = closed(
      example({
        accounts: [
          { id: 'hdfc', type: 'savings', currency: 'INR', opening: r(200_000), closing: r(220_380 - 5_000) },
          { id: 'sbi', type: 'savings', currency: 'INR', opening: r(50_000), closing: r(50_400 + 5_000) },
          { id: 'card', type: 'card', currency: 'INR', opening: r(10_000), closing: r(12_200) },
        ],
        transfers: [
          { fromId: 'hdfc', toId: 'card', amount: r(18_240), date: '2026-10-10' },
          { fromId: 'hdfc', toId: 'sbi', amount: r(5_000), date: '2026-10-11' },
        ],
      }),
    );
    expect(moved.spent).toBe(base.spent);
    expect(moved.cameIn).toBe(base.cameIn);
    // A further ₹10,000 into a holding from HDFC: HDFC ends ₹10,000 lower.
    const invested = closed(
      example({
        accounts: accounts(220_380 - 10_000),
        holdingMoves: [
          { accountId: 'hdfc', direction: 'into', amount: r(55_000), date: '2026-10-12' },
          { accountId: 'hdfc', direction: 'into', amount: r(10_000), date: '2026-10-20' },
        ],
      }),
    );
    expect(invested.spent).toBe(base.spent);
    expect(invested.putIntoHoldings).toBe(paise(65_000));
    // The card payment is the ₹18,240 transfer to the card in the base month, which the PF-C10 test removes with no change to spent.
    expect(base.spent).toBe(paise(69_670));
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

  describe('a credit with no account (LI-I4, LI-I6): came in outside the accounts you added', () => {
    const outsideSalary = { accountId: null, category: 'other_income', amount: r(20_000), date: '2026-10-20' } as const;

    it('LI-I6 — counts in came in and is added to spent as money outside the accounts: ₹20,000 more of each', () => {
      const month = closed(example({ credits: [...example().credits, outsideSalary] }));
      expect(month.outside).toBe(paise(20_000));
      expect(month.cameIn).toBe(paise(163_250));
      expect(month.spent).toBe(paise(89_670));
    });

    it('LI-I6 — leaves saved and its split exactly as they were, to the paisa', () => {
      const month = closed(example({ credits: [...example().credits, outsideSalary] }));
      expect(month.saved).toBe(paise(73_580));
      expect(month.split).toEqual({ spent: paise(89_670), invested: paise(55_000), paidToLoans: 0n, toCashReserve: paise(18_580) });
      expect(month.gapMinor).toBe(0n);
    });

    it('is nothing when every credit names an account', () => {
      expect(closed(example()).outside).toBe(0n);
    });

    it('a refund with no account takes off the spent it was added to: it is in refunds and in outside, and spent does not move', () => {
      const month = closed(example({ credits: [...example().credits, { accountId: null, category: 'refund', amount: r(500), date: '2026-10-21' }] }));
      expect(month.refunds).toBe(paise(1_799));
      expect(month.outside).toBe(paise(500));
      expect(month.spent).toBe(paise(69_670));
      expect(month.cameIn).toBe(paise(143_250));
      expect(month.gapMinor).toBe(0n);
    });

    it('is the month it was credited in: one from the month before or after changes nothing', () => {
      const month = closed(
        example({
          credits: [
            ...example().credits,
            { ...outsideSalary, date: '2026-09-30' },
            { ...outsideSalary, date: '2026-11-01' },
          ],
        }),
      );
      expect(month.outside).toBe(0n);
      expect(month.cameIn).toBe(paise(143_250));
    });

    it('stays in its own currency: dollars that came in outside the rupee accounts are their own month, saved nothing', () => {
      const result = closedMonthFigures(example({ credits: [...example().credits, { accountId: null, category: 'dividend', amount: r(100, 'USD'), date: '2026-10-09' }] }));
      expect(result.ok && result.currencies.map((c) => c.currency)).toEqual(['INR', 'USD']);
      const usd = result.ok ? result.currencies.find((c) => c.currency === 'USD') : undefined;
      expect(usd).toMatchObject({ cameIn: 10_000n, outside: 10_000n, spent: 10_000n, saved: 0n, gapMinor: 0n, left: [] });
      const inr = result.ok ? result.currencies.find((c) => c.currency === 'INR') : undefined;
      expect(inr).toMatchObject({ cameIn: paise(143_250), saved: paise(73_580) });
    });

    it('with no accounts at all there is no close from balances: the month is worked out from what was entered, elsewhere', () => {
      const result = closedMonthFigures(example({ accounts: [], credits: [outsideSalary], transfers: [], holdingMoves: [] }));
      expect(result).toEqual({ ok: true, currencies: [] });
    });
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

describe('closedMonthFigures — what the caller cannot read, added as the database sums it', () => {
  it('adds a private credit into a readable account to what came in and to what left it, so saved is unchanged by it', () => {
    const base = closed(example());
    // The partner's ₹90,000 salary into HDFC, which the screen cannot read: the account's balance rose by it, so its money in is short by it.
    const hidden = { currency: 'INR', left: paise(90_000), outside: 0n, refunds: 0n, cameIn: paise(90_000) };
    const input = example({ accounts: accounts(310_380) });
    const month = closed({ ...input, unreadable: [hidden] });
    expect(month.spent).toBe(base.spent);
    expect(month.cameIn).toBe(base.cameIn + paise(90_000));
    expect(month.saved).toBe(base.saved + paise(90_000));
    expect(month.gapMinor).toBe(0n);
  });

  it('adds money into a holding that the screen cannot see, so spent and invested are the same as when it is read (LI-I30)', () => {
    // The ₹55,000 went into another member's private holding. The screen reads no entry for it, and the database sums it.
    const hidden = { currency: 'INR', left: 0n, outside: 0n, refunds: 0n, cameIn: 0n, intoHoldings: paise(55_000), outOfHoldings: 0n };
    const month = closed({ ...example({ holdingMoves: [] }), unreadable: [hidden] });
    expect(month.spent).toBe(paise(69_670));
    expect(month.putIntoHoldings).toBe(paise(55_000));
    expect(month.invested).toBe(paise(55_000));
    expect(month.saved).toBe(paise(73_580));
    expect(month.gapMinor).toBe(0n);
  });

  it('adds proceeds paid into a readable account from a holding the screen cannot see: money in to it, and out of the holding (LI-I30)', () => {
    // ₹10,000 from a private holding reached HDFC, so its closing is ₹10,000 higher and what left it is the same.
    const hidden = { currency: 'INR', left: paise(10_000), outside: 0n, refunds: 0n, cameIn: 0n, intoHoldings: 0n, outOfHoldings: paise(10_000) };
    const month = closed({ ...example({ accounts: accounts(230_380) }), unreadable: [hidden] });
    expect(month.spent).toBe(paise(69_670));
    expect(month.takenOutOfHoldings).toBe(paise(10_000));
    expect(month.invested).toBe(paise(45_000));
    expect(month.cashReserveChange).toBe(paise(18_580 + 10_000));
    expect(month.gapMinor).toBe(0n);
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

/**
 * A card that closes on its statement date (docs/design/card-cycles.md; CY-I2, CY-I5, CY-I6, CY-I15). Its money in, transfers in and refunds are counted in the window of its statement,
 * and every other account over the calendar month. The worked example is `card-cycles.md` section 9: the card is billed on the 17th, with its statement of 17 September at ₹20,200 and of
 * 17 October at ₹28,640, and in the window 18 September to 17 October it bought ₹21,739, received a ₹12,000 payment on 5 October and a ₹1,299 refund on 10 October.
 */
describe('a card that closes on its statement date', () => {
  const cycleCard = (over: Partial<MonthAccount> = {}): MonthAccount => ({
    id: 'card',
    type: 'card',
    currency: 'INR',
    opening: r(20_200),
    closing: r(28_640),
    window: { from: '2026-09-18', to: '2026-10-17' },
    ...over,
  });
  const banks = (): MonthAccount[] => [
    { id: 'hdfc', type: 'savings', currency: 'INR', opening: r(200_000), closing: r(220_380) },
    { id: 'sbi', type: 'savings', currency: 'INR', opening: r(50_000), closing: r(50_400) },
  ];
  const october = (over: Partial<MonthInput> = {}): MonthInput => ({
    month: '2026-10',
    today: '2026-11-13',
    accounts: [...banks(), cycleCard()],
    credits: [
      { accountId: 'hdfc', category: 'salary', amount: r(142_000), date: '2026-10-01' },
      { accountId: 'sbi', category: 'interest', amount: r(1_250), date: '2026-10-05' },
      { accountId: 'card', category: 'refund', amount: r(1_299), date: '2026-10-10' },
    ],
    transfers: [
      { fromId: 'hdfc', toId: 'card', amount: r(12_000), date: '2026-10-05' },
      { fromId: 'hdfc', toId: 'card', amount: r(6_240), date: '2026-10-25' },
    ],
    holdingMoves: [{ accountId: 'hdfc', direction: 'into', amount: r(55_000), date: '2026-10-12' }],
    loanPayments: [],
    ...over,
  });

  it('CY-I5 — with the payments typed as moves (§9 a), spent is ₹69,670 as in the calendar example, and ₹6,240 is in transit', () => {
    const month = closed(october());
    expect(month.left.map((l) => [l.accountId, l.leftMinor])).toEqual([
      ['hdfc', paise(121_620)],
      ['sbi', paise(850)],
      ['card', paise(21_739)],
    ]);
    expect(month.leftTotal).toBe(paise(144_209));
    expect(month.ownTransfers).toBe(paise(18_240));
    expect(month.spent).toBe(6_967_000n);
    expect(month.cameIn).toBe(paise(143_250));
    expect(month.saved).toBe(7_358_000n);
    expect(month.cashReserveChange).toBe(paise(12_340));
    expect(month.paymentsInTransit).toBe(paise(6_240));
    expect(month.split).toEqual({ spent: paise(69_670), invested: paise(55_000), paidToLoans: 0n, toCashReserve: paise(12_340), paymentsInTransit: paise(6_240) });
    expect(month.gapMinor).toBe(0n);
  });

  it('CY-I5 — with the payments skipped (§9 b), spent is ₹75,910: the 25 October payment, made after the statement date, reads as spent this month', () => {
    const month = closed(october({ transfers: [] }));
    expect(month.left.find((l) => l.accountId === 'card')?.leftMinor).toBe(paise(9_739));
    expect(month.spent).toBe(7_591_000n);
    expect(month.saved).toBe(paise(67_340));
    expect(month.paymentsInTransit).toBe(0n);
    expect(month.split).toEqual({ spent: paise(75_910), invested: paise(55_000), paidToLoans: 0n, toCashReserve: paise(12_340) });
    expect(month.gapMinor).toBe(0n);
  });

  it('CY-I2 — a refund dated 10 October is in October’s window and one dated 20 October is in the next: the card’s own window, not the calendar month, counts it', () => {
    const late = closed(
      october({
        credits: [
          { accountId: 'hdfc', category: 'salary', amount: r(142_000), date: '2026-10-01' },
          { accountId: 'sbi', category: 'interest', amount: r(1_250), date: '2026-10-05' },
          { accountId: 'card', category: 'refund', amount: r(1_299), date: '2026-10-20' },
        ],
        transfers: [],
      }),
    );
    expect(late.refunds).toBe(0n);
    expect(late.left.find((l) => l.accountId === 'card')?.leftMinor).toBe(paise(8_440));
    expect(late.gapMinor).toBe(0n);
  });

  it('CY-I2 — a transfer’s two legs fall in the window of their own account: the 25 October out-leg in October, the in-leg in the card’s next window', () => {
    const november = closed({
      month: '2026-11',
      today: '2026-12-05',
      accounts: [
        { id: 'hdfc', type: 'savings', currency: 'INR', opening: r(220_380), closing: r(220_380) },
        { id: 'sbi', type: 'savings', currency: 'INR', opening: r(50_400), closing: r(50_400) },
        cycleCard({ opening: r(28_640), closing: r(22_400), window: { from: '2026-10-18', to: '2026-11-17' } }),
      ],
      credits: [],
      transfers: october().transfers,
      holdingMoves: [],
      loanPayments: [],
    });
    expect(november.ownTransfers).toBe(0n);
    expect(november.left.find((l) => l.accountId === 'card')?.leftMinor).toBe(0n);
    expect(november.paymentsInTransit).toBe(-paise(6_240));
    expect(november.spent).toBe(0n);
    expect(november.gapMinor).toBe(0n);
  });

  it('CY-I6 — the line telescopes: October’s ₹6,240 in transit and November’s −₹6,240 add up to nothing still in transit', () => {
    expect(closed(october()).paymentsInTransit + -paise(6_240)).toBe(0n);
  });

  it('CY-I1 — a month-end card in the same household is counted over the calendar month exactly as before, whatever another card does', () => {
    const both = closed(
      october({
        accounts: [...banks(), cycleCard(), { id: 'axis', type: 'card', currency: 'INR', opening: r(1_000), closing: r(3_000) }],
        credits: [],
        transfers: [],
        holdingMoves: [],
      }),
    );
    expect(both.left.find((l) => l.accountId === 'axis')?.leftMinor).toBe(paise(2_000));
    expect(both.gapMinor).toBe(0n);
  });

  describe('a bill converted to EMIs (CY-I15)', () => {
    const plain = (card: Partial<MonthAccount>, month: string, window: { from: string; to: string }): MonthInput => ({
      month,
      today: '2026-12-31',
      accounts: [
        { id: 'hdfc', type: 'savings', currency: 'INR', opening: r(100_000), closing: r(100_000) },
        { id: 'card', type: 'card', currency: 'INR', opening: r(0), closing: r(0), window, ...card },
      ],
      credits: [],
      transfers: [],
      holdingMoves: [],
      loanPayments: [],
    });

    it('counts the converted ₹60,000 as spent in the cycle it was converted, and −₹60,000 as paid to loans, with a gap of nothing', () => {
      const month = closed(plain({ opening: r(0), closing: r(0), emiConvertedMinor: 6_000_000n }, '2026-10', { from: '2026-09-18', to: '2026-10-17' }));
      expect(month.spent).toBe(6_000_000n);
      expect(month.paidToLoans).toBe(-6_000_000n);
      expect(month.split.paidToLoans).toBe(-6_000_000n);
      expect(month.gapMinor).toBe(0n);
    });

    it('says what the cards converted and what their instalments billed, for the line under Paid to loans, and says nothing when there is none', () => {
      const converted = closed(plain({ opening: r(0), closing: r(0), emiConvertedMinor: 6_000_000n }, '2026-10', { from: '2026-09-18', to: '2026-10-17' }));
      expect(converted.cardEmi).toEqual({ converted: 6_000_000n, principal: 0n });
      const billed = closed(plain({ opening: r(0), closing: r(5_660), emiPrincipalMinor: 500_000n }, '2026-11', { from: '2026-10-18', to: '2026-11-17' }));
      expect(billed.cardEmi).toEqual({ converted: 0n, principal: 500_000n });
      const none = closed(plain({ opening: r(0), closing: r(100) }, '2026-10', { from: '2026-09-18', to: '2026-10-17' }));
      expect(none.cardEmi).toBeUndefined();
    });

    it('counts the next cycle’s instalment as ₹660 spent (its interest and GST) and ₹5,000 paid to loans (its principal), with a gap of nothing', () => {
      const month = closed(plain({ opening: r(0), closing: r(5_660), emiPrincipalMinor: 500_000n }, '2026-11', { from: '2026-10-18', to: '2026-11-17' }));
      expect(month.spent).toBe(66_000n);
      expect(month.paidToLoans).toBe(500_000n);
      expect(month.cashReserveChange).toBe(-566_000n);
      expect(month.gapMinor).toBe(0n);
    });
  });
});

/**
 * CY-I1 as a property (card-cycles.md tests): for random households of bank accounts and month-end cards, a month's figures are the same with no window given and with the calendar month
 * given as every account's window, the gap is nothing, and no card payment is in transit. The window is what a statement-date card adds; without one every figure is today's.
 */
describe('CY-I1 — a household with no card on its statement date has its figures exactly as before', () => {
  // A small deterministic generator, so a failure can be reproduced from its seed.
  const generator = (seed: number) => {
    let state = seed;
    const next = (): number => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
    return { int: (below: number): number => Math.floor(next() * below), pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T };
  };
  const day = (n: number): string => `2026-10-${String(n).padStart(2, '0')}`;

  const household = (seed: number): MonthInput => {
    const g = generator(seed);
    const count = 2 + g.int(4);
    const accounts: MonthAccount[] = Array.from({ length: count }, (_unused, at) => {
      const card = at > 0 && g.int(3) === 0;
      return { id: `a${String(at)}`, type: card ? 'card' : 'savings', currency: 'INR', opening: r(g.int(300_000)), closing: r(g.int(300_000)) } as const;
    });
    const ids = accounts.map((a) => a.id);
    const money_ = (): ReturnType<typeof r> => r(1 + g.int(80_000));
    return {
      month: '2026-10',
      today: '2026-11-20',
      accounts,
      credits: Array.from({ length: g.int(6) }, () => ({
        accountId: g.int(5) === 0 ? null : g.pick(ids),
        category: g.pick(['salary', 'interest', 'refund', 'other_income'] as const),
        amount: money_(),
        date: day(1 + g.int(31)),
      })),
      transfers: Array.from({ length: g.int(4) }, () => {
        const from = g.pick(ids);
        const to = g.pick(ids.filter((id) => id !== from));
        return { fromId: from, toId: to, amount: money_(), date: day(1 + g.int(31)) };
      }),
      holdingMoves: Array.from({ length: g.int(3) }, () => ({ accountId: g.pick(ids), direction: g.pick(['into', 'out'] as const), amount: money_(), date: day(1 + g.int(31)) })),
      loanPayments: Array.from({ length: g.int(3) }, () => ({ accountId: g.pick(ids), amount: money_(), date: day(1 + g.int(31)) })),
    };
  };
  const calendar = (input: MonthInput): MonthInput => ({ ...input, accounts: input.accounts.map((a) => ({ ...a, window: { from: '2026-10-01', to: '2026-10-31' } })) });

  it('gives the same figures with no window as with the calendar month as every window, to the paisa, over two hundred households', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const plain = household(seed);
      expect(closedMonthFigures(calendar(plain)), `seed ${String(seed)}`).toEqual(closedMonthFigures(plain));
    }
  });

  it('leaves the gap at nothing and nothing in transit, in every one of them', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const out = closedMonthFigures(household(seed));
      if (!out.ok) throw new Error(`seed ${String(seed)} did not close`);
      for (const currency of out.currencies) {
        expect(currency.gapMinor, `seed ${String(seed)}`).toBe(0n);
        expect(currency.paymentsInTransit, `seed ${String(seed)}`).toBe(0n);
        expect(currency.split.paymentsInTransit, `seed ${String(seed)}`).toBeUndefined();
      }
    }
  });
});
