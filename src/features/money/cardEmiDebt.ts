/**
 * A card's EMI plans as one debt, kept from its statements (docs/design/card-cycles.md 4a; CY-I17). The figures are worked out by `src/domain/cardEmiDebt.ts`; this file chooses which of a card's
 * recorded dues are read, names the debt, and writes what the domain says. Only an owner or a partner writes a debt.
 */

import { formatShortDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { cardEmiOutstanding, planCardEmiDebt, type EmiFigures } from '../../domain/cardEmiDebt.ts';
import { addCardDebt, listCardDebts, setCardDebtState } from '../../repo/cardDebt.ts';
import { listAccounts, listBalances } from '../../repo/accounts.ts';
import type { Account, AccountBalance, HouseholdRole } from '../../repo/types.ts';
import { titleOf } from './accountRows.ts';
import { cycleDues } from './closeMonth.ts';

/** The debt's name, from the card's: "HDFC Regalia ••1188 — EMI plans". */
export function cardDebtName(account: Pick<Account, 'name' | 'last4'>): string {
  // A card the import added is named with its last four already ("HDFC Bank ••1188"): they are not said twice.
  const title = account.last4 !== null && account.last4 !== '' && account.name.includes(`••${account.last4}`) ? account.name : titleOf(account);
  return `${title} — EMI plans`;
}

/** What a card's recorded dues say of its EMI plans: the dues the close reads, a statement's beating a typed one, each with what it converted and the principal it billed. */
export function emiFiguresOf(balances: readonly AccountBalance[], accountId: string): EmiFigures[] {
  return cycleDues(balances, accountId).map((due) => ({ asAt: due.asAt, converted: due.emiConvertedMinor ?? 0n, principal: due.emiPrincipalMinor ?? 0n }));
}

/** Whether a card's dues record a conversion: the plans a debt is made from. Principal billed on its own is not one. */
export function hasConversion(balances: readonly AccountBalance[], accountId: string): boolean {
  return emiFiguresOf(balances, accountId).some((each) => each.converted > 0n);
}

/** Whether a card has recorded any EMI figure at all, whether or not its plans are in the household's debts. */
export function hasEmiFigures(balances: readonly AccountBalance[], accountId: string): boolean {
  return emiFiguresOf(balances, accountId).some((each) => each.converted > 0n || each.principal > 0n);
}

/** What a card's EMI plans owe, as at its latest statement, from what is recorded. Null when no figure is recorded. */
export function emiOwed(balances: readonly AccountBalance[], account: Pick<Account, 'id' | 'currency'>): Money | null {
  return hasEmiFigures(balances, account.id) ? money(cardEmiOutstanding(emiFiguresOf(balances, account.id)).outstanding, account.currency) : null;
}

/** What a card's row on Accounts says of its EMI plans (card-cycles.md 4a): owed and in the household's debts, or not in them. */
export function emiPlanLine(input: { readonly inDebts: boolean; readonly owed: Money; readonly asOf: IsoDate | null; readonly privacy: boolean; readonly unmatched?: boolean }): string {
  const amount = formatMoney(input.owed, { privacy: input.privacy });
  const caveat = input.unmatched === true ? ', not counting plans begun before the card’s first statement' : '';
  if (!input.inDebts) return `EMI plans not in your debts (${amount} owed${caveat})`;
  const when = input.asOf === null ? '' : `, as at ${formatShortDate(input.asOf)}`;
  return input.owed.minor === 0n ? `EMI plans: paid off, in your debts${when}` : `EMI plans: ${amount} owed${caveat}, in your debts${when}`;
}

/**
 * A card's line on Accounts about its EMI plans: what the household's debt for them says, when it has one, and whether that is behind what the card's statements now say; or, with none, what the
 * statements say is owed, offered for the debts once a conversion is recorded. Null otherwise: principal billed on its own makes no debt.
 */
export function cardEmiDebtLine(
  balances: readonly AccountBalance[],
  card: Pick<Account, 'id' | 'currency'>,
  debts: readonly { readonly cardAccountId: string; readonly outstanding: bigint | null; readonly asOf: IsoDate | null }[],
  privacy: boolean,
): { readonly text: string; readonly inDebts: boolean; readonly behind: boolean } | null {
  const debt = debts.find((each) => each.cardAccountId === card.id) ?? null;
  const worked = cardEmiOutstanding(emiFiguresOf(balances, card.id));
  if (debt === null) {
    if (!hasConversion(balances, card.id)) return null;
    return { text: emiPlanLine({ inDebts: false, owed: money(worked.outstanding, card.currency), asOf: worked.asOf, privacy, unmatched: worked.unmatched }), inDebts: false, behind: false };
  }
  const behind = debt.outstanding !== worked.outstanding || debt.asOf !== worked.asOf;
  const owed = money(debt.outstanding ?? 0n, card.currency);
  return { text: emiPlanLine({ inDebts: true, owed, asOf: debt.asOf, privacy, unmatched: worked.unmatched }), inDebts: true, behind };
}

/**
 * Bring every card's debt up to what its statements say: a card that has one has it kept, and a card that has none gets one when `add` says so and it has converted something. A role other than
 * an owner or a partner writes nothing, as the policies would refuse it. Returns how many debts were made or changed.
 */
export async function syncCardEmiDebts(input: { readonly householdId: string; readonly role: HouseholdRole; readonly add: (card: Account) => boolean }): Promise<number> {
  if (input.role !== 'owner' && input.role !== 'partner') return 0;
  const [accounts, balances, debts] = await Promise.all([listAccounts(input.householdId, { includeArchived: true }), listBalances(input.householdId), listCardDebts(input.householdId)]);
  let changed = 0;
  for (const card of accounts.filter((account) => account.type === 'card')) {
    const debt = debts.find((each) => each.cardAccountId === card.id) ?? null;
    const plan = planCardEmiDebt({ rows: emiFiguresOf(balances, card.id), debt, add: input.add(card) });
    if (plan === null) continue;
    const outstanding = money(plan.outstanding, card.currency);
    if (plan.create) {
      await addCardDebt({ householdId: input.householdId, cardAccountId: card.id, memberId: card.memberId, name: cardDebtName(card), outstanding, asOf: plan.asOf, closed: plan.closed });
    } else if (debt !== null) {
      await setCardDebtState({ id: debt.id, outstanding, asOf: plan.asOf, closed: plan.closed, changesStatus: plan.changesStatus });
    }
    changed += 1;
  }
  return changed;
}
