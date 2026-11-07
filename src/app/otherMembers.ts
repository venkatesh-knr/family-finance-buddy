/**
 * What Mine leaves out, said (docs/design/simple-layout.md section 2a).
 *
 * Mine is the holdings recorded under the signed-in member, so a class the household holds under somebody else's name is not on
 * the screen at all: no row, no tab, no share. Without a word about it that reads as a holding that has gone missing, which is
 * how the first person to use the switch took it. This is the word: which classes, and how many holdings, under other members.
 * It names no amount, because an amount would be a second calculation of what Household already works out.
 */

export interface HeldBy {
  readonly memberId: string;
  readonly kind: string;
}

/** "gold", "gold and deposits", "gold, deposits and bonds": most holdings first, and the class's own name each time. */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * The sentence, or null when everything the household holds is the signed-in member's (or nothing is held). `held` is what is held
 * now: archived and paid-out holdings are left out by the caller, as every other figure leaves them out.
 */
export function othersHoldNote(held: readonly HeldBy[], mine: string | null, label: (kind: string) => string): string | null {
  if (mine === null) return null;
  const others = held.filter((h) => h.memberId !== mine);
  if (others.length === 0) return null;
  const perKind = new Map<string, number>();
  for (const h of others) perKind.set(h.kind, (perKind.get(h.kind) ?? 0) + 1);
  const kinds = [...perKind.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind]) => label(kind).toLowerCase());
  const count = others.length;
  return `Other members hold ${listed(kinds)} (${String(count)} ${count === 1 ? 'holding' : 'holdings'}), which is not in your figures: choose Household to see ${count === 1 ? 'it' : 'them'}.`;
}
