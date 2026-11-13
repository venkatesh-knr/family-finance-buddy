/**
 * What the repository refuses before it asks the database (docs/design/ledger-income.md section 12).
 *
 * The tables refuse all of these too, with a constraint's name; this is the same rule said first, in words a person can act on. Pure:
 * each throws an Error with the sentence, or returns.
 */

import { CREDIT_CATEGORIES, type CreditCategory } from '../domain/credit.ts';
import { checkTypedProfit, type TaxHead, type TaxSource } from '../domain/income.ts';
import { isIsoDate } from '../lib/dates.ts';
import type { Money } from '../lib/money.ts';
import { ACCOUNT_TYPES, type AccountType } from './types.ts';

const SOME_AMOUNT = 'That is a credit of some amount of money: more than nothing.';
const NOT_A_DATE = 'That is not a calendar date.';

export function checkCredit(input: {
  readonly category: CreditCategory;
  readonly amount: Money;
  readonly date: string;
  readonly payer?: string | null;
  readonly note?: string | null;
}): void {
  if (!(CREDIT_CATEGORIES as readonly string[]).includes(input.category)) throw new Error('Choose what came in: one of Salary, Business income, Interest, Rent, Dividend, Other income, or Refund or money back. That is not a category.');
  if (input.amount.minor <= 0n) throw new Error(SOME_AMOUNT);
  if (!isIsoDate(input.date)) throw new Error(`${NOT_A_DATE} The date is the day the bank credited it.`);
  if (input.payer !== undefined && input.payer !== null && input.payer.trim().length > 120) throw new Error('The payer is up to 120 characters.');
  if (input.note !== undefined && input.note !== null && input.note.length > 500) throw new Error('A note is up to 500 characters.');
}

/** The fields of a credit's patch that are given, checked as `checkCredit` checks a whole credit. */
export function checkCreditPatch(patch: {
  readonly category?: CreditCategory;
  readonly amount?: Money;
  readonly date?: string;
  readonly payer?: string | null;
  readonly note?: string | null;
}): void {
  if (patch.category !== undefined && !(CREDIT_CATEGORIES as readonly string[]).includes(patch.category)) {
    throw new Error('Choose what came in: that is not a category.');
  }
  if (patch.amount !== undefined && patch.amount.minor <= 0n) throw new Error(SOME_AMOUNT);
  if (patch.date !== undefined && !isIsoDate(patch.date)) throw new Error(`${NOT_A_DATE} The date is the day the bank credited it.`);
  if (patch.payer !== undefined && patch.payer !== null && patch.payer.trim().length > 120) throw new Error('The payer is up to 120 characters.');
  if (patch.note !== undefined && patch.note !== null && patch.note.length > 500) throw new Error('A note is up to 500 characters.');
}

export function checkAccount(input: {
  readonly name?: string;
  readonly type?: AccountType;
  readonly currency?: string;
  readonly last4?: string | null;
  readonly institution?: string | null;
}): void {
  if (input.name !== undefined && (input.name.trim() === '' || input.name.trim().length > 80)) throw new Error('An account needs a name of up to 80 characters.');
  if (input.type !== undefined && !ACCOUNT_TYPES.includes(input.type)) throw new Error('An account’s type is a savings account, a current account or a card. Cash is not an account.');
  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) throw new Error('A currency is a three-letter code, such as INR.');
  if (input.last4 !== undefined && input.last4 !== null && input.last4 !== '' && !/^[0-9A-Za-z]{4}$/.test(input.last4)) {
    throw new Error('Keep only the last four characters of the account, and nothing more.');
  }
  if (input.institution !== undefined && input.institution !== null && input.institution.trim().length > 80) throw new Error('A bank’s name is up to 80 characters.');
}

export function checkBalance(input: { readonly asAt: string; readonly balance: Money }): void {
  if (!isIsoDate(input.asAt)) throw new Error(`${NOT_A_DATE} A balance is as at a day.`);
}

export function checkTransfer(input: { readonly fromAccountId: string; readonly toAccountId: string; readonly amount: Money; readonly date: string }): void {
  if (input.fromAccountId === input.toAccountId) throw new Error('A move is between two accounts. It cannot be from an account to itself.');
  if (input.amount.minor <= 0n) throw new Error('A move is of some amount of money: more than nothing.');
  if (!isIsoDate(input.date)) throw new Error(NOT_A_DATE);
}

const HEADS: readonly TaxHead[] = ['salary', 'business', 'other_sources'];
const SOURCES: readonly TaxSource[] = ['payslip', 'form16', 'typed'];

export function checkTaxInput(input: {
  readonly taxYear: string;
  readonly head: TaxHead;
  readonly amount: Money;
  readonly tds?: Money | null;
  readonly source: TaxSource;
}): void {
  const year = /^([0-9]{4})-([0-9]{2})$/.exec(input.taxYear);
  if (year === null || Number(year[2]) !== (Number(year[1]) + 1) % 100) {
    throw new Error('That is not a tax year. It runs 1 April to 31 March and is written like 2026-27.');
  }
  if (!HEADS.includes(input.head)) throw new Error('That is not a head of income this screen takes: salary, business or other sources.');
  if (!SOURCES.includes(input.source)) throw new Error('A figure’s source is a payslip, Form 16, or typed.');
  if (input.amount.currency !== 'INR') throw new Error('Tax is worked out in rupees, so a figure here is in rupees.');
  if (input.head === 'business') {
    const profit = checkTypedProfit(input.amount.minor);
    if (!profit.ok) throw new Error(profit.reason);
  } else if (input.amount.minor < 0n) {
    throw new Error('A figure here is not negative.');
  }
  if (input.tds !== undefined && input.tds !== null && input.tds.minor < 0n) throw new Error('The tax deducted is not negative.');
}
