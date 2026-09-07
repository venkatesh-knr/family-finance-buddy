/**
 * Profile — who you are here, and what the app will tell you about itself.
 *
 * Section 20's argument, in one screen. Every claim this app makes about
 * privacy is a claim a member has to take on trust unless there is somewhere
 * to go and check it: "if a spouse can see that her salary entry was viewed,
 * the conversation stops being 'please trust me' and becomes 'check for
 * yourself'."
 *
 * So the two things here that matter are the private-entry count and the
 * activity list. Both are the app being inspectable about itself rather than
 * reassuring about itself, and the difference is the whole point.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  listRecentActivity,
  myPrivateEntryCount,
  type ActivityEntry,
  type PrivateEntryCount,
} from '../../repo/profile.ts';
import { useHouseholdChoice } from '../../app/household.tsx';
import { Card, Notice, Pill, Problem } from '../../ui/primitives.tsx';

export function ProfileScreen({ email, householdId }: { email: string | null; householdId: string | null }) {
  const { current } = useHouseholdChoice();
  const [counts, setCounts] = useState<PrivateEntryCount | null>(null);
  const [activity, setActivity] = useState<readonly ActivityEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (householdId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Separately, and neither is allowed to take the other down. A failure
      // to read the log should not hide the private-entry count, which is the
      // one figure on this screen a member may specifically have come for.
      const [countResult, activityResult] = await Promise.allSettled([
        myPrivateEntryCount(householdId),
        listRecentActivity(householdId),
      ]);

      setCounts(countResult.status === 'fulfilled' ? countResult.value : null);
      setActivity(activityResult.status === 'fulfilled' ? activityResult.value : null);
      setProblem(
        countResult.status === 'rejected' && activityResult.status === 'rejected'
          ? 'Could not read your profile just now.'
          : null,
      );
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = counts === null ? 0 : counts.expenses + counts.holdings;

  return (
    <div className="flex flex-col gap-4.5">
      <Card
        // The membership carries a member id, not a display name. Fetching the
        // member row only to title this card would be a round trip for a
        // heading; the email is who they signed in as and is already here.
        title={email ?? 'You'}
        aside={current === null ? undefined : <Pill tone="own">{current.role}</Pill>}
      >
        <dl className="flex flex-wrap gap-x-9 gap-y-2.5">
          <div>
            <dt className="micro-label">Signed in as</dt>
            <dd style={{ color: 'var(--ink)' }}>{email ?? '—'}</dd>
          </div>
          <div>
            <dt className="micro-label">Household</dt>
            <dd style={{ color: 'var(--ink)' }}>{current?.household.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="micro-label">Role</dt>
            <dd style={{ color: 'var(--ink)' }}>{current?.role ?? '—'}</dd>
          </div>
        </dl>
        <p className="note mt-3">
          Owner is the highest privilege in this system. There is no account above it, and no
          developer account behind it.
        </p>
      </Card>

      {problem !== null && <Problem>{problem}</Problem>}

      <Card title="Your privacy">
        {loading ? (
          <p className="note">Reading…</p>
        ) : counts === null ? (
          <Notice tone="due">
            Your private entries could not be counted just now. That is this screen failing, not a
            statement that you have none.
          </Notice>
        ) : (
          <>
            <p style={{ color: 'var(--ink)' }}>
              {total === 0 ? (
                <>None of your entries are private.</>
              ) : (
                <>
                  <strong>
                    {total} of your {total === 1 ? 'entries is' : 'entries are'} private
                  </strong>{' '}
                  — {counts.expenses} {counts.expenses === 1 ? 'expense' : 'expenses'} and{' '}
                  {counts.holdings} {counts.holdings === 1 ? 'holding' : 'holdings'}.
                </>
              )}
            </p>
            <p className="note mt-2.5">
              Nobody else in this household can read those rows, the owner included — the database
              refuses them rather than the screen hiding them. Their amounts still count in
              household totals, where they appear to others as a single figure with no detail.
            </p>
          </>
        )}
      </Card>

      <Card title="Recent activity" aside={<span className="note">This household</span>}>
        {loading ? (
          <p className="note">Reading…</p>
        ) : activity === null ? (
          <Notice tone="due">The activity log could not be read just now.</Notice>
        ) : activity.length === 0 ? (
          <p className="note">Nothing recorded yet.</p>
        ) : (
          <ul className="row-separated">
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2.5 py-2">
                <span style={{ color: 'var(--ink)' }}>
                  {VERB[entry.action]} <span className="note">{ENTITY[entry.entity] ?? entry.entity}</span>
                </span>
                <span className="flex items-center gap-2.5">
                  {entry.isMine && <Pill tone="own">You</Pill>}
                  {entry.actor === null && <Pill tone="neutral">Scheduled</Pill>}
                  <span className="num note">{when(entry.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3.5">
          <Notice>
            This records changes, not reads. Postgres fires no trigger when a row is looked at, so
            recording who read what means routing every read through a function that writes one
            first — built deliberately, or not at all. Until then an absence here means nobody
            changed anything, not that nobody looked.
          </Notice>
        </div>

        <p className="note mt-2.5">
          Another member's private entries are missing from this list exactly as they are missing
          from the ledger: the log applies the same rule as the row it describes.
        </p>
      </Card>
    </div>
  );
}

const VERB: Record<ActivityEntry['action'], string> = {
  insert: 'Added',
  update: 'Changed',
  delete: 'Removed',
  read: 'Read',
};

/**
 * Table names are how the database says it; they are not how a person says it.
 * An unknown one falls through to the raw name rather than to a blank, because
 * a new table nobody has labelled yet should look unfinished, not invisible.
 */
const ENTITY: Record<string, string> = {
  expense_txn: 'an expense',
  expense_category: 'a category',
  budget: 'a budget',
  holding: 'a holding',
  instrument: 'an instrument',
  valuation_snapshot: 'a valuation',
  member: 'a member',
  membership: 'a membership',
  household: 'the household',
  invite: 'an invite',
  liability: 'a liability',
  insurance_policy: 'a policy',
};

/**
 * A timestamp read as a person would say it, in their own device's zone.
 *
 * Deliberately not the IST rule that governs period boundaries: this is "when
 * did that happen", not "which month does it count in". Confusing the two is
 * how a spend lands in the wrong tax year.
 */
function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
