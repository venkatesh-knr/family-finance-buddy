import { describe, expect, it } from 'vitest';
import { AlreadyRecordedError, asLedgerError } from './ledgerErrors.ts';

/** The ledger's refusals, in words a person can act on, with the provider's codes kept inside the repository layer. */
describe('asLedgerError', () => {
  it('says a row that is not the caller’s to change is not theirs, and not that the app failed', () => {
    expect(asLedgerError({ code: '42501', message: 'new row violates row-level security policy' }).message).toMatch(/role|yours/);
  });

  it('says a duplicate is already recorded, as a kind of its own so a caller can tell it from a failure', () => {
    const error = asLedgerError({ code: '23505', message: 'duplicate key' });
    expect(error.message).toMatch(/already/);
    expect(error).toBeInstanceOf(AlreadyRecordedError);
    expect(asLedgerError({ code: '23514', message: 'x' })).not.toBeInstanceOf(AlreadyRecordedError);
  });

  it('says an account in another household or another currency does not belong', () => {
    expect(asLedgerError({ code: '23503', message: 'violates foreign key constraint' }).message).toMatch(/account/);
  });

  it('says what does not fit, and names no constraint', () => {
    const message = asLedgerError({ code: '23514', message: 'violates check constraint "credit_entry_category_check"' }).message;
    expect(message).toMatch(/does not fit/);
    expect(message).not.toMatch(/constraint/);
  });

  it('passes through the message of anything it does not know', () => {
    expect(asLedgerError({ code: 'XX000', message: 'something else' }).message).toBe('something else');
    expect(asLedgerError({ message: 'no code' }).message).toBe('no code');
  });
});
