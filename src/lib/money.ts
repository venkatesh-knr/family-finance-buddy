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

/**
 * The codes that actually exist, from ICU.
 *
 * Deliberately separate from `isCurrencyCode`, and the split matters.
 *
 * `isCurrencyCode` is a shape test, and reading stays on it. Rows already
 * written with a code this list does not recognise still have to load: a
 * holding recorded before the check existed is data, and refusing to map it
 * would take the screen down rather than let somebody go and fix the row.
 *
 * `isKnownCurrency` is for input, where the answer can still be changed. That
 * is where "ABC" was getting in — three capitals passes a shape test, and the
 * form asked for three capitals.
 *
 * `Intl.supportedValuesOf` is not in every runtime this could end up in, so a
 * missing implementation means the shape test alone rather than an app that
 * cannot record anything.
 */
let knownCurrencies: ReadonlySet<string> | null = null;

function currencyList(): ReadonlySet<string> | null {
  if (knownCurrencies !== null) return knownCurrencies;
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported !== 'function') return null;
  try {
    knownCurrencies = new Set(supported('currency'));
    return knownCurrencies;
  } catch {
    return null;
  }
}

/** Every ISO 4217 code this runtime knows, sorted. Empty when ICU cannot say. */
export function knownCurrencyCodes(): readonly string[] {
  const list = currencyList();
  return list === null ? [] : [...list].sort();
}

/** Whether a code names a real currency. Falls back to the shape test. */
export function isKnownCurrency(value: string): boolean {
  const list = currencyList();
  if (list === null) return isCurrencyCode(value);
  return list.has(value);
}

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
  /**
   * Keep `.00` on a whole amount.
   *
   * Off by default, because most figures in a household ledger are whole
   * rupees and two zeros after every one of them is noise that crowds a phone
   * screen. An amount with actual paise always keeps them — this drops a
   * fraction that says nothing, never one that does.
   *
   * Worth turning on for a column of figures that must align digit for digit,
   * where a ragged right edge costs more than the zeros do.
   */
  readonly alwaysShowMinorUnits?: boolean;
}

export function formatMoney(value: Money, options: FormatMoneyOptions = {}): string {
  const exponent = minorUnitExponent(value.currency);
  const negative = value.minor < 0n;
  const digits = (negative ? -value.minor : value.minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const minorPart = exponent === 0 ? '' : digits.slice(digits.length - exponent);

  // A whole amount loses its zeros unless somebody asked to keep them. Paise
  // that exist are always shown: this drops a fraction that says nothing, and
  // never one that does.
  const isWhole = minorPart === '' || /^0+$/.test(minorPart);
  const fractionDigits = isWhole && options.alwaysShowMinorUnits !== true ? 0 : exponent;

  const formatter = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  if (options.privacy === true) {
    const symbol = formatter
      .formatToParts(0)
      .filter((part) => part.type === 'currency')
      .map((part) => part.value)
      .join('');
    return `${symbol}•••••`;
  }

  const fraction = minorPart === '' ? '' : `.${minorPart}`;

  // The string goes to Intl as a string, so a large figure is never squeezed
  // through a double on the way to being displayed.
  return formatter.format(`${negative ? '-' : ''}${whole}${fraction}` as unknown as number);
}
