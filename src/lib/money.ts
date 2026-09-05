/**
 * Money — integer minor units, always carrying a currency.
 *
 * Two rules from CLAUDE.md drive every line here:
 *   * money is integer minor units (paise, cents) in bigint, never a float;
 *   * every amount carries a currency, and formatting happens only at the
 *     display edge.
 *
 * Nothing in this module converts between currencies. Conversion is a dated
 * lookup against fx_rate at the transaction's own date, and it belongs in the
 * domain layer once that table exists — not in a formatter.
 */

/** An ISO 4217 code, upper case. */
export type CurrencyCode = string;

export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

/** The display locale. Indian grouping for the rupee, sane output for the rest. */
const LOCALE = 'en-IN';

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE.test(value);
}

export function money(minor: bigint, currency: CurrencyCode): Money {
  if (!isCurrencyCode(currency)) {
    throw new Error(`Not an ISO 4217 currency code: ${JSON.stringify(currency)}`);
  }
  return { minor, currency };
}

/**
 * How many decimal places the currency has: 2 for INR and USD, 0 for JPY.
 * Read from ICU rather than kept in a table here, so a currency we have not
 * thought about still behaves correctly.
 */
export function minorUnitExponent(currency: CurrencyCode): number {
  if (!isCurrencyCode(currency)) {
    throw new Error(`Not an ISO 4217 currency code: ${JSON.stringify(currency)}`);
  }
  const resolved = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
  }).resolvedOptions();
  // ICU always resolves this for a currency format; the fallback is only here
  // because the type says it may be absent, and two is right for most of the
  // world when it is.
  return resolved.maximumFractionDigits ?? 2;
}

/**
 * Parse what a person typed into minor units.
 *
 * Deliberately strict. It refuses more precision than the currency has instead
 * of rounding it away, because silently discarding a paise is exactly the class
 * of bug this whole representation exists to prevent. The string is taken apart
 * digit by digit; it never becomes a Number.
 */
export function parseAmountToMinor(input: string, currency: CurrencyCode): bigint {
  const exponent = minorUnitExponent(currency);

  // Strip whitespace (ordinary, non-breaking and narrow) and grouping commas.
  const stripped = input.trim().replace(/[\s  ,]/g, '');

  // The sign is checked before any symbol is removed. Stripping a leading
  // currency symbol first would quietly swallow a minus along with it, and a
  // negative expense would land in the ledger as a positive one.
  if (/[+-]/.test(stripped)) {
    throw new Error('An expense is a positive amount.');
  }

  // Now the leading or trailing currency symbol or code can go.
  const cleaned = stripped.replace(/^[^\d.]+/, '').replace(/[^\d.]+$/, '');

  if (cleaned === '') {
    throw new Error('Enter an amount.');
  }

  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) {
    throw new Error(`That is not an amount: ${JSON.stringify(input)}`);
  }

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';

  if (fraction.length > exponent) {
    throw new Error(
      exponent === 0
        ? `${currency} has no minor unit, so it takes a whole number.`
        : `${currency} carries two decimal places, and this has ${String(fraction.length)}.`,
    );
  }

  const padded = fraction.padEnd(exponent, '0');
  return BigInt(whole + padded);
}

export interface FormatMoneyOptions {
  /**
   * Privacy mode (docs/tokens.md §8): the amount becomes bullets while the
   * currency symbol stays. A formatter switch rather than a CSS blur, because
   * a blur is recoverable from a screenshot and this needs to survive one.
   */
  readonly privacy?: boolean;
}

export function formatMoney(value: Money, options: FormatMoneyOptions = {}): string {
  const formatter = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: value.currency,
  });

  if (options.privacy === true) {
    const symbol = formatter
      .formatToParts(0)
      .filter((part) => part.type === 'currency')
      .map((part) => part.value)
      .join('');
    return `${symbol}•••••`;
  }

  const exponent = minorUnitExponent(value.currency);
  const negative = value.minor < 0n;
  const digits = (negative ? -value.minor : value.minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`;

  // The string goes to Intl as a string, so a large figure is never squeezed
  // through a double on the way to being displayed.
  return formatter.format(`${negative ? '-' : ''}${whole}${fraction}` as unknown as number);
}
