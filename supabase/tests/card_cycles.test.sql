-- Family Finance Buddy — a card's cycle (docs/design/card-cycles.md; CY-I8, CY-I14, CY-I17).
--
-- FOR REVIEW with the migration beside it (20261120120000_card_cycles.sql). Not run locally: Docker is blocked on the maintainer's machine, so CI's policy suite is the first run.
--
-- CY-I8  — only a card can close on its statement date: the database refuses it on a bank account.
-- CY-I14 — a month closed without a card: only an owner or a partner makes it, only for a statement-date card and an ended month, one live row for a card and month, voided and
--          never edited or deleted.
-- CY-I17 — a card's EMI debt: one per card, a credit card, in the card's currency, and never a loan payment typed against it.
-- Also: the EMI figures on a balance default to nothing and cannot be negative; who may set a card's cycle is whoever may change the account; the demo reset clears the new rows.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(41);

-- ============================================================== the fixture
--
--   owner, partner, contributor, viewer   household R (demo)
--   stranger                              owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd7000000-0000-4000-8000-0000000000a1' where auth_user_id = 'c7000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd7000000-0000-4000-8000-0000000000a2' where auth_user_id = 'c7000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd7000000-0000-4000-8000-0000000000a3' where auth_user_id = 'c7000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd7000000-0000-4000-8000-0000000000a4' where auth_user_id = 'c7000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd7000000-0000-4000-8000-0000000000b1' where auth_user_id = 'c7000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e7000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e7000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f7000000-0000-4000-8000-0000000000a1', 'e7000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f7000000-0000-4000-8000-0000000000a2', 'e7000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f7000000-0000-4000-8000-0000000000a3', 'e7000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f7000000-0000-4000-8000-0000000000a4', 'e7000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d7000000-0000-4000-8000-0000000000a1', 'e7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d7000000-0000-4000-8000-0000000000a2', 'e7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d7000000-0000-4000-8000-0000000000a3', 'e7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d7000000-0000-4000-8000-0000000000a4', 'e7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000f2', 'f7000000-0000-4000-8000-0000000000b1', 'owner');

-- R: a savings account, the owner's card, the contributor's card and a card left on the default; S: a card of its own.
insert into public.account (id, household_id, member_id, name, type, currency, visibility, created_by) values
  ('a7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000a1', 'R savings',        'savings', 'INR', 'household', 'd7000000-0000-4000-8000-0000000000a1'),
  ('a7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000a1', 'Owner card',       'card',    'INR', 'household', 'd7000000-0000-4000-8000-0000000000a1'),
  ('a7000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000a3', 'Contributor card', 'card',    'INR', 'household', 'd7000000-0000-4000-8000-0000000000a3'),
  ('a7000000-0000-4000-8000-000000000004', 'e7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000a1', 'Month-end card',   'card',    'INR', 'household', 'd7000000-0000-4000-8000-0000000000a1'),
  ('a7000000-0000-4000-8000-000000000005', 'e7000000-0000-4000-8000-0000000000f2', 'f7000000-0000-4000-8000-0000000000b1', 'S card',           'card',    'INR', 'household', 'd7000000-0000-4000-8000-0000000000b1');

-- Two loans of R: an ordinary one, and (made below) a card's.
insert into public.liability (id, household_id, name, kind, currency) values
  ('b7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'Home loan', 'home_loan', 'INR');

-- ============================================== CY-I8: the setting, as the database owner

select is(
  (select cycle_ends from public.account where id = 'a7000000-0000-4000-8000-000000000004'),
  'month_end',
  'a card closes at month end unless it is said to close on its statement date'
);

select throws_ok(
  $q$ update public.account set cycle_ends = 'statement' where id = 'a7000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'CY-I8 — a bank account cannot close on a statement date'
);

select throws_ok(
  $q$ update public.account set cycle_ends = 'weekly' where id = 'a7000000-0000-4000-8000-000000000002' $q$,
  '23514'::char(5), null::text,
  'CY-I8 — and the setting is one of the two the design names'
);

select lives_ok(
  $q$ update public.account set cycle_ends = 'statement' where id = 'a7000000-0000-4000-8000-000000000002' $q$,
  'CY-I8 — a card can be set to close on its statement date'
);

select lives_ok(
  $q$ update public.account set cycle_ends = 'statement' where id = 'a7000000-0000-4000-8000-000000000003' $q$,
  'and so can the contributor''s card'
);

-- ============================================== the EMI figures of a balance

insert into public.account_balance (id, household_id, account_id, as_at, balance_minor, currency, source, created_by) values
  ('c7100000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000002',
   '2020-10-17', 2864000, 'INR', 'statement', 'd7000000-0000-4000-8000-0000000000a1');

select is(
  (select emi_converted_minor + emi_principal_minor from public.account_balance where id = 'c7100000-0000-4000-8000-000000000001'),
  0::bigint,
  'a balance carries no EMI figures unless it is given them'
);

select lives_ok(
  $q$ update public.account_balance set emi_converted_minor = 6000000, emi_principal_minor = 500000 where id = 'c7100000-0000-4000-8000-000000000001' $q$,
  'a card cycle''s converted amount and instalment principal are stored with its due'
);

select throws_ok(
  $q$ update public.account_balance set emi_converted_minor = -1 where id = 'c7100000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'the converted amount is never negative'
);

select throws_ok(
  $q$ update public.account_balance set emi_principal_minor = -1 where id = 'c7100000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'nor is the principal billed'
);

-- ============================================== CY-I17: a card's EMI debt

select throws_ok(
  $q$ insert into public.liability (household_id, name, kind, currency, card_account_id)
      values ('e7000000-0000-4000-8000-0000000000f1', 'Not a card debt', 'home_loan', 'INR', 'a7000000-0000-4000-8000-000000000002') $q$,
  '23514'::char(5), null::text,
  'CY-I17 — only a credit card debt is linked to a card'
);

select throws_ok(
  $q$ insert into public.liability (household_id, name, kind, currency, card_account_id)
      values ('e7000000-0000-4000-8000-0000000000f1', 'Dollar plan', 'credit_card', 'USD', 'a7000000-0000-4000-8000-000000000002') $q$,
  '23503'::char(5), null::text,
  'CY-I17 — and it is in the card''s own currency'
);

select throws_ok(
  $q$ insert into public.liability (household_id, name, kind, currency, card_account_id)
      values ('e7000000-0000-4000-8000-0000000000f1', 'Other household''s card', 'credit_card', 'INR', 'a7000000-0000-4000-8000-000000000005') $q$,
  '23503'::char(5), null::text,
  'CY-I17 — a card of another household cannot be linked'
);

insert into public.liability (id, household_id, name, kind, currency, card_account_id) values
  ('b7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-0000000000f1', 'Owner card — EMI plans', 'credit_card', 'INR', 'a7000000-0000-4000-8000-000000000002');

select throws_ok(
  $q$ insert into public.liability (household_id, name, kind, currency, card_account_id)
      values ('e7000000-0000-4000-8000-0000000000f1', 'A second plan debt', 'credit_card', 'INR', 'a7000000-0000-4000-8000-000000000002') $q$,
  '23505'::char(5), null::text,
  'CY-I17 — one debt per card'
);

select throws_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency, created_by)
      values ('e7000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000002', '2020-10-20', 500000, 'INR', 'd7000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'CY-I17 — a payment is not typed against a card''s debt: its instalments come from the card''s statements'
);

select lives_ok(
  $q$ insert into public.loan_payment (id, household_id, liability_id, paid_on, amount_minor, currency, created_by)
      values ('c7200000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2020-10-20', 500000, 'INR', 'd7000000-0000-4000-8000-0000000000a1') $q$,
  'CY-I17 — and an ordinary loan takes payments as it did'
);

select throws_ok(
  $q$ update public.loan_payment set liability_id = 'b7000000-0000-4000-8000-000000000002' where id = 'c7200000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'CY-I17 — nor is a payment moved onto it afterwards'
);

-- ============================================== CY-I14: close_without_card, as the database owner

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month, created_by)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2020-10-01', 'd7000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'CY-I14 — a bank account is not left out of a close: only a card that closes on its statement date'
);

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month, created_by)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000004', '2020-10-01', 'd7000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'CY-I14 — nor is a card that closes at month end'
);

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month, created_by)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000002', date_trunc('month', now() at time zone 'Asia/Kolkata')::date, 'd7000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'CY-I14 — a month that has not ended cannot be closed'
);

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month, created_by)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000002', '2020-10-15', 'd7000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'a month is its first day'
);

insert into public.close_without_card (id, household_id, account_id, month, created_by) values
  ('c7300000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000002', '2020-10-01', 'd7000000-0000-4000-8000-0000000000a1');

-- A month closed without the contributor's own card: the one choice a contributor may read (the owner, 23 November 2026).
insert into public.close_without_card (id, household_id, account_id, month, created_by) values
  ('c7300000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000003', '2020-07-01', 'd7000000-0000-4000-8000-0000000000a1');

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month, created_by)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000002', '2020-10-01', 'd7000000-0000-4000-8000-0000000000a2') $q$,
  '23505'::char(5), null::text,
  'CY-I14 — one live choice for a card and a month'
);

select throws_ok(
  $q$ update public.close_without_card set month = '2020-11-01' where id = 'c7300000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'CY-I14 — a choice is voided and made again, never edited'
);

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month, created_by)
      values ('e7000000-0000-4000-8000-0000000000f2', 'a7000000-0000-4000-8000-000000000002', '2020-09-01', 'd7000000-0000-4000-8000-0000000000b1') $q$,
  '23503'::char(5), null::text,
  'a card of another household is not named'
);

-- ============================================== the owner, with a second factor

set local role authenticated;
set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.close_without_card),
  2,
  'the owner reads the household''s closes without a card'
);

select lives_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000002', '2020-09-01') $q$,
  'CY-I14 — the owner closes a month without a card'
);

select throws_ok(
  $q$ delete from public.close_without_card $q$,
  '42501'::char(5), null::text,
  'CY-I14 — and nobody deletes a choice'
);

select lives_ok(
  $q$ update public.close_without_card set voided_at = now(), voided_by = 'd7000000-0000-4000-8000-0000000000a1' where month = '2020-09-01' $q$,
  'CY-I14 — the owner voids a choice, which is how it is undone'
);

-- ============================================== the partner

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.close_without_card),
  3,
  'the partner reads them too'
);

select is(
  (select cycle_ends from public.account where id = 'a7000000-0000-4000-8000-000000000002'),
  'statement',
  'the contributor''s attempt changed nothing: the owner''s card is still on its statement date'
);

-- ============================================== the contributor, the viewer and the stranger

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.close_without_card),
  1,
  'CY-I14 — a contributor reads the choice for their own card, so their month stops saying waiting, and none for the cards of other members'
);

select is(
  (select account_id::text from public.close_without_card),
  'a7000000-0000-4000-8000-000000000003',
  'and the one they read is of their own card, not the owner''s'
);

update public.close_without_card set voided_at = now(), voided_by = 'd7000000-0000-4000-8000-0000000000a3' where id = 'c7300000-0000-4000-8000-000000000002';

select is(
  (select voided_at from public.close_without_card where id = 'c7300000-0000-4000-8000-000000000002'),
  null::timestamptz,
  'CY-I14 — but cannot void it: only an owner or a partner undoes a choice'
);

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000003', '2020-08-01') $q$,
  '42501'::char(5), null::text,
  'CY-I14 — and cannot close a month without a card, even their own: only an owner or a partner closes a month'
);

select lives_ok(
  $q$ update public.account set cycle_ends = 'month_end' where id = 'a7000000-0000-4000-8000-000000000003' $q$,
  'the contributor sets the cycle of their own card'
);

select is(
  (select cycle_ends from public.account where id = 'a7000000-0000-4000-8000-000000000003'),
  'month_end',
  'and it is set'
);

select lives_ok(
  $q$ update public.account set cycle_ends = 'month_end' where id = 'a7000000-0000-4000-8000-000000000002' $q$,
  'and tries the cycle of another member''s card, which is a card they cannot read, so no row is touched'
);

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000002', '2020-08-01') $q$,
  '42501'::char(5), null::text,
  'CY-I14 — a viewer closes nothing'
);

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.close_without_card),
  0,
  'another household reads none of them'
);

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month)
      values ('e7000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000002', '2020-08-01') $q$,
  '42501'::char(5), null::text,
  'and writes none into this one'
);

-- ============================================== a password alone reads nothing

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is(
  (select count(*)::int from public.close_without_card),
  0,
  'a session with no second factor reads none'
);

-- ============================================== the demo reset clears them

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ select public.reset_demo_household('e7000000-0000-4000-8000-0000000000f1') $q$,
  'the owner resets the demo household, which holds a card''s debt, its choices and its accounts'
);

select is(
  (select count(*)::int from public.close_without_card where household_id = 'e7000000-0000-4000-8000-0000000000f1'),
  0,
  'the reset cleared the choices'
);

select * from finish();

rollback;
