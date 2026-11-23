import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Liability, PlanListing } from '../../repo/types.ts';
import { annualFromListing } from './annualFromListing.ts';

const listing = (liabilities: readonly Liability[]): PlanListing => ({ categories: [], budgets: [], liabilities, policies: [] }) as unknown as PlanListing;
const loan = (over: Partial<Liability>): Liability => ({
  id: 'l',
  name: 'Home loan',
  kind: 'home_loan',
  currency: 'INR',
  instalment: money(3_200_000n, 'INR'),
  cadence: 'monthly',
  memberId: null,
  isClosed: false,
  outstanding: null,
  outstandingAsOf: null,
  ...over,
});

describe('CY-I17 — a card’s EMI debt is not a planned outgoing', () => {
  it('leaves out of the annual expense a debt whose instalments are counted from the card’s statements, and does not call it unplanned', () => {
    const cardDebt = loan({ id: 'c', name: 'HDFC Regalia ••1188 — EMI plans', kind: 'credit_card', instalment: null, cardAccountId: 'card', outstanding: money(5_500_000n, 'INR'), outstandingAsOf: '2026-11-17' });
    const withDebt = annualFromListing(listing([loan({}), cardDebt]));
    const without = annualFromListing(listing([loan({})]));
    expect(withDebt).toEqual(without);
    expect(JSON.stringify(withDebt, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain('EMI plans');
  });

  it('still counts an ordinary loan', () => {
    expect(annualFromListing(listing([loan({})]))).not.toBeNull();
  });
});
