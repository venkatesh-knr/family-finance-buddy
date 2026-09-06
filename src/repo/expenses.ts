/**
 * The expense repository. Two methods, and a change signal.
 *
 *   listExpenses()  — everything one screen load needs
 *   addExpense()    — one spend, in
 *
 * Both go through here and nowhere else, and nothing a Supabase library defines
 * crosses back out: callers get the domain types from ./types.ts.
 *
 * Note what is absent. There is no householdId parameter on listExpenses,
 * because the caller does not get to choose — row-level security scopes the
 * read to the households the caller actually belongs to. The client asking for
 * "all expenses" and receiving only its own household's is the policy layer
 * doing its job, visible in the shape of the API.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { istCalendarDate } from '../lib/dates.ts';
import { supabase } from './client.ts';
import { toExpense, toHousehold, toMember, toRole } from './mapping.ts';
import {
  NoHouseholdError,
  type Expense,
  type ExpenseListing,
  type Member,
  type NewExpense,
  type Uuid,
} from './types.ts';

/** Roles that may record anything. A viewer may not, and the database agrees. */
const CAN_WRITE: readonly string[] = ['owner', 'partner', 'contributor'];

/**
 * The most recent spends for the household the caller belongs to, newest first,
 * together with the household, the members and who the caller is within it.
 */
export async function listExpenses(options: { limit?: number } = {}): Promise<ExpenseListing> {
  const client = supabase();
  const limit = options.limit ?? 50;

  const { data: user, error: userError } = await client.auth.getUser();
  if (userError !== null) throw asRepositoryError(userError);
  if (user.user === null) throw new Error('Not signed in.');

  // Membership resolves identity to a household. RLS restricts this to the
  // caller's own rows, so no filter by user id is needed or trusted here.
  //
  // Ordered, not merely limited. An account is expected to belong to more than
  // one household — the demo one alongside the real one is the intended setup,
  // and it is what proves the policies hold with two in a single database. Left
  // unordered, this would pick whichever row Postgres happened to return and
  // could show a different household between two loads.
  //
  // Oldest membership wins, which is stable and predictable. It is a stand-in,
  // not an answer: the real fix is the household switcher (blueprint §783), and
  // when that lands this becomes an explicit choice by the person using it.
  const membershipResult = await client
    .from('membership')
    .select('id, role, member_id, user_account_id, household:household_id (*)')
    .is('revoked_at', null)
    .order('created_at', { ascending: true })
    .limit(1);

  if (membershipResult.error !== null) throw asRepositoryError(membershipResult.error);

  const membership = membershipResult.data[0];
  if (membership === undefined) throw new NoHouseholdError();

  const household = toHousehold(membership.household);
  const role = toRole(membership.role);

  const membersResult = await client
    .from('member')
    .select('id, display_name, colour, status')
    .eq('household_id', household.id)
    .order('display_name', { ascending: true });

  if (membersResult.error !== null) throw asRepositoryError(membersResult.error);

  const members: Member[] = membersResult.data.map(toMember);
  const membersById = new Map(members.map((member) => [member.id, member]));

  const expensesResult = await client
    .from('expense_txn')
    // amount_minor::text — a bigint over 2^53 would otherwise arrive as a
    // lossy double. See the note in holdings.ts.
    .select('id, household_id, member_id, txn_date, amount_minor::text, currency, payee, method, note, voided_at')
    .order('txn_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (expensesResult.error !== null) throw asRepositoryError(expensesResult.error);

  const expenses: Expense[] = expensesResult.data.map((row) => toExpense(row, membersById));

  return {
    household,
    viewer: {
      accountId: String(membership.user_account_id),
      memberId: String(membership.member_id),
      role,
      canRecord: CAN_WRITE.includes(role),
      canFileForOthers: role === 'owner' || role === 'partner',
    },
    members,
    expenses,
  };
}

/**
 * File one spend.
 *
 * `created_by` is deliberately not sent: the column defaults to the caller's
 * own account and the insert policy checks it, so attribution is settled by the
 * database rather than asserted by the client.
 */
export async function addExpense(expense: NewExpense): Promise<Expense> {
  const client = supabase();

  if (expense.amount.minor <= 0n) {
    throw new Error('An expense is a positive amount.');
  }

  const result = await client
    .from('expense_txn')
    .insert({
      household_id: expense.householdId,
      member_id: expense.memberId,
      txn_date: expense.date,
      // The bigint becomes a decimal string, never a float, on the way out.
      amount_minor: expense.amount.minor.toString(),
      currency: expense.amount.currency,
      payee: expense.payee ?? null,
      method: expense.method ?? null,
      note: expense.note ?? null,
    })
    .select('id, household_id, member_id, txn_date, amount_minor::text, currency, payee, method, note, voided_at')
    .single();

  if (result.error !== null) throw asRepositoryError(result.error);

  const membersResult = await client
    .from('member')
    .select('id, display_name, colour, status')
    .eq('household_id', expense.householdId);

  if (membersResult.error !== null) throw asRepositoryError(membersResult.error);

  const membersById = new Map(membersResult.data.map((row) => {
    const member = toMember(row);
    return [member.id, member] as const;
  }));

  return toExpense(result.data, membersById);
}

/**
 * Live updates.
 *
 * The callback carries no data — only the news that something changed, at which
 * point the caller re-reads through `listExpenses`. That is on purpose: it
 * keeps those two methods the only path any expense data travels, so a payload
 * shape from the change stream can never become a second, untested mapping.
 *
 * The stream honours the same policies as any query, so a subscriber is only
 * ever told about rows they could already have read.
 */
export type LiveStatus = 'connecting' | 'live' | 'failed';

export function subscribeToExpenses(
  householdId: Uuid,
  onChange: () => void,
  onStatus: (status: LiveStatus, detail: string | null) => void = () => {},
): () => void {
  const client = supabase();

  onStatus('connecting', null);

  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  const join = (): RealtimeChannel =>
    client
      .channel(`expense_txn:${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'expense_txn',
          filter: `household_id=eq.${householdId}`,
        },
        () => {
          if (import.meta.env.DEV) {
            // console.info, not console.debug: Chrome files debug under
            // Verbose, which its default log level hides — a diagnostic
            // nobody can see is not a diagnostic.
            console.info('[realtime] change received on expense_txn');
          }
          onChange();
        },
      )
      // The status callback is not optional in practice. Without it a channel
      // that never joins — the table missing from the publication, a policy
      // refusing the subscriber, a stale token — looks exactly like a channel
      // that joined and has nothing to report, and the screen quietly stops
      // being live with no way to tell.
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          onStatus('live', null);
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          onStatus('failed', error?.message ?? status);
        }
      });

  // The token must be in Realtime's hands BEFORE the channel joins, not merely
  // on its way there. setAuth is asynchronous and subscribe is not, so a
  // channel started straight from an effect can join carrying the publishable
  // key rather than the session — which joins perfectly well and then delivers
  // nothing, because Realtime checks the row policies per change and every one
  // of them fails.
  void (async () => {
    const { data } = await client.auth.getSession();
    if (cancelled) return;

    if (data.session !== null) {
      await client.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
    }

    channel = join();
  })();

  return () => {
    cancelled = true;
    if (channel !== null) void client.removeChannel(channel);
  };
}

/** Today, in Kolkata, as the quick-add form's default. */
export function todayInIst(): string {
  return istCalendarDate(new Date());
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

/**
 * Provider errors stop here too. A component should never have to know what a
 * PostgREST error code looks like.
 */
function asRepositoryError(error: ProviderError): Error {
  // 42501 is a policy refusal: the row exists or the write was attempted, and
  // the database said no. Worth naming plainly rather than leaking a code.
  if (error.code === '42501') {
    return new Error('You do not have permission to do that in this household.');
  }
  if (error.code === 'PGRST116') {
    return new Error('That record is not available to you.');
  }
  return new Error(error.message);
}
