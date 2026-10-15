/**
 * The household: who is in it, and who has been invited.
 *
 * The screen exists mostly for one job — issuing an invite — and it is arranged
 * around the awkward fact at the heart of that job: the code is shown once and
 * then cannot be recovered. So it is displayed large, copyable, and with the
 * consequence stated rather than implied.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import {
  createInvite,
  inviteState,
  listInvites,
  revokeInvite,
  setMemberRole,
  type Invite,
  type InviteState,
} from '../../repo/invites.ts';
import { listExpenses } from '../../repo/expenses.ts';
import { memberMarks, type MemberMark } from '../expenses/memberMark.ts';
import {
  HOUSEHOLD_ROLES,
  MEMBER_COLOURS,
  type ExpenseListing,
  type HouseholdRole,
  type Member,
  type MemberColour,
} from '../../repo/types.ts';
import { Button, Card, Field, Pill, Problem } from '../../ui/primitives.tsx';

export function HouseholdScreen({ householdId }: { householdId: string | null }) {
  const [listing, setListing] = useState<ExpenseListing | null>(null);
  const [invites, setInvites] = useState<readonly Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  // Held here rather than inside the form, because revoking an invite has to
  // take its code off the screen — a revoked code shown under "give them this"
  // is worse than no code at all.
  const [issued, setIssued] = useState<{ code: string; validForDays: number } | null>(null);
  // The invitation form opens from the Invite button and closes when it is done with; the members who are no
  // longer in the household, and the invitations, are one fold under the list.
  const [inviting, setInviting] = useState(false);
  const [rest, setRest] = useState(false);

  // The household id changes as the shell settles on which household it is showing, and a read for the one it
  // started with can come back after a read for the one it ended on. The latest request is the only one that counts,
  // or the screen shows one household's members under another's name.
  const latest = useRef(0);

  const load = useCallback(async () => {
    latest.current += 1;
    const mine = latest.current;
    try {
      const [next, open] = await Promise.all([
        listExpenses(householdId === null ? { limit: 1 } : { limit: 1, householdId }),
        listInvites(householdId ?? undefined),
      ]);
      if (mine !== latest.current) return;
      setListing(next);
      setInvites(open);
      setProblem(null);
    } catch (error) {
      if (mine !== latest.current) return;
      setProblem(error instanceof Error ? error.message : 'Could not load the household.');
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="note py-4.5">Loading…</p>;
  if (problem !== null && listing === null) return <Problem>{problem}</Problem>;
  if (listing === null) return null;

  const isOwner = listing.viewer.role === 'owner';
  const active = listing.members.filter((member) => !member.isArchived);
  const former = listing.members.filter((member) => member.isArchived);
  const marks = memberMarks(listing.members);
  const folded = former.length + invites.length;

  return (
    <section>
      <div className="grouphead">
        <h2>Members</h2>
        {isOwner ? (
          <button
            type="button"
            className="invite-button"
            aria-expanded={inviting}
            onClick={() => {
              setInviting((was) => !was);
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>Invite</span>
          </button>
        ) : (
          <span className="who">Only an owner can invite</span>
        )}
      </div>

      {isOwner && inviting && (
        <div className="mb-3">
          <IssueInvite
            householdId={listing.household.id}
            issued={issued}
            onIssued={(next) => {
              setIssued(next);
              void load();
            }}
            onDismiss={() => {
              setIssued(null);
              setInviting(false);
            }}
          />
        </div>
      )}

      <div className="setgrp">
        <ul>
          {active.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              mark={marks.get(member.id) ?? { text: '?', showName: false }}
              isYou={member.id === listing.viewer.memberId}
              canChangeRoles={isOwner}
              onChanged={load}
            />
          ))}
        </ul>

        {folded > 0 && (
          <button
            type="button"
            className="setfold"
            aria-expanded={rest}
            onClick={() => {
              setRest((was) => !was);
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ transform: rest ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            <span className="tabular-nums">
              {[
                former.length > 0 ? `${String(former.length)} former ${former.length === 1 ? 'member' : 'members'}` : null,
                invites.length > 0 ? `${String(invites.length)} ${invites.length === 1 ? 'invite' : 'invites'}` : null,
              ]
                .filter((part): part is string => part !== null)
                .join(' · ')}
            </span>
          </button>
        )}

        {rest && (
          <>
            {former.length > 0 && (
              <ul>
                {former.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    mark={marks.get(member.id) ?? { text: '?', showName: false }}
                    isYou={false}
                    canChangeRoles={false}
                    onChanged={load}
                  />
                ))}
              </ul>
            )}
            {invites.length > 0 && (
              <ul>
                {invites.map((invite) => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    canRevoke={isOwner}
                    onChanged={async () => {
                      // Whichever invite was revoked, no code on screen is worth
                      // keeping: it is either the one just killed, or one the owner
                      // has had ample time to send.
                      setIssued(null);
                      await load();
                    }}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * One member, with what they may do and — for an owner — a way to change it.
 *
 * The role was previously shown only for the person looking, which told you
 * nothing about anybody else. Who can do what in a shared household is exactly
 * the thing the screen exists to answer.
 */
function MemberRow({
  member,
  mark,
  isYou,
  canChangeRoles,
  onChanged,
}: {
  member: Member;
  mark: MemberMark;
  isYou: boolean;
  canChangeRoles: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const change = useCallback(
    (next: HouseholdRole) => {
      void (async () => {
        setBusy(true);
        setProblem(null);
        try {
          await setMemberRole(member.id, next);
          await onChanged();
        } catch (error) {
          setProblem(error instanceof Error ? error.message : 'Could not change that role.');
        } finally {
          setBusy(false);
        }
      })();
    },
    [member.id, onChanged],
  );

  const editable = canChangeRoles && member.role != null;
  const roleWord = member.role == null ? 'no sign-in' : member.role.charAt(0).toUpperCase() + member.role.slice(1);

  return (
    <li className="member-row">
      <span
        className="member-ring"
        aria-hidden="true"
        style={{ borderColor: `var(--${member.colour})`, color: `var(--${member.colour})` }}
      >
        {mark.text}
      </span>
      <span className="member-name">
        {member.displayName}
        {isYou && <span className="member-you"> · you</span>}
        {member.isArchived && <span className="member-you"> · former</span>}
      </span>
      {editable && member.role != null ? (
        <label className="member-role member-role-edit">
          <span>{roleWord}</span>
          <select
            aria-label={`Role of ${member.displayName}`}
            value={member.role}
            disabled={busy}
            onChange={(event) => {
              change(event.target.value as HouseholdRole);
            }}
          >
            {HOUSEHOLD_ROLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="member-role">{roleWord}</span>
      )}
      {problem !== null && (
        <span className="member-problem">
          <Problem>{problem}</Problem>
        </span>
      )}
    </li>
  );
}

const STATE_TONE: Record<InviteState, 'ok' | 'due' | 'neutral' | 'own'> = {
  open: 'ok',
  accepted: 'own',
  revoked: 'neutral',
  expired: 'due',
};

function InviteRow({
  invite,
  canRevoke,
  onChanged,
}: {
  invite: Invite;
  canRevoke: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const state = inviteState(invite, new Date());

  return (
    <li className="invite-row">
      <span className="flex flex-wrap items-center gap-2">
        <span style={{ color: 'var(--ink)' }}>{invite.displayName}</span>
        <Pill tone="neutral">{invite.role}</Pill>
        <Pill tone={STATE_TONE[state]}>{state}</Pill>
        {state === 'open' && (
          <span className="note">expires {formatIsoDate(invite.expiresAt.slice(0, 10))}</span>
        )}
      </span>

      {canRevoke && state === 'open' && (
        <button
          type="button"
          className="note underline"
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                await revokeInvite(invite.id);
                await onChanged();
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Revoke
        </button>
      )}
    </li>
  );
}

function IssueInvite({
  householdId,
  issued,
  onIssued,
  onDismiss,
}: {
  householdId: string;
  issued: { code: string; validForDays: number } | null;
  onIssued: (issued: { code: string; validForDays: number }) => void;
  /** Done with the form: either the code has been sent on, or nobody is being invited after all. */
  onDismiss: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<HouseholdRole>('partner');
  const [colour, setColour] = useState<MemberColour>('c2');
  const [days, setDays] = useState('7');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setProblem(null);
      setBusy(true);
      try {
        const code = await createInvite({
          householdId,
          displayName,
          role,
          colour,
          validForDays: Number(days),
        });
        setDisplayName('');
        onIssued({ code, validForDays: Number(days) });
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not create the invite.');
      } finally {
        setBusy(false);
      }
    },
    [colour, days, displayName, householdId, onIssued, role],
  );

  return (
    <Card
      title="Invite someone"
      aside={
        issued === null ? (
          <button type="button" className="note underline" onClick={onDismiss}>
            Cancel
          </button>
        ) : undefined
      }
    >
      {issued !== null ? (
        <IssuedCode code={issued.code} validForDays={issued.validForDays} onDone={onDismiss} />
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <div className="w-full sm:w-auto sm:min-w-[170px] sm:flex-1">
            <Field
              label="Their name"
              placeholder="Meera"
              required
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
            />
          </div>

          <label className="flex w-full flex-col gap-1.5 sm:w-[140px] sm:shrink-0">
            <span className="label">Role</span>
            <select
              className="field"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as HouseholdRole);
              }}
            >
              {HOUSEHOLD_ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="flex w-full flex-col gap-1.5 sm:w-[110px] sm:shrink-0">
            <span className="label">Colour</span>
            <select
              className="field"
              value={colour}
              onChange={(event) => {
                setColour(event.target.value as MemberColour);
              }}
            >
              {MEMBER_COLOURS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div className="w-full sm:w-[110px] sm:shrink-0">
            <Field
              label="Valid days"
              numeric
              inputMode="numeric"
              value={days}
              onChange={(event) => {
                setDays(event.target.value.replace(/\D/g, ''));
              }}
            />
          </div>

          <Button type="submit" disabled={busy || displayName.trim() === '' || days === ''}>
            {busy ? 'Creating…' : 'Create invite'}
          </Button>

          {problem !== null && (
            <div className="w-full">
              <Problem>{problem}</Problem>
            </div>
          )}
        </form>
      )}

      {issued === null && (
        <p className="note mt-3">
          An owner can grant any role, including owner. A second owner is worth having: it is what
          stops a lost authenticator locking the household out of its own records.
        </p>
      )}
    </Card>
  );
}

/**
 * Where this app lives, as the invitee will need to open it.
 *
 * Derived rather than written down, so it stays right on localhost, on Pages,
 * and on a custom domain later without anyone remembering to change it.
 */
function appUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/**
 * What to send someone.
 *
 * Both routes are described because the owner does not always know which the
 * recipient needs, and picking the wrong one gives a confusing refusal rather
 * than a helpful one.
 */
function invitationText(code: string, validForDays: number): string {
  const expires = new Date(Date.now() + validForDays * 86_400_000);
  return [
    'You have been invited to our Family Finance Buddy household.',
    '',
    `Open: ${appUrl()}`,
    `Code: ${code}`,
    '',
    'If you do not have an account yet, tap "I have an invite code and no account yet" on the sign-in screen.',
    'If you already have one, sign in and enter the code when asked.',
    '',
    `The code works once and expires on ${expires.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
  ].join('\n');
}

/**
 * The code, shown once, with a way to send it.
 *
 * Only its hash was stored, so this is genuinely the only moment it exists —
 * and a code that has to be read off one screen and typed into another is a
 * code that gets mistyped. Sharing it is part of issuing it, not an extra.
 */
function IssuedCode({
  code,
  validForDays,
  onDone,
}: {
  code: string;
  validForDays: number;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const message = invitationText(code, validForDays);

  // navigator.share is the right thing on a phone — one tap to WhatsApp, mail,
  // Signal, whatever they use — and absent on most desktop browsers, where the
  // explicit links below do the job instead.
  const canShare = typeof navigator.share === 'function';

  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-caption" style={{ color: 'var(--ink)' }}>
        <strong>Shown once.</strong> Only its fingerprint is stored, so it cannot be looked up
        again. If it is lost, revoke the invite and issue another.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <code
          className="num rounded px-3.5 py-2.5"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--line-strong)',
            color: 'var(--ink)',
            fontSize: '1.1875rem',
            letterSpacing: '0.16em',
          }}
        >
          {code}
        </code>

        <Button
          variant="quiet"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(
              () => {
                setCopied(true);
              },
              () => {
                // Clipboard access can be refused; the code is on screen anyway.
                setCopied(false);
              },
            );
          }}
        >
          {copied ? 'Copied' : 'Copy code'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {canShare && (
          <Button
            type="button"
            onClick={() => {
              void navigator
                .share({ title: 'Family Finance Buddy invitation', text: message })
                .catch(() => {
                  // Dismissing the share sheet rejects. Nothing to report.
                });
            }}
          >
            Share…
          </Button>
        )}

        <a
          className="btn btn-quiet"
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          WhatsApp
        </a>

        {/*
          Gmail directly, rather than a mailto: link.
          
          mailto: hands off to whatever the operating system has registered,
          and a webmail account is usually not registered at all — so a Gmail
          user gets an app picker listing every mail client they do not use.
          This opens a compose window with the message already in it.
        */}
        <a
          className="btn btn-quiet"
          href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('Family Finance Buddy invitation')}&body=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Gmail
        </a>

        {/*
          And the general answer, for anything not listed: the whole message,
          ready to paste wherever they actually write to people.
        */}
        <Button
          variant="quiet"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(message).then(
              () => {
                setCopiedMessage(true);
              },
              () => {
                setCopiedMessage(false);
              },
            );
          }}
        >
          {copiedMessage ? 'Message copied' : 'Copy message'}
        </Button>

        <Button variant="quiet" type="button" onClick={onDone}>
          Done
        </Button>
      </div>

      <p className="note">
        Every route sends the same message: the link, the code, the expiry and what to do with
        them. Send it to one person directly rather than to a group — the code is what lets them
        in, and a group chat keeps it forever.
      </p>
    </div>
  );
}
