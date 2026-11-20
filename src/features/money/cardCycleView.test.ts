import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { AccountBalance } from '../../repo/types.ts';
import type { CardCycle } from './closeMonth.ts';
import { cardSummary, cycleRowWords, lateStatementDay, nextDueMonth, ordinal } from './cardCycleView.ts';

/**
 * What the screens say of a card that closes on its statement date (docs/design/card-cycles.md sections 2.4, 3 and 8; CY-I11): every state in words, never in colour alone. Pure: the cycles the
 * close worked out and the balances are passed in. The figures are the design's own worked example.
 */
const r = (rupees: number) => money(BigInt(rupees) * 100n, 'INR');
const shown = (value: { readonly minor: bigint }): string => `₹${(value.minor / 100n).toLocaleString('en-IN')}`;

const balance = (asAt: string, rupees: number, source: AccountBalance['source'] = 'statement', accountId = 'card'): AccountBalance => ({
  id: `b-${asAt}`,
  householdId: 'h',
  accountId,
  asAt,
  balance: r(rupees),
  source,
  note: null,
});

describe('ordinal', () => {
  it('says a day of the month as a person does', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 17, 21, 22, 23, 30, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '17th', '21st', '22nd', '23rd', '30th', '31st']);
  });
});

describe('what the screens learn of a card’s statements', () => {
  it('the day of the month of its latest statement, which is "lately the 17th", and none where it has no statement’s balance', () => {
    expect(lateStatementDay([balance('2026-09-17', 1), balance('2026-10-18', 1)], 'card')).toBe(18);
    expect(lateStatementDay([balance('2026-10-18', 1, 'typed')], 'card')).toBeNull();
    expect(lateStatementDay([balance('2026-10-18', 1, 'statement', 'other')], 'card')).toBeNull();
  });

  it('the month of the next balance after a month, which is where a skipped month’s spending is', () => {
    expect(nextDueMonth([balance('2026-01-31', 1), balance('2026-03-01', 1)], 'card', '2026-02')).toBe('2026-03');
    expect(nextDueMonth([balance('2026-01-31', 1)], 'card', '2026-02')).toBeNull();
  });
});

describe('CY-I11 — each state of a card’s cycle in the close says what it is, in words', () => {
  const say = (cycle: CardCycle, over: { month?: string; lateDay?: number | null; nextMonth?: string | null } = {}) =>
    cycleRowWords(cycle, { month: over.month ?? '2026-10', lateDay: over.lateDay === undefined ? 17 : over.lateDay, nextMonth: over.nextMonth === undefined ? null : over.nextMonth, shown });

  it('waits for the statement dated in the month, saying which and how to import it', () => {
    expect(say({ kind: 'waiting', accountId: 'card' })).toBe('Waiting for its statement dated in October (lately the 17th). Import it from Money → Import a statement.');
    expect(say({ kind: 'waiting', accountId: 'card' }, { lateDay: null })).toBe('Waiting for its statement dated in October. Import it from Money → Import a statement.');
  });

  it('gives the cycle with its two dues, from its statements', () => {
    expect(say({ kind: 'cycle', accountId: 'card', from: '2026-09-18', to: '2026-10-17', opening: r(20_200), closing: r(28_640), emiConvertedMinor: 0n, emiPrincipalMinor: 0n, sources: { opening: 'statement', closing: 'statement' } })).toBe(
      'Cycle 18 Sept – 17 Oct · due ₹20,200 → ₹28,640, from its statements.',
    );
  });

  it('says where the two dues came from: its statements, what was typed, or one of each, and never a typed figure as a document’s', () => {
    const cycle = (opening: 'typed' | 'statement', closing: 'typed' | 'statement'): CardCycle => ({
      kind: 'cycle',
      accountId: 'card',
      from: '2026-09-18',
      to: '2026-10-17',
      opening: r(20_200),
      closing: r(28_640),
      emiConvertedMinor: 0n,
      emiPrincipalMinor: 0n,
      sources: { opening, closing },
    });
    expect(say(cycle('statement', 'statement'))).toContain('from its statements.');
    expect(say(cycle('typed', 'typed'))).toContain('from the dues you typed.');
    expect(say(cycle('statement', 'typed'))).toContain('from a statement and a typed due.');
  });

  it('says a first cycle with no earlier statement is left out, and from when it is counted in full', () => {
    expect(say({ kind: 'first-left-out', accountId: 'card', to: '2026-10-17', closing: r(28_640), emiConvertedMinor: 0n, emiPrincipalMinor: 0n })).toBe(
      'First cycle left out: there is no earlier statement to start from. From November it is counted in full.',
    );
    expect(say({ kind: 'first-left-out', accountId: 'card', to: '2026-12-17', closing: r(1), emiConvertedMinor: 0n, emiPrincipalMinor: 0n }, { month: '2026-12' })).toContain('From January');
  });

  it('says a month with no statement dated in it is in the later close, and names it where it is known', () => {
    expect(say({ kind: 'none-this-month', accountId: 'card' }, { month: '2026-02', nextMonth: '2026-03' })).toBe('No statement dated in February: this card’s spending is in March’s close.');
    expect(say({ kind: 'none-this-month', accountId: 'card' }, { month: '2026-02' })).toBe('No statement dated in February: this card’s spending is in the next close.');
  });

  it('says a card left out of the close by an owner or a partner is not in it, and that its payments count as spent', () => {
    expect(say({ kind: 'closed-without', accountId: 'card' })).toBe('Not in this close: its statement is not imported. Payments to it this month count as spent instead.');
  });
});

describe('the closed month card (card-cycles.md 8.3)', () => {
  const cycle = (to: string, from: string): CardCycle => ({ kind: 'cycle', accountId: 'a', from, to, opening: r(1), closing: r(2), emiConvertedMinor: 0n, emiPrincipalMinor: 0n, sources: { opening: 'statement', closing: 'statement' } });
  const names = new Map([
    ['a', 'HDFC Regalia'],
    ['b', 'Axis Magnus'],
  ]);

  it('names the cycle for one card, and counts the cycles for two', () => {
    expect(cardSummary([cycle('2026-10-17', '2026-09-18')], names).byCycle).toBe('1 card by its cycle (18 Sept – 17 Oct)');
    expect(cardSummary([cycle('2026-10-17', '2026-09-18'), { ...cycle('2026-10-03', '2026-09-04'), accountId: 'b' }], names).byCycle).toBe('2 cards by their cycles');
  });

  it('says every closed month with a statement-date card that a payment after the statement date counts in this month and comes off the next', () => {
    expect(cardSummary([cycle('2026-10-17', '2026-09-18')], names).notes).toEqual(['A card payment made after a card’s statement date counts in this month, and comes off the next.']);
  });

  it('says a card left out, and a card whose first cycle was, by its name', () => {
    const out = cardSummary(
      [
        { kind: 'closed-without', accountId: 'a' },
        { kind: 'first-left-out', accountId: 'b', to: '2026-10-03', closing: r(1), emiConvertedMinor: 0n, emiPrincipalMinor: 0n },
      ],
      names,
    );
    expect(out.byCycle).toBeNull();
    expect(out.notes).toContain('HDFC Regalia not in this close: its statement is not imported. Payments to it this month count as spent instead.');
    expect(out.notes).toContain('Axis Magnus’s first cycle is left out: there is no earlier statement to start from.');
  });

  it('says nothing for a household with no statement-date card, which is every household before the setting is used (CY-I1)', () => {
    expect(cardSummary([], names)).toEqual({ byCycle: null, notes: [] });
  });
});
