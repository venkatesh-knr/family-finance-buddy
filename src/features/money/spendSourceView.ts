/**
 * What the month card says of where a month's spent came from (docs/design/spending-capture.md sections 11.2 and 11.4; the MoneyMonthStated boards).
 *
 * Pure: the figures and the statements are passed in; the choice of source is `src/domain/spend-source.ts` and nothing is decided here that it does not. For
 * an ended month with no close, each currency is itemised or stated; for a month closed from balances the balances' figure stands and a stated one is said
 * beside it. Per currency, never added across them (LI-I5).
 */

import { monthSpend, savedFor, type SpendSource } from '../../domain/spend-source.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import type { SpendStatement } from '../../repo/types.ts';

export interface MonthLine {
  readonly source: SpendSource;
  /** The figure under Spent: the stated one for a stated month, the itemised sum for any other. */
  readonly spent: Money;
  readonly stated: SpendStatement | null;
  readonly notYetItemised: Money | null;
  readonly itemisedOverBy: Money | null;
  /** The sentence under the figures that says what is itemised and what is not, or the gap: null for a month that is only itemised. */
  readonly sentence: string | null;
  /** Saved for a stated month: came in less the stated figure, labelled rough. Null for any other: saved waits for the close. */
  readonly saved: { readonly value: Money; readonly label: 'rough' } | null;
}

const show = (value: Money): string => formatMoney(value);

/** One line for each currency that was itemised or stated in an ended month with no close, the itemised ones in the order given. */
export function monthLines(input: { readonly spent: readonly Money[]; readonly cameIn: readonly Money[]; readonly statements: readonly SpendStatement[] }): readonly MonthLine[] {
  const currencies = [...input.spent.map((line) => line.currency)];
  for (const statement of input.statements) if (!currencies.includes(statement.amount.currency)) currencies.push(statement.amount.currency);

  return currencies.map((currency) => {
    const itemisedRaw = input.spent.find((line) => line.currency === currency)?.minor ?? 0n;
    const itemised = itemisedRaw < 0n ? 0n : itemisedRaw;
    const stated = input.statements.find((statement) => statement.amount.currency === currency) ?? null;
    const out = monthSpend({ closed: null, stated: stated === null ? null : stated.amount.minor, itemised });
    const cameIn = input.cameIn.find((line) => line.currency === currency)?.minor ?? 0n;

    let sentence: string | null = null;
    if (out.source === 'stated' && stated !== null) {
      sentence =
        out.itemisedOverBy !== null
          ? `${show(money(itemised, currency))} itemised, which is ${show(money(out.itemisedOverBy, currency))} more than the ${show(stated.amount)} you stated. Both are shown; neither is changed.`
          : `${show(money(itemised, currency))} itemised · ${show(money(out.notYetItemised ?? 0n, currency))} not yet itemised`;
    }
    return {
      source: out.source,
      spent: out.source === 'stated' && stated !== null ? stated.amount : money(itemisedRaw, currency),
      stated,
      notYetItemised: out.notYetItemised === null ? null : money(out.notYetItemised, currency),
      itemisedOverBy: out.itemisedOverBy === null ? null : money(out.itemisedOverBy, currency),
      sentence,
      saved: out.source === 'stated' ? { value: money(savedFor(cameIn, out).saved, currency), label: 'rough' as const } : null,
    };
  });
}

/** The words under the Spent figure: the source, in words and never a colour (SC-I15). `itemisedWords` is what an itemised-only month has always said. */
export function sourceNote(lines: readonly MonthLine[], itemisedWords: string): string {
  const words: string[] = [];
  for (const line of lines) {
    const word = line.source === 'stated' ? 'stated' : itemisedWords;
    if (!words.includes(word)) words.push(word);
  }
  return words.join(' · ');
}

/** Beside a month closed from balances: what was stated, said once per currency it was stated in (SC-I17). Nothing is changed by it. */
export function crossCheckLines(input: { readonly closedSpent: readonly Money[]; readonly statements: readonly SpendStatement[] }): readonly string[] {
  const lines: string[] = [];
  for (const closed of input.closedSpent) {
    const stated = input.statements.find((statement) => statement.amount.currency === closed.currency);
    if (stated !== undefined) lines.push(`Spent ${show(closed)} from balances. You said ${show(stated.amount)}.`);
  }
  return lines;
}
