/**
 * What the screens say of a card that closes on its statement date (docs/design/card-cycles.md sections 2.4, 3 and 8; CY-I11).
 *
 * Pure: the cycles the close worked out (`cardCycles`, `closeMonth.ts`) and the balances are passed in, and nothing here reads a database or a clock. Every state is said in words: waiting for its
 * statement, its cycle's dates, a first cycle left out, no statement dated in the month, a card left out of a close, and what a payment made after a statement date does. Nothing is carried by
 * colour alone.
 */

import { formatShortDate } from '../../lib/dates.ts';
import type { Money } from '../../lib/money.ts';
import type { AccountBalance } from '../../repo/types.ts';
import { monthWord, type CardCycle } from './closeMonth.ts';
import { addMonths } from '../../domain/accrual.ts';

/** A day of the month as a person says it: 1st, 2nd, 3rd, 11th, 17th, 22nd. */
export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${String(day)}th`;
  const suffix = day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${String(day)}${suffix}`;
}

/** The day of the month of a card's latest statement's balance, which is what its bill "lately" closes on; null where it has no statement's balance. */
export function lateStatementDay(balances: readonly AccountBalance[], accountId: string): number | null {
  const stated = balances.filter((b) => b.accountId === accountId && b.source === 'statement').map((b) => b.asAt);
  const latest = stated.sort().pop();
  return latest === undefined ? null : Number(latest.slice(8, 10));
}

/** The month of the earliest balance a card has after a month: where the spending of a month with no statement dated in it is counted. Null where there is none. */
export function nextDueMonth(balances: readonly AccountBalance[], accountId: string, month: string): string | null {
  const after = balances
    .filter((b) => b.accountId === accountId && b.asAt.slice(0, 7) > month)
    .map((b) => b.asAt.slice(0, 7))
    .sort();
  return after[0] ?? null;
}

/** Said once, on the cycle that first bills principal on a plan the card never stated as converted (card-cycles.md 4a). */
const EARLIER_PLAN = "Includes EMI instalments of a plan that began before this card's first statement: their principal is not counted as spent.";

/**
 * The line under Paid to loans for a month with a card EMI (card-cycles.md 4a): what the cards converted, which is counted as spent and is now owed, and the principal of the instalments paid,
 * which is paid to loans and not spent.
 */
export function cardEmiWords(emi: { readonly converted: bigint; readonly principal: bigint }, shown: (value: bigint) => string): string {
  const parts = [
    ...(emi.converted !== 0n ? [`${shown(emi.converted)} converted (counted as spent, now owed)`] : []),
    ...(emi.principal !== 0n ? [`${shown(emi.principal)} of instalments paid (not spent)`] : []),
  ];
  return `Card EMIs: ${parts.join(', ')}`;
}

/** One card's row in the close, in words (card-cycles.md 8.2). */
export function cycleRowWords(cycle: CardCycle, context: { readonly month: string; readonly lateDay: number | null; readonly nextMonth: string | null; readonly shown: (value: Money) => string }): string {
  const word = monthWord(context.month);
  switch (cycle.kind) {
    case 'waiting':
      return `Waiting for its statement dated in ${word}${context.lateDay === null ? '' : ` (lately the ${ordinal(context.lateDay)})`}. Import it from Money → Import a statement.`;
    case 'cycle':
      return `Cycle ${formatShortDate(cycle.from)} – ${formatShortDate(cycle.to)} · due ${context.shown(cycle.opening)} → ${context.shown(cycle.closing)}, ${
        cycle.sources.opening === 'statement' && cycle.sources.closing === 'statement'
          ? 'from its statements'
          : cycle.sources.opening === 'typed' && cycle.sources.closing === 'typed'
            ? 'from the dues you typed'
            : 'from a statement and a typed due'
      }.${cycle.planBeganEarlier === true ? ` ${EARLIER_PLAN}` : ''}`;
    case 'first-left-out':
      return `First cycle left out: there is no earlier statement to start from. From ${monthWord(addMonths(`${context.month}-01`, 1).slice(0, 7))} it is counted in full.`;
    case 'none-this-month':
      return `No statement dated in ${word}: this card’s spending is in ${context.nextMonth === null ? 'the next' : `${monthWord(context.nextMonth)}’s`} close.`;
    case 'closed-without':
      return 'Not in this close: its statement is not imported. Payments to it this month count as spent instead.';
  }
}

/**
 * The closed month card's lines for the cards on their statement date (card-cycles.md 8.3): which cycle each used, a card left out, a card whose first cycle was, and, always, what a payment made
 * after a card's statement date does (a payment is skipped, so nothing is stored for it). Empty for a household with no such card (CY-I1).
 */
export function cardSummary(
  cards: readonly CardCycle[],
  names: ReadonlyMap<string, string>,
): { readonly byCycle: string | null; readonly notes: readonly string[]; /** The cards left out of the close, which an owner or a partner may put back. */ readonly leftOut: readonly { readonly accountId: string; readonly name: string }[] } {
  if (cards.length === 0) return { byCycle: null, notes: [], leftOut: [] };
  const cycles = cards.filter((card): card is Extract<CardCycle, { kind: 'cycle' }> => card.kind === 'cycle');
  const first = cycles[0];
  const byCycle =
    first === undefined ? null : cycles.length === 1 ? `1 card by its cycle (${formatShortDate(first.from)} – ${formatShortDate(first.to)})` : `${String(cycles.length)} cards by their cycles`;
  const name = (id: string): string => names.get(id) ?? 'A card';
  const notes = ['A card payment made after a card’s statement date counts in this month, and comes off the next.'];
  for (const card of cards) {
    if (card.kind === 'closed-without') notes.push(`${name(card.accountId)} not in this close: its statement is not imported. Payments to it this month count as spent instead.`);
    if (card.kind === 'first-left-out') notes.push(`${name(card.accountId)}’s first cycle is left out: there is no earlier statement to start from.`);
  }
  return { byCycle, notes, leftOut: cards.flatMap((card) => (card.kind === 'closed-without' ? [{ accountId: card.accountId, name: name(card.accountId) }] : [])) };
}
