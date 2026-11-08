import { describe, expect, it } from 'vitest';
import { propertyFieldErrors, shareIsWhole } from './propertyChecks.ts';

const today = '2026-11-08';
const blank = { boughtOn: '', price: '', duty: '', registration: '', sharePct: '100' };

describe('what is wrong with a property form', () => {
  it('says nothing about a form with nothing wrong in it, blanks included', () => {
    expect(propertyFieldErrors(blank, 'INR', today)).toEqual({});
    expect(propertyFieldErrors({ ...blank, boughtOn: '2020-03-01', price: '85,00,000', duty: '5,95,000' }, 'INR', today)).toEqual({});
  });

  it('marks a date with a slip in the year, and one after today', () => {
    expect(propertyFieldErrors({ ...blank, boughtOn: '0002-03-01' }, 'INR', today).boughtOn).toBe(
      'That is not a date this can be: check the year.',
    );
    expect(propertyFieldErrors({ ...blank, boughtOn: '2026-11-09' }, 'INR', today).boughtOn).toBe('It cannot have been bought after today.');
    expect(propertyFieldErrors({ ...blank, boughtOn: '2026-11-08' }, 'INR', today).boughtOn).toBeUndefined();
  });

  it('marks each figure that is not an amount, on its own field', () => {
    expect(propertyFieldErrors({ ...blank, price: 'lots', duty: '1.234', registration: '-5' }, 'INR', today)).toEqual({
      price: 'The price paid is an amount, such as 85,00,000.',
      duty: 'The stamp duty is an amount, such as 5,95,000, or leave it empty.',
      registration: 'The registration is an amount, such as 50,000, or leave it empty.',
    });
  });

  it('marks a share that cannot be one, and leaves one ending in a point as unfinished', () => {
    for (const bad of ['0', '101', 'half', '33.333', '-5']) {
      expect(propertyFieldErrors({ ...blank, sharePct: bad }, 'INR', today).sharePct, bad).toBeDefined();
    }
    expect(propertyFieldErrors({ ...blank, sharePct: '33.' }, 'INR', today).sharePct).toBeUndefined();
    expect(shareIsWhole('33.')).toBe(false);
    expect(shareIsWhole('33.33')).toBe(true);
    expect(shareIsWhole('100')).toBe(true);
  });
});
