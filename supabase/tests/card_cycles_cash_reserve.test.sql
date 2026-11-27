-- Family Finance Buddy — the cash reserve reads a statement-date card's latest due (docs/design/card-cycles.md section 2.3; CY-I9).
--
-- Not run locally: Docker is blocked on the maintainer's machine, so CI's policy suite is the first run. It needs no migration: household_cash_reserve already takes each account's latest balance
-- on or before the day, which for a card on its statement date is the due on the statement dated in the month, the close's own closing figure.
--
-- CY-I9 — for the section 9 card (due ₹20,200 on 17 September, ₹28,640 on 17 October), the reserve as at 31 October takes 2864000 for the card, as at 16 October it takes 2020000, and as at 30
--         November, with no statement yet, it still takes 2864000. A statement's due beats a typed one dated the same day.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(4);

-- ============================================================== the fixture: one household, its owner, one card on its statement date

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'cb000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'db000000-0000-4000-8000-0000000000a1' where auth_user_id = 'cb000000-0000-4000-8000-0000000000a1';

insert into public.household (id, name, kind) values
  ('eb000000-0000-4000-8000-0000000000f1', 'Household R', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('fb000000-0000-4000-8000-0000000000a1', 'eb000000-0000-4000-8000-0000000000f1', 'Owner', 'c1');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('db000000-0000-4000-8000-0000000000a1', 'eb000000-0000-4000-8000-0000000000f1', 'fb000000-0000-4000-8000-0000000000a1', 'owner');

insert into public.account (id, household_id, member_id, name, type, currency, visibility, created_by, cycle_ends) values
  ('ab000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-0000000000f1', 'fb000000-0000-4000-8000-0000000000a1', 'Regalia', 'card', 'INR', 'household', 'db000000-0000-4000-8000-0000000000a1', 'statement');

insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency, source, created_by) values
  ('eb000000-0000-4000-8000-0000000000f1', 'ab000000-0000-4000-8000-000000000001', '2026-09-17', 2020000, 'INR', 'statement', 'db000000-0000-4000-8000-0000000000a1'),
  ('eb000000-0000-4000-8000-0000000000f1', 'ab000000-0000-4000-8000-000000000001', '2026-10-17', 2864000, 'INR', 'statement', 'db000000-0000-4000-8000-0000000000a1');

-- The owner, with a second factor, as the function requires.
set local role authenticated;
set local request.jwt.claim.sub to 'cb000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"cb000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select results_eq(
  $q$ select reserve_minor, accounts_counted from public.household_cash_reserve('eb000000-0000-4000-8000-0000000000f1', '2026-10-31') $q$,
  $q$ values (-2864000::bigint, 1) $q$,
  'CY-I9 — the reserve as at 31 October takes the card''s due of 17 October, the close''s closing figure for the card'
);

select results_eq(
  $q$ select reserve_minor, accounts_counted from public.household_cash_reserve('eb000000-0000-4000-8000-0000000000f1', '2026-10-16') $q$,
  $q$ values (-2020000::bigint, 1) $q$,
  'CY-I9 — and as at the day before that statement it takes the one before'
);

select results_eq(
  $q$ select reserve_minor from public.household_cash_reserve('eb000000-0000-4000-8000-0000000000f1', '2026-11-30') $q$,
  $q$ values (-2864000::bigint) $q$,
  'CY-I9 — with no statement yet for November, the latest due stands'
);

reset role;
insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency, source, created_by) values
  ('eb000000-0000-4000-8000-0000000000f1', 'ab000000-0000-4000-8000-000000000001', '2026-10-17', 9999999, 'INR', 'typed', 'db000000-0000-4000-8000-0000000000a1');
set local role authenticated;

select results_eq(
  $q$ select reserve_minor from public.household_cash_reserve('eb000000-0000-4000-8000-0000000000f1', '2026-10-31') $q$,
  $q$ values (-2864000::bigint) $q$,
  'CY-I9 — a typed due dated the same day as the statement''s does not replace it'
);

select * from finish();

rollback;
