/**
 * The household: who is in it, and who has been invited.
 *
 * The screen exists mostly for one job — issuing an invite — and it is arranged
 * around the awkward fact at the heart of that job: the code is shown once and
 * then cannot be recovered. So it is displayed large, copyable, and with the
 * consequence stated rather than implied.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import {
  createInvite,
  inviteState,
  listInvites,
  revokeInvite,
  type Invite,
  type InviteState,
} from '../../repo/invites.ts';
import { listExpenses } from '../../repo/expenses.ts';
import {
  HOUSEHOLD_ROLES,
  MEMBER_COLOURS,
  type ExpenseListing,
  type HouseholdRole,
  type MemberColour,
} from '../../repo/types.ts';
import { Button, Card, Field, Pill, Problem } from '../../ui/primitives.tsx';

export function HouseholdScreen() {
  const [listing, setListing] = useState<ExpenseListing | null>(null);
  const [invites, setInvites] = useState<readonly Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, open] = await Promise.all([listExpenses({ limit: 1 }), listInvites()]);
      setListing(next);
      setInvites(open);
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not load the household.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="note py-4.5">Loading…</p>;
  if (problem !== null && listing === null) return <Problem>{problem}</Problem>;
  if (listing === null) return null;

  const isOwner = listing.viewer.role === 'owner';

  return (
    <div className="flex flex-col gap-4.5">
      {isOwner ? (
        <IssueInvite householdId={listing.household.id} onIssued={load} />
      ) : (
        <Card title="Invite someone">
          <p className="note">
            Your role is <strong>{listing.viewer.role}</strong>. Only an owner can invite someone
            to a household — and the database enforces that, not this screen.
          </p>
        </Card>
      )}

      <Card title="Members" aside={<span className="note">{listing.household.name}</span>}>
        <ul className="row-separated">
          {listing.members.map((member) => (
            <li key={member.id} className="flex items-center gap-2.5 py-2.5">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-pill"
                style={{ background: `var(--${member.colour})` }}
              />
              <span style={{ color: 'var(--ink)' }}>{member.displayName}</span>
              {member.id === listing.viewer.memberId && (
                <Pill tone="own">you · {listing.viewer.role}</Pill>
              )}
              {member.isArchived && <Pill tone="neutral">Archived</Pill>}
            </li>
          ))}
        </ul>
      </Card>

      {invites.length > 0 && (
        <Card title="Invites">
          <ul className="row-separated">
            {invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} canRevoke={isOwner} onChanged={load} />
            ))}
          </ul>
        </Card>
      )}

      <p className="note">
        An invited person needs an account before they can accept. Until the app can create one
        itself, add them from the Supabase dashboard first — Authentication → Users → Create new
        user — then give them the code.
      </p>
    </div>
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
    <li className="flex flex-wrap items-center justify-between gap-2.5 py-2.5">
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
  onIssued,
}: {
  householdId: string;
  onIssued: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<HouseholdRole>('partner');
  const [colour, setColour] = useState<MemberColour>('c2');
  const [days, setDays] = useState('7');
  const [code, setCode] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setProblem(null);
      setBusy(true);
      try {
        const issued = await createInvite({
          householdId,
          displayName,
          role,
          colour,
          validForDays: Number(days),
        });
        setCode(issued);
        setDisplayName('');
        await onIssued();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not create the invite.');
      } finally {
        setBusy(false);
      }
    },
    [colour, days, displayName, householdId, onIssued, role],
  );

  return (
    <Card title="Invite someone">
      {code !== null ? (
        <IssuedCode
          code={code}
          validForDays={Number(days)}
          onDone={() => {
            setCode(null);
          }}
        />
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
            <span className="micro-label">Role</span>
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
            <span className="micro-label">Colour</span>
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

      {code === null && (
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
    'You have been invited to our Finance Buddy household.',
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
            fontSize: '19px',
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
                .share({ title: 'Finance Buddy invitation', text: message })
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

        <a
          className="btn btn-quiet"
          href={`mailto:?subject=${encodeURIComponent('Finance Buddy invitation')}&body=${encodeURIComponent(message)}`}
        >
          Email
        </a>

        <Button variant="quiet" type="button" onClick={onDone}>
          Done
        </Button>
      </div>

      <p className="note">
        The message includes the link and the instructions, so there is nothing to type out. Send
        it to one person directly rather than to a group — the code is what lets them in, and a
        group chat keeps it forever.
      </p>
    </div>
  );
}
