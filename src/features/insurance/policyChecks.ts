import { isIsoDate } from '../../lib/dates.ts';
import { parseAmountToMinor } from '../../lib/money.ts';

/**
 * What is wrong with a policy form's fields as they stand, in words, for the field it is wrong on (docs/design/simple-layout.md
 * section 3). Pure: the form says when to show each, so a date typed digit by digit is not called wrong on the way to being right.
 *
 * The rules are the table's own: a four-character policy number (`policy_last4`), a last premium no earlier than the start
 * (`premiums_end_on >= started_on`), amounts that are not negative. A blank is never wrong here: what a policy cannot be
 * without is the form's business, and the button waits for it.
 */

export type PolicyField = 'premium' | 'cover' | 'last4' | 'startedOn' | 'premiumsEndOn' | 'renewalOn';

export interface PolicyDraft {
  readonly premium?: string;
  readonly cover?: string;
  readonly last4: string;
  readonly startedOn: string;
  readonly premiumsEndOn: string;
  readonly renewalOn?: string;
}

const badYear = (date: string): boolean => !isIsoDate(date) || Number(date.slice(0, 4)) < 1990 || Number(date.slice(0, 4)) > 2100;

function amountIsBad(text: string, currency: string): boolean {
  try {
    parseAmountToMinor(text, currency);
    return false;
  } catch {
    return true;
  }
}

export function policyFieldErrors(draft: PolicyDraft, currency: string): Partial<Record<PolicyField, string>> {
  const errors: Partial<Record<PolicyField, string>> = {};
  const premium = draft.premium?.trim() ?? '';
  if (premium !== '' && amountIsBad(premium, currency)) errors.premium = 'The premium is an amount, such as 12,000.';
  const cover = draft.cover?.trim() ?? '';
  if (cover !== '' && amountIsBad(cover, currency)) errors.cover = 'The cover is an amount, such as 10,00,000.';
  const last4 = draft.last4.trim();
  if (last4 !== '' && !/^[0-9A-Za-z]{4}$/.test(last4)) {
    errors.last4 = 'Keep only the last four characters of the policy number, and nothing more.';
  }
  const wrongDate = 'That is not a date this can be: check the year.';
  if (draft.startedOn !== '' && badYear(draft.startedOn)) errors.startedOn = wrongDate;
  if (draft.premiumsEndOn !== '' && badYear(draft.premiumsEndOn)) errors.premiumsEndOn = wrongDate;
  else if (
    draft.premiumsEndOn !== '' &&
    draft.startedOn !== '' &&
    !badYear(draft.startedOn) &&
    draft.premiumsEndOn < draft.startedOn
  ) {
    errors.premiumsEndOn = 'The last premium cannot be due before the policy started.';
  }
  const renewalOn = draft.renewalOn ?? '';
  if (renewalOn !== '' && badYear(renewalOn)) errors.renewalOn = wrongDate;
  return errors;
}
