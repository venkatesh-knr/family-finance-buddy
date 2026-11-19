/**
 * A category for an imported line (docs/build-plan.md step 7: "Guess the category, and be obviously guessing").
 *
 * A statement line says `UPI/RAZORPAY/8817` and not which envelope it belongs in, and a wrong category that arrived silently is worse than a blank. So a category is suggested only
 * from what this household has filed before, by payee, never from a list of keywords that ships with the app and knows nothing about how this family spends; a payee never filed gets no
 * suggestion; and every suggestion says what it rests on, so it reads as a guess and can be changed in the preview. Pure: the lines, the household's filed entries and its active
 * categories in; a suggestion or nothing for each line out.
 */

import type { IsoDate } from '../../lib/dates.ts';

/** An entry the household has filed, as a suggestion needs it. */
export interface HistoryEntry {
  readonly payee: string | null;
  readonly categoryId: string | null;
  readonly date: IsoDate;
  readonly amountMinor: bigint;
}

export interface Suggestion {
  readonly categoryId: string;
  /** `repeat`: the same amount to this payee was filed under it before. `payee`: only the payee was. */
  readonly basis: 'repeat' | 'payee';
  /** How many times the payee has been filed under it. */
  readonly count: number;
}

/** The shortest a payee may be, once normalised, for one cut short by a statement to be matched against the whole name. */
const PREFIX_FROM = 6;

/** A payee as it is compared: upper case, letters and digits only, and without a trailing number, so a statement's spelling matches a typed one. */
export function normalisePayee(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word, index, words) => !(index === words.length - 1 && words.length > 1 && /^\d+$/.test(word)))
    .join('');
}

interface Used {
  count: number;
  last: IsoDate;
  readonly amounts: Set<bigint>;
}

export function suggestCategories(input: {
  readonly lines: readonly { readonly payee: string | null; readonly amountMinor: bigint }[];
  readonly history: readonly HistoryEntry[];
  /** The household's categories that are in use: one archived, or not the household's, is never suggested. */
  readonly active: ReadonlySet<string>;
}): (Suggestion | null)[] {
  // For each payee as it is compared, the categories it has been filed under, how often and when.
  const memory = new Map<string, Map<string, Used>>();
  for (const filed of input.history) {
    if (filed.payee === null || filed.categoryId === null || !input.active.has(filed.categoryId)) continue;
    const key = normalisePayee(filed.payee);
    if (key === '') continue;
    const categories = memory.get(key) ?? new Map<string, Used>();
    const used = categories.get(filed.categoryId) ?? { count: 0, last: filed.date, amounts: new Set<bigint>() };
    used.count += 1;
    if (filed.date > used.last) used.last = filed.date;
    used.amounts.add(filed.amountMinor);
    categories.set(filed.categoryId, used);
    memory.set(key, categories);
  }

  return input.lines.map((line) => {
    if (line.payee === null) return null;
    const key = normalisePayee(line.payee);
    if (key === '') return null;

    // The payee exactly; or, when a statement cut a name short (or the household typed the short one), a payee that begins with the other, from six letters.
    const matches: Map<string, Used>[] = [];
    const exact = memory.get(key);
    if (exact !== undefined) matches.push(exact);
    else {
      for (const [other, categories] of memory) {
        const shorter = Math.min(other.length, key.length);
        if (shorter >= PREFIX_FROM && (other.startsWith(key) || key.startsWith(other))) matches.push(categories);
      }
    }
    if (matches.length === 0) return null;

    const total = new Map<string, Used>();
    for (const categories of matches) {
      for (const [categoryId, used] of categories) {
        const into = total.get(categoryId) ?? { count: 0, last: used.last, amounts: new Set<bigint>() };
        into.count += used.count;
        if (used.last > into.last) into.last = used.last;
        for (const amount of used.amounts) into.amounts.add(amount);
        total.set(categoryId, into);
      }
    }
    // The category used most; the latest when two are used the same number of times.
    const [best] = [...total.entries()].sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last));
    if (best === undefined) return null;
    return { categoryId: best[0], basis: best[1].amounts.has(line.amountMinor) ? 'repeat' : 'payee', count: best[1].count };
  });
}

/** What a suggestion rests on, in words: it always says it is a suggestion. */
export function suggestionWords(suggestion: Suggestion, categoryName: string): string {
  if (suggestion.basis === 'repeat') return `Suggested: the same amount to this payee was filed under ${categoryName} before.`;
  const times = suggestion.count === 1 ? 'once' : `${String(suggestion.count)} times`;
  return `Suggested: you have filed this payee under ${categoryName} ${times}.`;
}
