import { describe, expect, it } from 'vitest';
import { amountReading, linkedFields, readSpendForm, stateSpendChoices } from './stateSpendForm.ts';

/**
 * What the State the spend form works out for itself (docs/design/spending-capture.md section 11.3; the StateSpend boards). Amounts are paise: ₹52,000 is 5_200_000n.
 */
const rupees = (n: number): bigint => BigInt(n) * 100n;

describe('the linked fields: spent in total, or just the rest (section 11.3)', () => {
  it('fills the rest from a typed total, and the caption shows the working', () => {
    const out = linkedFields({ edited: 'total', text: '82,000', itemised: rupees(52_000), currency: 'INR' });
    expect(out.total).toBe('82,000');
    expect(out.rest).toBe('30000');
    expect(out.caption).toBe('₹52,000 itemised + ₹30,000 more');
    expect(out.belowItemised).toBe(false);
  });

  it('fills the total from a typed rest, as itemised so far plus the rest', () => {
    const out = linkedFields({ edited: 'rest', text: '30,000', itemised: rupees(52_000), currency: 'INR' });
    expect(out.rest).toBe('30,000');
    expect(out.total).toBe('82000');
    expect(out.caption).toBe('₹52,000 itemised + ₹30,000 more');
  });

  it('keeps the rest empty and says so, without an error, when the total is below what is itemised', () => {
    const out = linkedFields({ edited: 'total', text: '50,000', itemised: rupees(55_000), currency: 'INR' });
    expect(out.rest).toBe('');
    expect(out.belowItemised).toBe(true);
    expect(out.caption).toBeNull();
  });

  it('fills nothing from a blank or a half-typed figure', () => {
    for (const text of ['', ' ', '8x', '-5']) {
      const out = linkedFields({ edited: 'total', text, itemised: rupees(52_000), currency: 'INR' });
      expect(out.rest, text).toBe('');
      expect(out.caption, text).toBeNull();
    }
  });

  it('has no rest to fill when nothing is itemised: the total is the whole of it', () => {
    const out = linkedFields({ edited: 'total', text: '82,000', itemised: 0n, currency: 'INR' });
    expect(out.rest).toBe('');
    expect(out.caption).toBeNull();
  });

  it('works to the minor unit of the currency: dollars have cents', () => {
    const out = linkedFields({ edited: 'total', text: '120.50', itemised: 5_000n, currency: 'USD' });
    expect(out.rest).toBe('70.50');
  });
});

describe('what saving reads', () => {
  it('reads a total as stated', () => {
    expect(readSpendForm({ total: '82,000', note: '', itemised: rupees(52_000), currency: 'INR' })).toEqual({ ok: true, amountMinor: rupees(82_000), note: null });
  });

  it('keeps a note, trimmed, and none when blank', () => {
    expect(readSpendForm({ total: '82,000', note: '  Diwali month  ', itemised: 0n, currency: 'INR' })).toMatchObject({ ok: true, note: 'Diwali month' });
  });

  it('refuses a blank, a zero and a figure that is not an amount, in words, and never as a month of nothing', () => {
    for (const total of ['', '0', 'abc', '-5']) {
      const out = readSpendForm({ total, note: '', itemised: 0n, currency: 'INR' });
      expect(out.ok, total).toBe(false);
    }
    expect(readSpendForm({ total: '0', note: '', itemised: 0n, currency: 'INR' })).toMatchObject({ ok: false, problem: 'Type an amount more than ₹0, like 82,000.' });
  });

  it('accepts a total below what is itemised: neither figure is clamped, and it is not an error', () => {
    expect(readSpendForm({ total: '50,000', note: '', itemised: rupees(55_000), currency: 'INR' })).toMatchObject({ ok: true, amountMinor: rupees(50_000) });
  });

  it('refuses a note over 500 characters, which the table refuses', () => {
    expect(readSpendForm({ total: '1', note: 'x'.repeat(501), itemised: 0n, currency: 'INR' })).toMatchObject({ ok: false });
  });
});

describe('amount reading', () => {
  it('flags a blank so a form can wait to say so until it is tried', () => {
    expect(amountReading('', 'INR')).toMatchObject({ ok: false, blank: true });
    expect(amountReading('abc', 'INR')).toMatchObject({ ok: false, blank: false });
  });
});

describe('the currencies offered', () => {
  it('puts the read currency first, then any other the month was itemised in, once each', () => {
    expect(stateSpendChoices({ reading: 'INR', itemisedIn: ['USD', 'INR', 'USD'], statedIn: [] })).toEqual(['INR', 'USD']);
  });

  it('leaves out a currency already stated for the month, since one is live for each', () => {
    expect(stateSpendChoices({ reading: 'INR', itemisedIn: ['USD'], statedIn: ['INR'] })).toEqual(['USD']);
  });

  it('offers the read currency alone when nothing else was itemised', () => {
    expect(stateSpendChoices({ reading: 'INR', itemisedIn: [], statedIn: [] })).toEqual(['INR']);
  });
});

describe('privacy mode: the form says nothing that gives away what is itemised', () => {
  it('masks the amounts in the caption, and fills nothing from what is itemised, since the rest would give it away', () => {
    const typedTotal = linkedFields({ edited: 'total', text: '82,000', itemised: rupees(52_000), currency: 'INR', privacy: true });
    expect(typedTotal.rest).toBe('');
    expect(typedTotal.caption).toBe('₹••••• itemised + ₹••••• more');
    const typedRest = linkedFields({ edited: 'rest', text: '30,000', itemised: rupees(52_000), currency: 'INR', privacy: true });
    expect(typedRest.total).toBe('');
  });

  it('still says a total is below what is itemised, without saying by how much', () => {
    expect(linkedFields({ edited: 'total', text: '50,000', itemised: rupees(55_000), currency: 'INR', privacy: true }).belowItemised).toBe(true);
  });
});
