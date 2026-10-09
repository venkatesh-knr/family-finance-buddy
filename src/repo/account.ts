/**
 * Which account is signed in.
 *
 * Every screen starts by finding the caller's membership of a household, and that
 * lookup used to trust the comment "RLS restricts this to the caller's own rows, so
 * no filter by user id is needed". It does not. `membership_select_same_household`
 * returns every live membership in every household the caller belongs to, on
 * purpose ("who else is in this household, and in what role"), and the same code
 * relies on that when it builds the role of each member. So the first row of an
 * unfiltered query is the oldest membership in the household, which is usually the
 * owner's, whoever is looking.
 *
 * For an owner that is invisible. For anybody else it is wrong in exactly the places
 * that matter: the role that decides which screens are offered, the member id
 * records are filed under, and whether Quick add is shown at all. The database still
 * refused what it should, so nothing was exposed, but the screens were describing
 * somebody else. A household switcher listing one household once per person in it
 * is how it showed.
 *
 * So the lookup is filtered to the caller's own account, found from `user_account`,
 * whose own policy returns the caller's row and nobody else's.
 */

import { supabase } from './client.ts';

/** The one account id in what `user_account` returned, or a refusal. */
export function accountIdFrom(rows: readonly unknown[] | null): string {
  const only = rows?.length === 1 ? rows[0] : undefined;
  const id = typeof only === 'object' && only !== null ? (only as Record<string, unknown>)['id'] : undefined;
  if (typeof id !== 'string' || id === '') {
    throw new Error('Could not tell which account you are signed in as. Sign in again.');
  }
  return id;
}

export async function currentAccountId(): Promise<string> {
  const { data, error } = await supabase().from('user_account').select('id');
  if (error !== null) throw new Error(error.message);
  return accountIdFrom(data);
}
