import { describe, expect, it } from 'vitest';
import { accountIdFrom } from './account.ts';

describe('accountIdFrom', () => {
  it('is the id of the one account the session can read', () => {
    expect(accountIdFrom([{ id: 'a-1' }])).toBe('a-1');
  });

  it('refuses when there is none, rather than guess who is signed in', () => {
    expect(() => accountIdFrom([])).toThrow(/signed in/i);
    expect(() => accountIdFrom(null)).toThrow(/signed in/i);
  });

  it('refuses when there is more than one, which the policy should make impossible', () => {
    // user_account_select_self returns the caller's row and nobody else's. Two rows
    // means that has stopped being true, and picking one would be picking a person.
    expect(() => accountIdFrom([{ id: 'a-1' }, { id: 'a-2' }])).toThrow(/signed in/i);
  });

  it('refuses a row that has no usable id', () => {
    expect(() => accountIdFrom([{}])).toThrow(/signed in/i);
    expect(() => accountIdFrom([{ id: 7 }])).toThrow(/signed in/i);
    expect(() => accountIdFrom([{ id: '' }])).toThrow(/signed in/i);
  });
});
