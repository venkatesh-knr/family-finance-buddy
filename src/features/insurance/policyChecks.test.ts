import { describe, expect, it } from 'vitest';
import { policyFieldErrors } from './policyChecks.ts';

const blank = { last4: '', startedOn: '', premiumsEndOn: '' };

describe('what is wrong with a policy form', () => {
  it('says nothing about a form with nothing in it', () => {
    expect(policyFieldErrors(blank, 'INR')).toEqual({});
  });

  it('marks a premium or a cover that is not an amount, and not one that is nothing', () => {
    expect(policyFieldErrors({ ...blank, premium: 'abc', cover: '1.234' }, 'INR')).toEqual({
      premium: 'The premium is an amount, such as 12,000.',
      cover: 'The cover is an amount, such as 10,00,000.',
    });
    expect(policyFieldErrors({ ...blank, premium: '0', cover: '10,00,000' }, 'INR')).toEqual({});
  });

  it('marks a negative amount', () => {
    expect(policyFieldErrors({ ...blank, premium: '-5' }, 'INR').premium).toBeDefined();
  });

  it('keeps a policy number to four letters or digits', () => {
    expect(policyFieldErrors({ ...blank, last4: '12345' }, 'INR').last4).toBeDefined();
    expect(policyFieldErrors({ ...blank, last4: '12' }, 'INR').last4).toBeDefined();
    expect(policyFieldErrors({ ...blank, last4: 'A1b2' }, 'INR').last4).toBeUndefined();
  });

  it('marks a date with a slip in the year, and a last premium before the start', () => {
    expect(policyFieldErrors({ ...blank, startedOn: '0002-01-01', renewalOn: '2999-01-01' }, 'INR')).toEqual({
      startedOn: 'That is not a date this can be: check the year.',
      renewalOn: 'That is not a date this can be: check the year.',
    });
    expect(policyFieldErrors({ ...blank, startedOn: '2024-06-01', premiumsEndOn: '2024-05-31' }, 'INR').premiumsEndOn).toBe(
      'The last premium cannot be due before the policy started.',
    );
    expect(policyFieldErrors({ ...blank, startedOn: '2024-06-01', premiumsEndOn: '2024-06-01' }, 'INR')).toEqual({});
  });
});
