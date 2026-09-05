-- Family Finance Buddy — row-level security policies.
--
-- Every policy in this file resolves through membership, is scoped to the role
-- `authenticated`, and decides one thing only: may this user see or touch this
-- row. There is no calculation, no tax rule and no money here — a policy that
-- knew about arithmetic could never move to a server later.
--
-- What is deliberately absent is as load-bearing as what is present:
--   * no policy grants `anon` anything, so a signed-out visitor sees nothing;
--   * no permissive catch-all exists on any table;
--   * no delete policy exists anywhere, on any table — deletes are soft;
--   * household, member and membership have no write policy at all yet, so
--     clients cannot create or alter them. Household bootstrap and invite
--     acceptance are their own slice, and until then a household is created by
--     the seed or by an administrator with a privileged connection.
--
-- Policies read `(select app.household_ids())` rather than calling the helper
-- per row: Postgres evaluates the subquery once per statement instead of once
-- per candidate row.

-- ---------------------------------------------------------------- household

create policy household_select_own_membership
  on public.household
  for select
  to authenticated
  using (id in (select app.household_ids()));

comment on policy household_select_own_membership on public.household is
  'You see a household only by holding a live membership in it. Never aggregated across households.';

-- ------------------------------------------------------------------- member

create policy member_select_same_household
  on public.member
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

comment on policy member_select_same_household on public.member is
  'Members are visible to their own household, archived ones included — their names render on historical rows.';

-- ------------------------------------------------------------- user_account

create policy user_account_select_self
  on public.user_account
  for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

create policy user_account_update_self
  on public.user_account
  for update
  to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

comment on policy user_account_select_self on public.user_account is
  'An identity is private to itself. Household-mates are seen through member, which carries no login or email.';

-- --------------------------------------------------------------- membership

create policy membership_select_same_household
  on public.membership
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

comment on policy membership_select_same_household on public.membership is
  'Who else is in this household, and in what role. Reads membership through a definer helper, so no recursion.';

-- -------------------------------------------------------------- expense_txn

create policy expense_txn_select_same_household
  on public.expense_txn
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

comment on policy expense_txn_select_same_household on public.expense_txn is
  'Household-wide read for every role in this slice. Narrowing contributor and viewer reads is a later slice.';

create policy expense_txn_insert_own_household
  on public.expense_txn
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and created_by = (select app.current_account_id())
  );

comment on policy expense_txn_insert_own_household on public.expense_txn is
  'A viewer writes nothing. A contributor writes only under their own name. Attribution cannot be forged.';

create policy expense_txn_update_own_household
  on public.expense_txn
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  );

comment on policy expense_txn_update_own_household on public.expense_txn is
  'Editing and voiding. The with-check repeats the using clause so a row cannot be moved out of reach.';
