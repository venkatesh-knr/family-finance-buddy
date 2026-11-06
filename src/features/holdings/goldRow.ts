import { formatGrams, latestRate, type GoldRate } from '../../domain/gold.ts';

/**
 * The one fact a physical gold holding's row carries beside the member (docs/design/holdings.md, "A row"): what it is, its purity and its
 * weight, and, where no rate has been typed for its purity, that it is not valued and what to do about it (gold.md section 3). Never a value:
 * the row's figure is the latest reading (HD-I1).
 *
 * `rates` is null while the rates are still being read, and then nothing is said of a missing rate, because it may not be missing.
 */
export function goldRowLine(options: {
  readonly purity: '24k' | '22k' | '18k' | null;
  readonly grams: bigint;
  readonly rates: readonly GoldRate[] | null;
  readonly today: string;
}): string {
  const { purity, grams, rates, today } = options;
  const label = purity === null ? null : purity.toUpperCase();
  const what = ['Physical gold', label, `${formatGrams(grams)} g`].filter((part): part is string => part !== null).join(' · ');
  if (purity === null || rates === null || latestRate(rates, purity, today) !== null) return what;
  return `${what} · not valued: add today's ${label ?? ''} rate`;
}
