import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { SpendStatement } from '../../repo/types.ts';
import { crossCheckLines, monthLines, sourceNote } from './spendSourceView.ts';

/**
 * What the month card says of where a month's spent came from (docs/design/spending-capture.md section 11.2 and 11.4; the MoneyMonthStated boards).
 * Amounts are paise: ₹82,000 is 8_200_000n.
 */
const rupees = (n: number): bigint => BigInt(n) * 100n;
const inr = (n: number) => money(rupees(n), 'INR');
const statement = (n: number, currency = 'INR'): SpendStatement => ({ id: `s-${currency}`, householdId: 'h', month: '2026-10', amount: money(rupees(n), currency), note: null });

describe('an ended month with no close: stated, or itemised', () => {
  it('SC-I16 — a stated month shows the stated figure, and what is not yet itemised', () => {
    const [line] = monthLines({ spent: [inr(52_000)], cameIn: [inr(143_250)], statements: [statement(82_000)] });
    expect(line).toMatchObject({ source: 'stated', spent: inr(82_000), notYetItemised: inr(30_000), itemisedOverBy: null });
    expect(line?.sentence).toBe('₹52,000 itemised · ₹30,000 not yet itemised');
  });

  it('SC-I16 — more itemised than stated shows both and names the gap, neither changed', () => {
    const [line] = monthLines({ spent: [inr(55_000)], cameIn: [inr(143_250)], statements: [statement(50_000)] });
    expect(line).toMatchObject({ source: 'stated', spent: inr(50_000), notYetItemised: null, itemisedOverBy: inr(5_000) });
    expect(line?.sentence).toBe('₹55,000 itemised, which is ₹5,000 more than the ₹50,000 you stated. Both are shown; neither is changed.');
  });

  it('SC-I18 — saved from a stated month is came in less the stated figure, and rough', () => {
    const [line] = monthLines({ spent: [inr(52_000)], cameIn: [inr(143_250)], statements: [statement(82_000)] });
    expect(line?.saved).toEqual({ value: inr(61_250), label: 'rough' });
  });

  it('shows an itemised month as it is, with nothing to say and no saved', () => {
    const [line] = monthLines({ spent: [inr(52_000)], cameIn: [inr(143_250)], statements: [] });
    expect(line).toMatchObject({ source: 'itemised', spent: inr(52_000), sentence: null, saved: null, stated: null });
  });

  it('takes each currency on its own and never adds them', () => {
    const lines = monthLines({ spent: [inr(52_000), money(10_000n, 'USD')], cameIn: [inr(143_250), money(50_000n, 'USD')], statements: [statement(82_000)] });
    expect(lines.map((line) => [line.spent.currency, line.source])).toEqual([['INR', 'stated'], ['USD', 'itemised']]);
  });

  it('has no itemised below nothing: refunds that exceed the spend read as nothing itemised', () => {
    const [line] = monthLines({ spent: [money(-500n, 'INR')], cameIn: [inr(10)], statements: [statement(1_000)] });
    expect(line?.notYetItemised).toEqual(inr(1_000));
  });

  it('keeps a stated currency that nothing was itemised in: a month stated and not itemised at all', () => {
    const lines = monthLines({ spent: [inr(0)], cameIn: [inr(143_250)], statements: [statement(82_000), statement(500, 'USD')] });
    expect(lines.map((line) => line.spent.currency)).toEqual(['INR', 'USD']);
  });
});

describe('the words under Spent', () => {
  it('names the source: stated, or the itemised words given', () => {
    const stated = monthLines({ spent: [inr(52_000)], cameIn: [inr(1)], statements: [statement(82_000)] });
    expect(sourceNote(stated, 'itemised so far')).toBe('stated');
    const itemised = monthLines({ spent: [inr(52_000)], cameIn: [inr(1)], statements: [] });
    expect(sourceNote(itemised, 'itemised so far')).toBe('itemised so far');
    expect(sourceNote(itemised, 'from what you entered')).toBe('from what you entered');
  });

  it('names both when the currencies differ in source', () => {
    const mixed = monthLines({ spent: [inr(52_000), money(10_000n, 'USD')], cameIn: [inr(1), money(1n, 'USD')], statements: [statement(82_000)] });
    expect(sourceNote(mixed, 'itemised so far')).toBe('stated · itemised so far');
  });
});

describe('privacy mode masks every amount in a sentence, as it does in the figures', () => {
  it('masks the amounts of the not-yet-itemised, the over-itemised and the cross-check sentences', () => {
    const [short] = monthLines({ spent: [inr(52_000)], cameIn: [inr(1)], statements: [statement(82_000)], privacy: true });
    const [over] = monthLines({ spent: [inr(55_000)], cameIn: [inr(1)], statements: [statement(50_000)], privacy: true });
    const cross = crossCheckLines({ closedSpent: [inr(91_000)], statements: [statement(82_000)], privacy: true });
    for (const text of [short?.sentence, over?.sentence, ...cross]) {
      expect(text).toMatch(/\u20b9\u2022+/);
      expect(text).not.toMatch(/\d/);
    }
  });
});

describe('SC-I17 — the cross-check beside a month closed from balances', () => {
  it('says what the balances say and what was stated, and changes neither', () => {
    expect(crossCheckLines({ closedSpent: [inr(91_000)], statements: [statement(82_000)] })).toEqual(['Spent ₹91,000 from balances. You said ₹82,000.']);
  });

  it('says nothing when nothing was stated, or in a currency that was not', () => {
    expect(crossCheckLines({ closedSpent: [inr(91_000)], statements: [] })).toEqual([]);
    expect(crossCheckLines({ closedSpent: [inr(91_000)], statements: [statement(5, 'USD')] })).toEqual([]);
  });
});
