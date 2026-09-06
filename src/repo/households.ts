/**
 * Which households you belong to.
 *
 * Until now every read took the oldest membership and hoped there was only one.
 * That was always a stand-in — the blueprint expects an account to belong to
 * more than one, and says so plainly: "a household is a row, a person can
 * belong to several through their membership, and a switcher in the top bar
 * moves between them" (§421). The demo household beside the real one is the
 * intended arrangement, not an edge case.
 */

import { supabase } from './client.ts';
import { toHousehold, toRole } from './mapping.ts';
import { NoHouseholdError, type Household, type HouseholdRole, type Uuid } from './types.ts';

export interface HouseholdMembership {
  readonly household: Household;
  readonly role: HouseholdRole;
  readonly memberId: Uuid;
  readonly accountId: Uuid;
}

/**
 * Every household this account belongs to, oldest membership first.
 *
 * Row-level security decides what comes back; there is no parameter here that
 * could ask for somebody else's. What the caller chooses is which of their own
 * to look at, which is a view, not an access decision.
 */
export async function listHouseholds(): Promise<readonly HouseholdMembership[]> {
  const client = supabase();

  const result = await client
    .from('membership')
    .select('id, role, member_id, user_account_id, household:household_id (*)')
    .is('revoked_at', null)
    .order('created_at', { ascending: true });

  if (result.error !== null) throw new Error(result.error.message);
  if (result.data.length === 0) throw new NoHouseholdError();

  return result.data.map((row) => ({
    household: toHousehold(row.household),
    role: toRole(row.role),
    memberId: String(row.member_id),
    accountId: String(row.user_account_id),
  }));
}
