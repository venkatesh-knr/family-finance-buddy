/**
 * The audit log in a person's words (docs/design/vibrant-canvas.html, Profile): "Recorded a value · Parag Parikh
 * Flexi Cap", grouped under Today and the days before it, with the time at the right.
 *
 * The log records the table, the row's id and what was done. Nothing in it says "a value was recorded", and
 * nothing in it holds a name, so the phrase is chosen here from the table and the action and the name is looked up
 * beside it by the repository. Pure, so both are tested.
 */

export type ActivityAction = 'insert' | 'update' | 'delete' | 'read';

/** What was done, as a sentence that can stand alone or take a name after a dot. */
const PHRASES: Record<string, Partial<Record<ActivityAction, string>>> = {
  expense_txn: { insert: 'Added an expense', update: 'Changed an expense', delete: 'Removed an expense' },
  expense_category: { insert: 'Added a category', update: 'Changed a category', delete: 'Removed a category' },
  budget: { insert: 'Set a budget', update: 'Changed a budget', delete: 'Removed a budget' },
  holding: { insert: 'Added a holding', update: 'Changed a holding', delete: 'Removed a holding' },
  instrument: { insert: 'Added an instrument', update: 'Changed an instrument', delete: 'Removed an instrument' },
  valuation_snapshot: { insert: 'Recorded a value', update: 'Corrected a value', delete: 'Removed a value' },
  lot: { insert: 'Recorded a purchase', update: 'Corrected a purchase', delete: 'Removed a purchase' },
  disposal: { insert: 'Recorded a sale', update: 'Corrected a sale', delete: 'Removed a sale' },
  fixed_income_terms: { insert: 'Set the terms of', update: 'Changed the terms of', delete: 'Removed the terms of' },
  deposit_renewal: { insert: 'Renewed', update: 'Changed a renewal', delete: 'Removed a renewal' },
  insurance_policy: { insert: 'Added a policy', update: 'Changed a policy', delete: 'Removed a policy' },
  liability: { insert: 'Added a loan', update: 'Changed a loan', delete: 'Removed a loan' },
  member: { insert: 'Added a member', update: 'Changed a member', delete: 'Removed a member' },
  membership: { insert: 'Added a membership', update: 'Changed a membership', delete: 'Removed a membership' },
  household: { insert: 'Created the household', update: 'Changed the household', delete: 'Removed the household' },
  invite: { insert: 'Invited', update: 'Changed an invite', delete: 'Removed an invite' },
  import_batch: { insert: 'Imported a statement', update: 'Changed an import', delete: 'Removed an import' },
  fx_rate: { insert: 'Recorded a rate', update: 'Corrected a rate', delete: 'Removed a rate' },
};

const VERB: Record<ActivityAction, string> = { insert: 'Added', update: 'Changed', delete: 'Removed', read: 'Read' };

/**
 * The sentence for one entry. An unknown table falls through to its raw name rather than to a blank, because a
 * table nobody has labelled yet should look unfinished and not invisible.
 */
export function activityPhrase(entity: string, action: ActivityAction): string {
  return PHRASES[entity]?.[action] ?? `${VERB[action]} ${entity.replace(/_/g, ' ')}`;
}

/** Whether a phrase ends in the thing's name: "Set the terms of" and "Invited" read on into one. */
export function activityLine(phrase: string, name: string | null): { readonly lead: string; readonly name: string | null } {
  return { lead: phrase, name: name === null || name.trim() === '' ? null : name.trim() };
}

export interface DatedEntry {
  readonly at: string;
}

/** A calendar day as the device's own clock reads it: this is "when did that happen", not a period boundary. */
function localDay(at: Date): string {
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

/** "Today", "Yesterday", or "13 Oct", from `now` and the entry's own time. */
export function dayLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  if (localDay(at) === localDay(now)) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (localDay(at) === localDay(yesterday)) return 'Yesterday';
  return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The time of day: "9:42 pm". */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

/** Entries, in the order given, gathered under their day. Consecutive entries on one day share a heading. */
export function groupByDay<T extends DatedEntry>(
  entries: readonly T[],
  now: Date,
): readonly { readonly label: string; readonly entries: readonly T[] }[] {
  const groups: { label: string; day: string; entries: T[] }[] = [];
  for (const entry of entries) {
    const at = new Date(entry.at);
    const day = Number.isNaN(at.getTime()) ? entry.at : localDay(at);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === day) last.entries.push(entry);
    else groups.push({ label: dayLabel(entry.at, now), day, entries: [entry] });
  }
  return groups.map(({ label, entries: rows }) => ({ label, entries: rows }));
}
