/**
 * Recording a payment on a loan (docs/design/ledger-income.md section 4c; LI-I36).
 *
 * The amount is all of what left, principal and interest, in the loan's own currency, on a day; and, when the person says, the account it left, which is in
 * that currency too: there is no typed amount, so a dollar loan is not offered a rupee account. Pure: nothing here reads a database or a clock.
 */

import { isIsoDate } from '../../lib/dates.ts';
import { minorUnitExponent, parseAmountToMinor, money, type Money } from '../../lib/money.ts';
import type { Account, Liability, LoanPayment } from '../../repo/types.ts';
import { paidFromChoices, type PaidFromChoice } from '../holdings/paidFrom.ts';
import { titleOf } from '../money/accountRows.ts';

/** The accounts a payment on a loan in this currency can leave: those in use and in that currency, the one named most recently first. */
export function loanPaymentChoices(accounts: readonly Account[], currency: string, recent: readonly string[]): PaidFromChoice[] {
  return paidFromChoices(
    accounts.filter((account) => account.currency === currency),
    recent,
  );
}

export type LoanPaymentResult =
  | { readonly ok: true; readonly value: { readonly amount: Money; readonly date: string; readonly accountId: string | null } }
  | { readonly ok: false; readonly problem: string };

/** Said of a payment typed against a card's EMI debt: the database refuses it too (CY-I17), with the same words. */
export const CARD_DEBT_REFUSAL = 'This debt’s instalments come from its card’s statements, so a payment is not typed against it.';

export function loanPaymentOf(input: {
  readonly loan: Pick<Liability, 'currency' | 'cardAccountId'>;
  readonly amount: string;
  readonly date: string;
  readonly accountId: string;
  readonly accounts: readonly Account[];
}): LoanPaymentResult {
  if (input.loan.cardAccountId !== undefined && input.loan.cardAccountId !== null) return { ok: false, problem: CARD_DEBT_REFUSAL };
  let minor: bigint;
  try {
    minor = parseAmountToMinor(input.amount, input.loan.currency);
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : 'That is not an amount.' };
  }
  if (minor <= 0n) return { ok: false, problem: 'A payment on a loan is some amount of money: more than nothing.' };
  if (!isIsoDate(input.date)) return { ok: false, problem: 'Say the day the payment was made.' };

  let accountId: string | null = null;
  if (input.accountId !== '') {
    const account = input.accounts.find((each) => each.id === input.accountId);
    if (account === undefined || account.isArchived || account.currency !== input.loan.currency) {
      return { ok: false, problem: `A payment on a loan in ${input.loan.currency} can leave an account in ${input.loan.currency} that is in use.` };
    }
    accountId = account.id;
  }
  return { ok: true, value: { amount: money(minor, input.loan.currency), date: input.date, accountId } };
}

/** The instalment as the amount field starts: whole units without a fraction, and a fraction only when there is one. Empty when none is stated. */
export function suggestedAmount(loan: Pick<Liability, 'instalment'>): string {
  if (loan.instalment === null) return '';
  const exponent = minorUnitExponent(loan.instalment.currency);
  const unit = 10n ** BigInt(exponent);
  const whole = loan.instalment.minor / unit;
  const fraction = (loan.instalment.minor % unit).toString().padStart(exponent, '0');
  return exponent === 0 || /^0+$/.test(fraction) ? whole.toString() : `${whole.toString()}.${fraction}`;
}

/** Where a payment came from, in words: the account's name, none said, or one this person cannot read. */
export function accountLabelFor(payment: Pick<LoanPayment, 'accountId'>, accounts: readonly Account[]): string {
  if (payment.accountId === null) return 'no account said';
  const account = accounts.find((each) => each.id === payment.accountId);
  if (account === undefined) return 'an account you cannot see';
  return account.isArchived ? `${titleOf(account)} (archived)` : titleOf(account);
}
