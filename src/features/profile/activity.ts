/**
 * The audit log in a person's words (docs/design/vibrant-canvas.html, Profile): "Recorded a value · Parag Parikh
 * Flexi Cap", grouped under Today and the days before it, with the time at the right.
 *
 * The log records the table, the row's id, what was done and a snapshot of the row. Nothing in it says "a value was
 * recorded", so the phrase is chosen here from the table and the action, and the name comes from the snapshot, which
 * the repository reads beside it. Pure, so both are tested.
 *
 * Days and times are Kolkata's, whatever the device says: a day here is "which day did that happen", and the app's
 * days are IST everywhere (CLAUDE.md, Time and lifecycle). A device in another zone sees the same entry under the
 * same day, which is the point of an audit trail.
 */

import { istCalendarDate } from '../../lib/dates.ts';

export type ActivityAction = 'insert' | 'update' | 'delete' | 'read';

/**
 * What was done, as a phrase that takes the thing's name after a dot ("Renewed · FD 1"). The ones that cannot stand
 * alone have a form for when there is no name to follow them.
 */
const PHRASES: Record<string, Partial<Record<ActivityAction, string>>> = {
  expense_txn: { insert: 'Added an expense', update: 'Changed an expense', delete: 'Removed an expense' },
  expense_category: { insert: 'Added a category', update: 'Changed a category', delete: 'Removed a category' },
  budget: { insert: 'Set a budget', update: 'Changed a budget', delete: 'Removed a budget' },
  holding: { insert: 'Added a holding', update: 'Changed a holding', delete: 'Removed a holding' },
  instrument: { insert: 'Added an instrument', update: 'Changed an instrument', delete: 'Removed an instrument' },
  valuation_snapshot: { insert: 'Recorded a value', update: 'Corrected a value', delete: 'Removed a value' },
  lot: { insert: 'Recorded a purchase', update: 'Corrected a purchase', delete: 'Removed a purchase' },
  disposal: { insert: 'Recorded a sale', update: 'Corrected a sale', delete: 'Removed a sale' },
  fixed_income_terms: { insert: 'Set the terms', update: 'Changed the terms', delete: 'Removed the terms' },
  deposit_renewal: { insert: 'Renewed', update: 'Changed a renewal', delete: 'Removed a renewal' },
  bond_rating_change: { insert: 'Recorded a rating change', update: 'Corrected a rating change', delete: 'Removed a rating change' },
  insurance_policy: { insert: 'Added a policy', update: 'Changed a policy', delete: 'Removed a policy' },
  liability: { insert: 'Added a loan', update: 'Changed a loan', delete: 'Removed a loan' },
  member: { insert: 'Added a member', update: 'Changed a member', delete: 'Removed a member' },
  membership: { insert: 'Added a membership', update: 'Changed a membership', delete: 'Removed a membership' },
  household: { insert: 'Created the household', update: 'Changed the household', delete: 'Removed the household' },
  invite: { insert: 'Invited', update: 'Changed an invite', delete: 'Removed an invite' },
  import_batch: { insert: 'Imported a statement', update: 'Changed an import', delete: 'Removed an import' },
  fx_rate: { insert: 'Recorded a rate', update: 'Corrected a rate', delete: 'Removed a rate' },
  user_account: { insert: 'Created an account', update: 'Updated an account', delete: 'Removed an account' },
};

/** A phrase that reads as a fragment when nothing follows it, and what to say then. */
const ALONE: Readonly<Record<string, string>> = {
  'Set the terms': "Set a deposit's terms",
  'Changed the terms': "Changed a deposit's terms",
  'Removed the terms': "Removed a deposit's terms",
  Renewed: 'Renewed a deposit',
  Invited: 'Invited someone',
};

const VERB: Record<ActivityAction, string> = { insert: 'Added', update: 'Changed', delete: 'Removed', read: 'Read' };

/**
 * The phrase for one entry. An unknown table falls through to its raw name rather than to a blank, because a table
 * nobody has labelled yet should look unfinished and not invisible.
 */
export function activityPhrase(entity: string, action: ActivityAction): string {
  return PHRASES[entity]?.[action] ?? `${VERB[action]} ${entity.replace(/_/g, ' ')}`;
}

/** The phrase and, when there is one, the name that follows it; a fragment with no name becomes a whole sentence. */
export function activityLine(phrase: string, name: string | null): { readonly lead: string; readonly name: string | null } {
  const trimmed = name === null || name.trim() === '' ? null : name.trim();
  return { lead: trimmed === null ? (ALONE[phrase] ?? phrase) : phrase, name: trimmed };
}

export interface DatedEntry {
  readonly at: string;
}

const IST = 'Asia/Kolkata';

/** The Kolkata calendar day of an instant, as `YYYY-MM-DD`; the entry's own text when it is not a time at all. */
function istDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : istCalendarDate(at);
}

/** The Kolkata day before a Kolkata day. A calendar date has no zone, so the arithmetic is on the date itself. */
function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", or "13 Oct", by Kolkata days. */
export function dayLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const day = istDay(iso);
  const today = istCalendarDate(now);
  if (day === today) return 'Today';
  if (day === dayBefore(today)) return 'Yesterday';
  return at.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
}

/** The time of day in Kolkata: "9:42 pm". */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

/** Entries, in the order given, gathered under their day. Consecutive entries on one day share a heading. */
export function groupByDay<T extends DatedEntry>(
  entries: readonly T[],
  now: Date,
): readonly { readonly label: string; readonly entries: readonly T[] }[] {
  const groups: { label: string; day: string; entries: T[] }[] = [];
  for (const entry of entries) {
    const day = istDay(entry.at);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === day) last.entries.push(entry);
    else groups.push({ label: dayLabel(entry.at, now), day, entries: [entry] });
  }
  return groups.map(({ label, entries: rows }) => ({ label, entries: rows }));
}
