import { describe, expect, it } from 'vitest';
import { accountColumns } from './lots.ts';

describe('the columns that say which account an entry paid from or into', () => {
  it('are all empty when none is named', () => {
    expect(accountColumns(null, 'INR')).toEqual({ account_id: null, account_currency: null, account_amount_minor: null });
    expect(accountColumns(undefined, 'USD')).toEqual({ account_id: null, account_currency: null, account_amount_minor: null });
  });

  it("keep no amount when the account is in the entry's own currency: the cost is it", () => {
    expect(accountColumns({ accountId: 'a-1', amount: { minor: 700_000n, currency: 'INR' } }, 'INR')).toEqual({
      account_id: 'a-1',
      account_currency: 'INR',
      account_amount_minor: null,
    });
  });

  it("keep what left the account, in the account's currency, when it is not the entry's", () => {
    expect(accountColumns({ accountId: 'a-2', amount: { minor: 850_000n, currency: 'INR' } }, 'USD')).toEqual({
      account_id: 'a-2',
      account_currency: 'INR',
      account_amount_minor: '850000',
    });
  });

  it('refuse an account in another currency with no amount, rather than guess one', () => {
    expect(() => accountColumns({ accountId: 'a-2', amount: { minor: 0n, currency: 'INR' } }, 'USD')).toThrow(/what left the account/);
  });
});
