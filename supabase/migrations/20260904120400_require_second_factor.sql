-- Family Finance Buddy — a second factor, enforced by the database.
--
-- "MFA is mandatory on every account, whatever the role — no account on the
-- system is ever protected by a password alone" (docs/blueprint.md §15, layer
-- 04). Enforced only in the UI, that sentence is decoration: the publishable
-- key is in the bundle by design, so anyone holding a password could skip the
-- app and query the API directly at assurance level aal1.
--
-- These are RESTRICTIVE policies, which AND with the permissive ones rather
-- than adding an alternative way in. Nothing written in the policies migration
-- is modified or dropped; this file only narrows. If you would rather enforce
-- the second factor in the app alone, drop this migration and nothing else
-- changes.
--
-- user_account is deliberately left out: the account must be able to read its
-- own row while enrolling, which by definition happens before aal2 exists.

create or replace function app.has_second_factor()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
$fn$;

comment on function app.has_second_factor() is
  'True when the caller presented an authenticator code in this session, not merely a password.';

revoke all on function app.has_second_factor() from public;
grant execute on function app.has_second_factor() to authenticated;

create policy require_second_factor
  on public.household
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.member
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.membership
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.expense_txn
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

comment on policy require_second_factor on public.expense_txn is
  'A password alone reads nothing. Restrictive, so it narrows every other policy rather than widening any.';
