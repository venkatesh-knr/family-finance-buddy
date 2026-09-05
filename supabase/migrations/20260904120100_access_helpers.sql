-- Family Finance Buddy — the access helpers every policy resolves through.
--
-- Four questions, asked over and over by the policies:
--   which households am I in, am I in this one, what is my role here, and
--   which member am I here.
--
-- They are security definer for one reason only: a policy on membership that
-- reads membership would recurse. Definer breaks that cycle. Each one is
-- pinned to an empty search_path with every object fully qualified, and each
-- answers strictly about the *calling* user — none of them takes a user id, so
-- none of them can be pointed at somebody else.
--
-- These are access helpers, not business rules. No calculation, no tax rule
-- and no money ever appears in this file.

-- ---------------------------------------------------------- who am I

create or replace function app.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select ua.id
  from public.user_account ua
  where ua.auth_user_id = (select auth.uid())
$fn$;

comment on function app.current_account_id() is
  'The user_account id of the caller, or null when unauthenticated.';

-- ---------------------------------------------------- which households

create or replace function app.household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.household_id
  from public.membership m
  join public.user_account ua on ua.id = m.user_account_id
  where ua.auth_user_id = (select auth.uid())
    and m.revoked_at is null
$fn$;

comment on function app.household_ids() is
  'Every household the caller holds a live membership in. Returns no rows when unauthenticated.';

-- --------------------------------------------------------- what role

create or replace function app.household_role(target_household_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.role
  from public.membership m
  join public.user_account ua on ua.id = m.user_account_id
  where ua.auth_user_id = (select auth.uid())
    and m.household_id = target_household_id
    and m.revoked_at is null
$fn$;

comment on function app.household_role(uuid) is
  'The caller role in one household: owner, partner, contributor, viewer — or null if not a member.';

-- ------------------------------------------------------- which member

create or replace function app.current_member_id(target_household_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.member_id
  from public.membership m
  join public.user_account ua on ua.id = m.user_account_id
  where ua.auth_user_id = (select auth.uid())
    and m.household_id = target_household_id
    and m.revoked_at is null
$fn$;

comment on function app.current_member_id(uuid) is
  'The member row the caller is, inside one household. Null if not a member of it.';

-- ------------------------------------------------------------- privileges

revoke all on function app.current_account_id()      from public;
revoke all on function app.household_ids()           from public;
revoke all on function app.household_role(uuid)      from public;
revoke all on function app.current_member_id(uuid)   from public;

grant usage on schema app to authenticated;

grant execute on function app.current_account_id()    to authenticated;
grant execute on function app.household_ids()         to authenticated;
grant execute on function app.household_role(uuid)    to authenticated;
grant execute on function app.current_member_id(uuid) to authenticated;
