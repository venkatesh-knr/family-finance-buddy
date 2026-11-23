import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { AccountBalance } from '../../repo/types.ts';
import { cardDebtName, cardEmiDebtLine, emiFiguresOf, emiOwed, emiPlanLine, hasEmiFigures } from './cardEmiDebt.ts';

/**
 * A card's EMI plans as one debt (docs/design/card-cycles.md 4a; CY-I17): which of a card's recorded dues are read, and what the debt is called. The §4a example: ₹60,000 converted in
 * the October cycle, ₹5,000 of principal billed in November. Every figure is invented.
 */
let next = 0;
const due = (asAt: string, source: 'typed' | 'statement', converted?: bigint, principal?: bigint, accountId = 'regalia'): AccountBalance => ({
  id: `b-${String((next += 1))}`,
  householdId: 'h',
  accountId,
  asAt,
  balance: money(2_000_000n, 'INR'),
  source,
  note: null,
  ...(converted === undefined ? {} : { emiConvertedMinor: converted }),
  ...(principal === undefined ? {} : { emiPrincipalMinor: principal }),
});

describe('cardDebtName', () => {
  it('is the card with its last four, then what the debt is', () => {
    expect(cardDebtName({ name: 'HDFC Regalia', last4: '1188' })).toBe('HDFC Regalia ••1188 — EMI plans');
    expect(cardDebtName({ name: 'Amazon Pay card', last4: null })).toBe('Amazon Pay card — EMI plans');
  });

  it('does not say the last four twice for a card the import named with them', () => {
    expect(cardDebtName({ name: 'HDFC Bank ••1188', last4: '1188' })).toBe('HDFC Bank ••1188 — EMI plans');
  });
});

describe('CY-I17 — the dues a card’s debt is read from', () => {
  it('are the dues the close reads: a statement’s beats a typed one for the same cycle, and another card’s are not read', () => {
    const balances = [
      due('2026-10-17', 'statement', 6_000_000n, 0n),
      due('2026-10-18', 'typed', 9_999_000n, 0n),
      due('2026-11-17', 'typed', 0n, 500_000n),
      due('2026-10-17', 'statement', 7_000_000n, 0n, 'another-card'),
    ];
    expect(emiFiguresOf(balances, 'regalia')).toEqual([
      { asAt: '2026-10-17', converted: 6_000_000n, principal: 0n },
      { asAt: '2026-11-17', converted: 0n, principal: 500_000n },
    ]);
  });

  it('is owed as the §4a example works out: 6000000 converted, 500000 of principal billed, 5500000 left', () => {
    const balances = [due('2026-10-17', 'statement', 6_000_000n, 0n), due('2026-11-17', 'statement', 0n, 500_000n)];
    expect(emiOwed(balances, { id: 'regalia', currency: 'INR' })).toEqual(money(5_500_000n, 'INR'));
  });

  it('says nothing is recorded for a card that never converted anything, which is not the same as nothing owed', () => {
    const balances = [due('2026-10-17', 'statement'), due('2026-11-17', 'statement', 0n, 0n)];
    expect(hasEmiFigures(balances, 'regalia')).toBe(false);
    expect(emiOwed(balances, { id: 'regalia', currency: 'INR' })).toBeNull();
  });
});

describe('CY-I17 — what a card’s row on Accounts says of its EMI plans', () => {
  const owed = money(5_500_000n, 'INR');

  it('says they are owed and in the household’s debts, as at the card’s latest statement', () => {
    expect(emiPlanLine({ inDebts: true, owed, asOf: '2026-11-17', privacy: false })).toBe('EMI plans: ₹55,000 owed, in your debts, as at 17 Nov');
  });

  it('says so plainly when they are not in the debts, and what is owed', () => {
    expect(emiPlanLine({ inDebts: false, owed, asOf: '2026-11-17', privacy: false })).toBe('EMI plans not in your debts (₹55,000 owed)');
  });

  it('says nothing is owed once the plans are paid off', () => {
    expect(emiPlanLine({ inDebts: true, owed: money(0n, 'INR'), asOf: '2026-12-17', privacy: false })).toBe('EMI plans: paid off, in your debts, as at 17 Dec');
  });

  it('hides the amount when amounts are hidden', () => {
    expect(emiPlanLine({ inDebts: false, owed, asOf: '2026-11-17', privacy: true })).not.toMatch(/55,000/);
  });
});

describe('CY-I17 — which line a card’s row carries', () => {
  const card = { id: 'regalia', currency: 'INR' };
  const stated = [due('2026-10-17', 'statement', 6_000_000n, 0n), due('2026-11-17', 'statement', 0n, 500_000n)];

  it('is the plans owed, and in the debts, when the card has its debt', () => {
    expect(cardEmiDebtLine(stated, card, [{ cardAccountId: 'regalia', outstanding: 5_500_000n, asOf: '2026-11-17' }], false)).toEqual({ text: 'EMI plans: ₹55,000 owed, in your debts, as at 17 Nov', inDebts: true, behind: false });
  });

  it('says they are not in the debts when the card has none, which is what the person may add from the row', () => {
    expect(cardEmiDebtLine(stated, card, [{ cardAccountId: 'another-card', outstanding: 1n, asOf: '2026-11-17' }], false)).toEqual({ text: 'EMI plans not in your debts (₹55,000 owed)', inDebts: false, behind: false });
  });

  it('is nothing for a card that never converted anything, and offers no debt to a card that has billed principal but converted nothing', () => {
    expect(cardEmiDebtLine([due('2026-10-17', 'statement')], card, [], false)).toBeNull();
    expect(cardEmiDebtLine([due('2026-10-17', 'statement', 0n, 500_000n)], card, [], false)).toBeNull();
  });

  it('shows what the debt says, and offers to bring it up to date when the statements say something else', () => {
    const behind = { cardAccountId: 'regalia', outstanding: 6_000_000n, asOf: '2026-10-17' };
    expect(cardEmiDebtLine(stated, card, [behind], false)).toEqual({ text: 'EMI plans: ₹60,000 owed, in your debts, as at 17 Oct', inDebts: true, behind: true });
    const current = { cardAccountId: 'regalia', outstanding: 5_500_000n, asOf: '2026-11-17' };
    expect(cardEmiDebtLine(stated, card, [current], false)).toMatchObject({ inDebts: true, behind: false });
  });

  it('says plans begun before the card’s first statement are not counted, when what was billed went beyond what was converted', () => {
    const early = [due('2026-10-17', 'statement', 0n, 500_000n), due('2026-11-17', 'statement', 6_000_000n, 500_000n)];
    expect(cardEmiDebtLine(early, card, [], false)?.text).toBe('EMI plans not in your debts (₹55,000 owed, not counting plans begun before the card’s first statement)');
  });
});
