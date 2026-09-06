/**
 * Invites, behind the same boundary as everything else.
 *
 * These are the first repository methods that call database functions rather
 * than tables, because the writes they need are ones no client is allowed to
 * make directly. The seam is unchanged: the caller passes domain values and
 * gets domain values back, and nothing about PostgREST leaks out.
 */

import { supabase } from './client.ts';
import { MalformedRowError, optionalString, requireOneOf, requireRecord, requireString } from '../lib/guards.ts';
import { HOUSEHOLD_ROLES, MEMBER_COLOURS, type HouseholdRole, type MemberColour, type Uuid } from './types.ts';

export interface Invite {
  readonly id: Uuid;
  readonly displayName: string;
  readonly colour: MemberColour;
  readonly role: HouseholdRole;
  readonly email: string | null;
  /** ISO instant. */
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly revokedAt: string | null;
}

export type InviteState = 'open' | 'accepted' | 'revoked' | 'expired';

/**
 * What has become of an invite.
 *
 * Derived rather than stored: an invite does not change when it expires, it
 * simply stops being usable, and a column claiming otherwise would need a job
 * to keep it true. `now` is passed in so this stays pure and testable.
 */
export function inviteState(invite: Invite, now: Date): InviteState {
  if (invite.acceptedAt !== null) return 'accepted';
  if (invite.revokedAt !== null) return 'revoked';
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'open';
}

function toInvite(raw: unknown): Invite {
  const row = requireRecord(raw, 'invite');
  return {
    id: requireString(row['id'], 'invite.id'),
    displayName: requireString(row['display_name'], 'invite.display_name'),
    colour: requireOneOf(row['colour'], MEMBER_COLOURS, 'invite.colour'),
    role: requireOneOf(row['role'], HOUSEHOLD_ROLES, 'invite.role'),
    email: optionalString(row['email'], 'invite.email'),
    expiresAt: requireString(row['expires_at'], 'invite.expires_at'),
    acceptedAt: optionalString(row['accepted_at'], 'invite.accepted_at'),
    revokedAt: optionalString(row['revoked_at'], 'invite.revoked_at'),
  };
}

export async function listInvites(householdId?: Uuid): Promise<readonly Invite[]> {
  const client = supabase();

  // code_hash is deliberately absent: no client holds a grant on that column,
  // and asking for it would fail rather than return null.
  let query = client
    .from('invite')
    .select('id, display_name, colour, role, email, expires_at, accepted_at, revoked_at')
    .order('created_at', { ascending: false });

  // Scoped to the household in view, for the same reason as everything else:
  // belonging to two households must not merge them on screen.
  if (householdId !== undefined) query = query.eq('household_id', householdId);

  const result = await query;

  if (result.error !== null) throw asRepositoryError(result.error);
  return result.data.map(toInvite);
}

export interface NewInvite {
  readonly householdId: Uuid;
  readonly displayName: string;
  readonly role: HouseholdRole;
  readonly colour: MemberColour;
  readonly email?: string | null;
  readonly validForDays: number;
}

/**
 * Issue an invite and return its code.
 *
 * The code exists exactly once, here, in this return value. It is never stored
 * and cannot be read back — so a caller that loses it has to issue another,
 * which is the correct outcome rather than an inconvenience to design around.
 */
export async function createInvite(input: NewInvite): Promise<string> {
  const client = supabase();

  const result = await client.rpc('create_invite', {
    target_household_id: input.householdId,
    member_display_name: input.displayName.trim(),
    member_role: input.role,
    member_colour: input.colour,
    valid_for: `${String(input.validForDays)} days`,
    for_email: input.email ?? null,
  });

  if (result.error !== null) throw asRepositoryError(result.error);
  if (typeof result.data !== 'string' || result.data === '') {
    throw new MalformedRowError('create_invite', 'returned no code');
  }
  return result.data;
}

/** Accept an invite. Returns the household joined. */
export async function acceptInvite(code: string): Promise<Uuid> {
  const client = supabase();

  const result = await client.rpc('accept_invite', { invite_code: code.trim().toUpperCase() });

  if (result.error !== null) throw asRepositoryError(result.error);
  if (typeof result.data !== 'string') {
    throw new MalformedRowError('accept_invite', 'returned no household');
  }
  return result.data;
}

export async function revokeInvite(id: Uuid): Promise<void> {
  const client = supabase();
  const result = await client.rpc('revoke_invite', { target_invite_id: id });
  if (result.error !== null) throw asRepositoryError(result.error);
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

/**
 * The functions raise with an errcode and a message written to be read by a
 * person, so those messages are passed through rather than replaced. 42501 is
 * the exception: it arrives from several places and deserves one wording.
 */
function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error(error.message === '' ? 'You do not have permission to do that.' : error.message);
  }
  return new Error(error.message);
}

/**
 * Create an account from an invite code.
 *
 * The one call in this app that reaches a function rather than the database,
 * because it is the one thing no client may do: create an account. Public
 * sign-up is disabled, and the code is the whole of the justification for the
 * exception — so the endpoint checks it before anything exists, and a bad code
 * leaves nothing behind.
 *
 * No session comes back. The new account signs in normally afterwards, through
 * the same password-then-authenticator path as everyone else: an account
 * created this way is not a way around the second factor.
 */
export async function createAccountFromInvite(input: {
  readonly code: string;
  readonly email: string;
  readonly password: string;
}): Promise<void> {
  const client = supabase();

  const { data, error } = await client.functions.invoke<{ ok?: boolean; error?: string }>(
    'accept-invite',
    {
      body: {
        code: input.code.trim().toUpperCase(),
        email: input.email.trim(),
        password: input.password,
      },
    },
  );

  if (error !== null) {
    // The function replies with its own wording for anything a person can fix.
    // Reading it back beats "Edge Function returned a non-2xx status code".
    const context: unknown = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = (await context.json()) as { error?: unknown };
        if (typeof body.error === 'string' && body.error !== '') {
          throw new Error(body.error);
        }
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== '') throw parseError;
      }
    }
    throw new Error('Could not create the account. Check the code and try again.');
  }

  if (data?.ok !== true) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Could not create the account.');
  }
}

/**
 * Change what somebody may do in this household.
 *
 * Owner only, and the database refuses to remove the last owner — a household
 * without one cannot invite, administer or recover itself, and the way that
 * happens is somebody tidying up their own role without noticing they were the
 * only one.
 */
export async function setMemberRole(memberId: Uuid, role: HouseholdRole): Promise<void> {
  const client = supabase();
  const result = await client.rpc('set_member_role', {
    target_member_id: memberId,
    new_role: role,
  });
  if (result.error !== null) throw asRepositoryError(result.error);
}
