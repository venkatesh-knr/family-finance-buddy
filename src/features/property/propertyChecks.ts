import { isIsoDate } from '../../lib/dates.ts';
import { parseAmountToMinor } from '../../lib/money.ts';

/**
 * What is wrong with the property form's fields as they stand, in words, for the field it is wrong on (docs/design/simple-layout.md
 * section 3). Pure: the form says when to show each, so a date typed digit by digit is not called wrong on the way to being right.
 *
 * A blank is never wrong here. What a property cannot be without (a name, a day, a price) is the form's business and its button waits
 * for it; a blank stamp duty or registration is nothing. A share that ends in a point, such as "33.", is unfinished and not wrong.
 */

export type PropertyField = 'boughtOn' | 'price' | 'duty' | 'registration' | 'sharePct';

export interface PropertyDraft {
  readonly boughtOn: string;
  readonly price: string;
  readonly duty: string;
  readonly registration: string;
  readonly sharePct: string;
}

const SHARE = /^\d{1,3}(\.\d{1,2})?$/;

/** The household's share as a percentage above nothing and up to 100. */
export function shareIsWhole(text: string): boolean {
  const trimmed = text.trim();
  return SHARE.test(trimmed) && Number(trimmed) > 0 && Number(trimmed) <= 100;
}

function amountIsBad(text: string, currency: string): boolean {
  try {
    parseAmountToMinor(text, currency);
    return false;
  } catch {
    return true;
  }
}

export function propertyFieldErrors(draft: PropertyDraft, currency: string, today: string): Partial<Record<PropertyField, string>> {
  const errors: Partial<Record<PropertyField, string>> = {};
  if (draft.boughtOn !== '') {
    const year = Number(draft.boughtOn.slice(0, 4));
    if (!isIsoDate(draft.boughtOn) || year < 1900 || year > 2100) {
      errors.boughtOn = 'That is not a date this can be: check the year.';
    } else if (draft.boughtOn > today) {
      errors.boughtOn = 'It cannot have been bought after today.';
    }
  }
  if (draft.price.trim() !== '' && amountIsBad(draft.price, currency)) {
    errors.price = 'The price paid is an amount, such as 85,00,000.';
  }
  if (draft.duty.trim() !== '' && amountIsBad(draft.duty, currency)) {
    errors.duty = 'The stamp duty is an amount, such as 5,95,000, or leave it empty.';
  }
  if (draft.registration.trim() !== '' && amountIsBad(draft.registration, currency)) {
    errors.registration = 'The registration is an amount, such as 50,000, or leave it empty.';
  }
  const share = draft.sharePct.trim();
  if (share !== '' && !/^\d+\.$/.test(share) && !shareIsWhole(share)) {
    errors.sharePct = 'The household’s share is a percentage above 0 and up to 100, such as 50 or 33.33.';
  }
  return errors;
}
