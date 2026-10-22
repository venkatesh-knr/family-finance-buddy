/**
 * Profile: who you are here, and what the app will tell you about itself.
 *
 * Drawn as docs/design/vibrant-canvas.html draws it: who you are and in which household, how you sign in, how
 * many of your entries are private and the entries themselves, what has been done in this household in plain
 * words, and Sign out at the foot.
 *
 * Section 20's argument is still the point. Every claim this app makes about privacy is a claim a member has to
 * take on trust unless there is somewhere to go and check it: "if a spouse can see that her salary entry was
 * viewed, the conversation stops being 'please trust me' and becomes 'check for yourself'." So the private-entry
 * count has the entries behind it, and the activity list says what each entry was about. Both are the app being
 * inspectable about itself rather than reassuring about itself.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHouseholdChoice } from '../../app/household.tsx';
import { roleSummary } from '../../domain/access.ts';
import { formatIsoDate, istCalendarDate } from '../../lib/dates.ts';
import { formatMoney } from '../../lib/money.ts';
import { passwordProblem } from '../../lib/password.ts';
import { changePassword, signOut, totpStatus, verifyTotpCode, type TotpStatus } from '../../repo/auth.ts';
import { listExpenses } from '../../repo/expenses.ts';
import {
  activityNames,
  listMyPrivateEntries,
  listRecentActivity,
  myPrivateEntryCount,
  type ActivityEntry,
  type PrivateEntries,
  type PrivateEntryCount,
} from '../../repo/profile.ts';
import { Button, Caveat, Field, Notice, PasswordField, Pill, Problem } from '../../ui/primitives.tsx';
import { ShowMore, useReveal } from '../../ui/ShowMore.tsx';
import { activityLine, activityPhrase, clockTime, groupByDay } from './activity.ts';

function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="setrow-chevron"
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ProfileScreen({ email, householdId, privacy }: { email: string | null; householdId: string | null; privacy: boolean }) {
  const { current } = useHouseholdChoice();
  const [counts, setCounts] = useState<PrivateEntryCount | null>(null);
  const [activity, setActivity] = useState<readonly ActivityEntry[] | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [who, setWho] = useState<{ memberId: string; displayName: string } | null>(null);
  const [totp, setTotp] = useState<TotpStatus | null>(null);
  const reveal = useReveal(activity?.length ?? 0);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Which of the panels under a row or a button is open. One at a time would hide what a person opened to compare.
  const [openPassword, setOpenPassword] = useState(false);
  const [openTotp, setOpenTotp] = useState(false);
  const [openEntries, setOpenEntries] = useState(false);
  const [openHow, setOpenHow] = useState(false);

  // The household id changes as the shell settles on which household it is showing; only the latest read counts.
  const latest = useMemo(() => ({ n: 0 }), []);

  const load = useCallback(async () => {
    if (householdId === null) {
      setLoading(false);
      return;
    }
    latest.n += 1;
    const mine = latest.n;
    setLoading(true);
    try {
      // Separately, and none of them is allowed to take another down. A failure to read the log should not hide
      // the private-entry count, which is the one figure on this screen a member may specifically have come for.
      const [countResult, activityResult, listingResult, totpResult] = await Promise.allSettled([
        myPrivateEntryCount(householdId),
        listRecentActivity(householdId),
        listExpenses({ limit: 1, householdId }),
        totpStatus(),
      ]);
      if (mine !== latest.n) return;

      setCounts(countResult.status === 'fulfilled' ? countResult.value : null);
      const entries = activityResult.status === 'fulfilled' ? activityResult.value : null;
      setActivity(entries);
      if (listingResult.status === 'fulfilled') {
        const listing = listingResult.value;
        const me = listing.members.find((member) => member.id === listing.viewer.memberId);
        setWho(me === undefined ? null : { memberId: me.id, displayName: me.displayName });
      } else {
        setWho(null);
      }
      setTotp(totpResult.status === 'fulfilled' ? totpResult.value : null);
      setProblem(
        countResult.status === 'rejected' && activityResult.status === 'rejected'
          ? 'Could not read your profile just now.'
          : null,
      );
      if (entries !== null) {
        const named = await activityNames(entries);
        if (mine === latest.n) setNames(named);
      }
    } finally {
      if (mine === latest.n) setLoading(false);
    }
  }, [householdId, latest]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = counts === null ? 0 : counts.expenses + counts.holdings;
  const displayName = who?.displayName ?? email ?? 'You';
  const role = current?.role ?? null;
  const groups = useMemo(
    () => groupByDay((activity ?? []).slice(0, reveal.shown), new Date()),
    [activity, reveal.shown],
  );

  return (
    <div className="flex flex-col gap-4.5">
      {/* Who you are here. The one lifted surface on the screen. */}
      <section className="card card-lift profile-hero" aria-label="You">
        <span className="avatar profile-avatar" aria-hidden="true">
          {displayName.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="profile-name">{displayName}</span>
          <span className="note block">{current?.household.name ?? '—'}</span>
        </span>
        {role !== null && <Pill tone="own">{role}</Pill>}
        <p className="note profile-permits">{roleSummary(role)}</p>
      </section>

      {problem !== null && <Problem>{problem}</Problem>}

      {/* How you sign in. */}
      <section className="setgrp" aria-label="Sign-in">
        <div className="setrow">
          <span className="sk">Email</span>
          <span className="sv">{email ?? '—'}</span>
        </div>

        <button
          type="button"
          className="setrow setrow-button"
          aria-expanded={openPassword}
          onClick={() => {
            setOpenPassword((was) => !was);
          }}
        >
          <span className="sk">Password</span>
          <span className="sv" style={{ color: 'var(--ink)' }}>
            Change
          </span>
          <Chevron open={openPassword} />
        </button>
        {openPassword && (
          <ChangePassword
            onDone={() => {
              setOpenPassword(false);
            }}
          />
        )}

        <button
          type="button"
          className="setrow setrow-button"
          aria-expanded={openTotp}
          onClick={() => {
            setOpenTotp((was) => !was);
          }}
        >
          <span className="sk">Two-step sign-in</span>
          <span className="sv" style={{ color: totp?.enrolled === false ? 'var(--coral)' : 'var(--ink)' }}>
            {loading ? '' : totp === null ? 'Could not be read' : totp.enrolled ? '✓ On' : 'Off'}
          </span>
          <Chevron open={openTotp} />
        </button>
        {openTotp && (
          <div className="setpanel">
            <p>
              Signing in asks for a six-digit code from your authenticator app as well as your password. It is
              required for every member, so it cannot be turned off.
              {totp?.since != null && <> Set up on {formatIsoDate(istCalendarDate(new Date(totp.since)))}.</>}
            </p>
            <p className="note mt-2">
              Replacing the authenticator app is not something this screen does yet: a replacement that went wrong
              would lock you out of your own records.
            </p>
          </div>
        )}
      </section>

      {/* How many of your entries are private, and which. */}
      <section className="card" aria-label="Your privacy">
        {loading ? (
          <p className="note">Reading…</p>
        ) : counts === null ? (
          <Notice tone="due">
            Your private entries could not be counted just now. That is this screen failing, not a statement that
            you have none.
          </Notice>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <span className="asset-tile asset-tile-compact" aria-hidden="true" style={{ ['--tile' as string]: 'var(--muted)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold" style={{ color: 'var(--ink)' }}>
                  {total === 0
                    ? 'None of your entries are private'
                    : `${String(total)} of your entries ${total === 1 ? 'is' : 'are'} private`}
                </span>
                <span className="note block">Others see them only inside your total</span>
              </span>
            </div>
            <div className="profile-actions">
              {total > 0 && who !== null && (
                <button
                  type="button"
                  className="disclosure"
                  aria-expanded={openEntries}
                  onClick={() => {
                    setOpenEntries((was) => !was);
                  }}
                >
                  See them
                  <Chevron open={openEntries} />
                </button>
              )}
              <button
                type="button"
                className="disclosure"
                aria-expanded={openHow}
                onClick={() => {
                  setOpenHow((was) => !was);
                }}
              >
                How it works
                <Chevron open={openHow} />
              </button>
            </div>

            {openEntries && who !== null && householdId !== null && (
              <MyPrivateEntries householdId={householdId} memberId={who.memberId} privacy={privacy} />
            )}
            {openHow && (
              <p className="note mt-2.5">
                Nobody else in this household can read those rows, the owner included: the database refuses them
                rather than the screen hiding them. Their amounts still count in household totals, where they
                appear to others as a single figure with no detail. With only one private entry, anyone who adds
                up the rest can work out its amount from the total.
              </p>
            )}
          </>
        )}
      </section>

      {/* What has been done in this household, in plain words. */}
      <section className="card" aria-label="Recent activity">
        <header className="mb-1 flex items-baseline justify-between gap-2">
          <h2 className="card-title font-sans">Recent activity</h2>
          <span className="note">this household</span>
        </header>

        {loading ? (
          <p className="note">Reading…</p>
        ) : activity === null ? (
          <Notice tone="due">The activity log could not be read just now.</Notice>
        ) : activity.length === 0 ? (
          <p className="note">Nothing recorded yet.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <h3 className="recent-day">{group.label}</h3>
              <ul className="recent-rows">
                {group.entries.map((entry) => {
                  const line = activityLine(activityPhrase(entry.entity, entry.action), names.get(entry.id) ?? null);
                  return (
                    <li key={entry.id} className="activity-row">
                      <span className="min-w-0 flex-1">
                        <span className="note">{line.lead}</span>
                        {line.name !== null && <span style={{ color: 'var(--ink)' }}> · {line.name}</span>}
                        {entry.actor === null && (
                          <>
                            {' '}
                            <Pill tone="neutral">Scheduled</Pill>
                          </>
                        )}
                      </span>
                      <span className="tabular-nums note">
                        {entry.isMine ? 'you · ' : ''}
                        {clockTime(entry.at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
        <ShowMore hidden={reveal.hidden} onMore={reveal.more} noun="entries" />

        <p className="note profile-note">
          <span>
            Shows changes, not who viewed what.
            <Caveat tone="info" label="What this log does not record">
              Postgres fires no trigger when a row is looked at, so recording who read what means routing every read
              through a function that writes one first: built deliberately, or not at all. Until then an absence here
              means nobody changed anything, not that nobody looked. Another member&rsquo;s private entries are missing
              from this list exactly as they are missing from the ledger: the log applies the same rule as the row it
              describes.
            </Caveat>
          </span>
        </p>
      </section>

      <button
        type="button"
        className="profile-signout"
        onClick={() => {
          void signOut();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
          <path d="M10 17l-5-5 5-5" />
          <path d="M5 12h11" />
        </svg>
        <span>Sign out</span>
      </button>
    </div>
  );
}

/**
 * A new password, typed twice, checked against the project's rule before it is sent.
 *
 * The password is held in this component's state while it is typed and nowhere else: not stored, not logged, not
 * passed up. The server applies its own rules and what it says is shown as it said it.
 */
function ChangePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const wrong = passwordProblem(password, confirmation);
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setProblem('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      // A fresh code first: changing the credential is a sensitive action, and a signed-in device that has been left
      // unlocked should not be enough to take the account (blueprint, security layer 4).
      await verifyTotpCode(code);
      await changePassword(password);
      setPassword('');
      setConfirmation('');
      setCode('');
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="setpanel" role="status">
        <p>Your password is changed.</p>
        <div className="mt-2.5">
          <Button type="button" variant="quiet" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="setpanel flex flex-col gap-3"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <PasswordField
        label="New password"
        autoComplete="new-password"
        hint="At least 12 characters, with upper and lower case, a digit and a symbol."
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
      />
      <PasswordField
        label="New password again"
        autoComplete="new-password"
        value={confirmation}
        onChange={(event) => {
          setConfirmation(event.target.value);
        }}
      />
      <Field
        label="Six-digit code"
        hint="From your authenticator app, to confirm it is you."
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        numeric
        value={code}
        onChange={(event) => {
          setCode(event.target.value.replace(/\D/g, ''));
        }}
      />
      {problem !== null && <Problem>{problem}</Problem>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || password === '' || confirmation === '' || code === ''}>
          {busy ? 'Saving…' : 'Change password'}
        </Button>
        <button type="button" className="note underline" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The entries the count counts, so the number can be checked against what it is a number of. */
function MyPrivateEntries({ householdId, memberId, privacy }: { householdId: string; memberId: string; privacy: boolean }) {
  const [entries, setEntries] = useState<PrivateEntries | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    listMyPrivateEntries(householdId, memberId)
      .then((next) => {
        if (live) setEntries(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [householdId, memberId]);

  if (failed) return <Notice tone="due">Your private entries could not be read just now.</Notice>;
  if (entries === null) return <p className="note mt-2.5">Reading…</p>;

  return (
    <div className="mt-2.5">
      <ul className="recent-rows">
        {entries.expenses.map((expense) => (
          <li key={expense.id} className="activity-row">
            <span className="min-w-0 flex-1">
              <span style={{ color: 'var(--ink)' }}>{expense.payee ?? 'An expense'}</span>
              <span className="note"> · {formatIsoDate(expense.date)}</span>
            </span>
            <span className="flex items-center gap-2">
              {expense.isVoided && <Pill tone="due">Voided</Pill>}
              <span className="tabular-nums" style={{ textDecoration: expense.isVoided ? 'line-through' : undefined }}>
                {formatMoney(expense.amount, { privacy })}
              </span>
            </span>
          </li>
        ))}
        {entries.holdings.map((holding) => (
          <li key={holding.id} className="activity-row">
            <span style={{ color: 'var(--ink)' }}>{holding.name}</span>
            <span className="note">{holding.isArchived ? 'a holding, archived' : 'a holding'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
