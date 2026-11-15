import { describe, expect, it } from 'vitest';
import type { Account } from '../../repo/types.ts';
import { accountsNudge } from './accountsNudge.ts';

/**
 * What the Money screen says about Accounts, now that Accounts is behind More (the owner, 15 November 2026): a card that asks for the first account,
 * a quiet line to manage them afterwards, and nothing to someone who cannot record.
 */

const account = (id: string, isArchived = false): Account => ({
  id,
  householdId: 'h-1',
  memberId: 'm-1',
  name: id,
  institution: null,
  type: 'savings',
  currency: 'INR',
  last4: null,
  isForeign: false,
  openedOn: null,
  visibility: 'household',
  isArchived,
});

describe('accountsNudge', () => {
  it('asks for the first account when there is none in use', () => {
    expect(accountsNudge({ accounts: [], canRecord: true })).toEqual({ kind: 'add' });
  });

  it('asks again when every account has been archived: a month cannot be closed from none', () => {
    expect(accountsNudge({ accounts: [account('a', true)], canRecord: true })).toEqual({ kind: 'add' });
  });

  it('is a quiet way to manage them, with how many, once there are some in use', () => {
    expect(accountsNudge({ accounts: [account('a'), account('b'), account('c', true)], canRecord: true })).toEqual({ kind: 'manage', count: 2 });
  });

  it('says nothing to someone who cannot record, who has no Accounts to open', () => {
    expect(accountsNudge({ accounts: [], canRecord: false })).toBeNull();
    expect(accountsNudge({ accounts: [account('a')], canRecord: false })).toBeNull();
  });
});
