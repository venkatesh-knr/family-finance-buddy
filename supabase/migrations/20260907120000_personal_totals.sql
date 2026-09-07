-- Family Finance Buddy — household totals that include what you cannot see.
--
-- "Household totals must include private amounts or the numbers disagree
-- between members, which is worse than the problem being solved. A
-- security-definer function is the standard way: it reads what the caller
-- cannot and returns only the sum." (§20)
--
-- The shape below is narrower than that sentence allows, on purpose.
--
-- The client can already see two of the three parts: every household-visible
-- row, and its own personal rows. Those it sums itself, in the pure functions
-- under src/domain, where the invariant says calculation belongs. What it
-- cannot see is other members' personal spending — so that, and only that, is
-- what these functions return. Moving the whole total into SQL would have
-- taken arithmetic out of the tested pure layer to solve a problem that only
-- covers a fraction of it.
--
-- The blunting matters as much as the sum. "If a total is visible and only one
-- entry is private, the private amount can be recovered by subtraction. So
-- private amounts roll into a single Personal line per member rather than into
-- fine-grained category totals." These functions therefore return one row per
-- member and never a category — asking for a breakdown is asking for the
-- subtraction back, and there is no argument to pass that would give it.

/**
 * Other members' personal spending in a period, one line each.
 *
 * Excludes the caller's own, which they can already read as rows and would
 * otherwise count twice.
 *
 * Definer, and it must be: the point is to read past the policy. Everything it
 * does with that power is bounded by what it returns — a member, a sum and a
 * currency. There is no date, no payee, no category and no row.
 */
create or replace function public.personal_expense_totals(
  target_household_id uuid,
  from_date date,
  to_date date
)
returns table (member_id uuid, total_minor bigint, currency text)
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_member uuid;
begin
  -- Membership is checked here rather than trusted, because a definer function
  -- has already stepped outside the policies that would have checked it.
  if app.household_role(target_household_id) is null then
    raise exception 'Not a member of that household.' using errcode = '42501';
  end if;

  v_member := app.current_member_id(target_household_id);

  return query
    select e.member_id, sum(e.amount_minor)::bigint, e.currency
      from public.expense_txn e
     where e.household_id = target_household_id
       and e.visibility = 'personal'
       and e.member_id is distinct from v_member
       and e.voided_at is null
       and e.txn_date between from_date and to_date
     group by e.member_id, e.currency;
end;
$fn$;

comment on function public.personal_expense_totals(uuid, date, date) is
  'One sum per member, never a category — a per-category breakdown would let the amount be recovered by subtraction.';

revoke all on function public.personal_expense_totals(uuid, date, date) from public;
grant execute on function public.personal_expense_totals(uuid, date, date) to authenticated;

/**
 * How many of the caller's own entries are personal.
 *
 * "A member should see '4 of your entries are private' on their own screen. A
 * privacy control nobody can observe working is indistinguishable from one
 * that does nothing." (§20)
 *
 * About the caller and nobody else, so it needs no definer rights at all — the
 * ordinary policy already returns these rows. It exists as a function so the
 * count is one call rather than a page of rows fetched to be counted.
 */
create or replace function public.my_private_entry_count(target_household_id uuid)
returns table (entity text, entry_count bigint)
language sql
stable
set search_path = ''
as $fn$
  select 'expense_txn', count(*)
    from public.expense_txn
   where household_id = target_household_id
     and visibility = 'personal'
     and member_id = app.current_member_id(target_household_id)
  union all
  select 'holding', count(*)
    from public.holding
   where household_id = target_household_id
     and visibility = 'personal'
     and member_id = app.current_member_id(target_household_id)
$fn$;

revoke all on function public.my_private_entry_count(uuid) from public;
grant execute on function public.my_private_entry_count(uuid) to authenticated;
