-- Family Finance Buddy — you cannot edit your way into somebody's private row.
--
-- The select policy on expense_txn hides a personal entry from everyone but
-- the member it belongs to. The update policy did not: it let an owner or a
-- partner write to any row in the household, whatever its visibility.
--
-- Those are separate policies and Postgres treats them separately, so the gap
-- was not theoretical. An owner could set visibility = 'household' on a row
-- they were never allowed to read, and then read it — a two-step version of
-- exactly what section 20 forbids, and one that leaves the select policy
-- looking correct while it is walked around.
--
-- Hence both halves here:
--
--   using       what you may write to  — your own row, or a shared one
--   with check  what it may become     — you may only make YOUR OWN private
--
-- The with-check matters on its own. Without it an owner could mark another
-- member's shared entry private, which hides it from the owner and leaves the
-- member with an entry they never chose to conceal. Privacy is a decision
-- about your own record; it is not something that can be done to you.

drop policy if exists expense_txn_update_own_household on public.expense_txn;

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
    -- The same test the select policy applies. A row you cannot read is a row
    -- you cannot edit, and that has to be said here as well: an update policy
    -- does not inherit it.
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  );

comment on policy expense_txn_update_own_household on public.expense_txn is
  'Editing and voiding. A personal row is editable only by the member it belongs to, and only they can make one personal — otherwise an owner could unhide a private entry, or hide a member''s entry from them.';

-- The same reasoning, and the same omission, on holdings.
drop policy if exists holding_update_own_household on public.holding;

create policy holding_update_own_household
  on public.holding
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  );

comment on policy holding_update_own_household on public.holding is
  'A personal holding is editable only by the member it belongs to, and only they can make one personal.';
