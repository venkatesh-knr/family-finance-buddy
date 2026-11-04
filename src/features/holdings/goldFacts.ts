import { schemeState } from '../../domain/gold.ts';
import type { GoldInstalment, GoldSchemeTerms } from '../../repo/types.ts';

/**
 * The one fact a gold scheme's row carries beside the member (docs/design/holdings.md, "A row"): who it is with and how far through it is,
 * from the terms and what is recorded and never from a value. The row's figure is the latest recorded reading (HD-I1).
 */
export function goldRowLine(terms: GoldSchemeTerms | undefined, instalments: readonly GoldInstalment[], today: string): string {
  if (terms === undefined) return 'Gold';
  const mine = instalments.filter((instalment) => instalment.holdingId === terms.holdingId);
  const state = schemeState(
    {
      variant: terms.variant,
      instalmentMinor: terms.instalment.minor,
      currency: terms.instalment.currency,
      instalments: terms.instalments,
      startDate: terms.startDate,
      dueDay: terms.dueDay,
      bonusMinor: terms.bonus === null ? null : terms.bonus.minor,
      bonusText: terms.bonusText,
      purity: terms.purity,
    },
    mine.map((instalment) => ({ date: instalment.date, amountMinor: instalment.amount.minor, grams: instalment.grams })),
    today,
  );
  const progress = `${String(state.paidCount)} of ${String(terms.instalments)} paid`;
  return state.missed.length > 0 ? `${terms.jeweller} · ${progress} · ${String(state.missed.length)} missed` : `${terms.jeweller} · ${progress}`;
}
