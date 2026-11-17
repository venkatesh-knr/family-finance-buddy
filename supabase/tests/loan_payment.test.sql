-- Family Finance Buddy — a loan payment (ledger-income.md section 4c, LI-I36 to LI-I39).
--
-- FOR REVIEW with the migration beside it (20261116120000_loan_payment.sql). Not run locally: Docker is blocked on the maintainer's machine, so CI's
-- policy suite is the first run.
--
-- LI-I36 — a payment names a loan of its own household and is in the loan's currency; an account it names is of its household and in that currency;
--          only an owner or a partner writes one.
-- LI-I37 — a payment is the household's, whichever account it names (there is no private account, decisions.md 16 November 2026), and so is its audit row.
-- LI-I39 — a payment does not change what the loan says is outstanding.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(14);

-- ============================================================== the fixture
--
--   owner        household R: a shared account, a loan
--   partner      household R: a savings account
--   contributor  household R
--   stranger     owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@lpt.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@lpt.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@lpt.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@lpt.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e8000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e8000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f8000000-0000-4000-8000-0000000000a2', 'e8000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f8000000-0000-4000-8000-0000000000a3', 'e8000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d8000000-0000-4000-8000-0000000000a2', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d8000000-0000-4000-8000-0000000000a3', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-0000000000f2', 'f8000000-0000-4000-8000-0000000000b1', 'owner');

-- Accounts, all the household's. 01 INR. 02 the partner's own savings. 03 a USD account. 04 belongs to household S.
insert into public.account (id, household_id, member_id, name, type, currency, visibility, created_by) values
  ('a8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1',
   'HDFC savings', 'savings', 'INR', 'household', 'd8000000-0000-4000-8000-0000000000a1'),
  ('a8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2',
   'Partner''s own', 'savings', 'INR', 'household', 'd8000000-0000-4000-8000-0000000000a2'),
  ('a8000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1',
   'Dollar account', 'savings', 'USD', 'household', 'd8000000-0000-4000-8000-0000000000a1'),
  ('a8000000-0000-4000-8000-000000000004', 'e8000000-0000-4000-8000-0000000000f2', 'f8000000-0000-4000-8000-0000000000b1',
   'Elsewhere', 'savings', 'INR', 'household', 'd8000000-0000-4000-8000-0000000000b1');

-- The partner's account had ₹10,000 on 30 September and ₹4,000 on 31 October.
insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency, created_by) values
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000002', '2026-09-30', 1000000, 'INR', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000002', '2026-10-31', 400000, 'INR', 'd8000000-0000-4000-8000-0000000000a2');

-- The loans. L1 a rupee home loan with a stated outstanding. L2 a dollar loan. L3 belongs to household S.
insert into public.liability (id, household_id, name, kind, instalment_minor, currency, cadence, outstanding_minor, outstanding_as_of) values
  ('a7000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', 'Home loan',  'home_loan', 3200000, 'INR', 'monthly', 400000000, '2026-10-01'),
  ('a7000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f1', 'Dollar loan', 'loan',       100000, 'USD', 'monthly', null, null),
  ('a7000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-0000000000f2', 'Elsewhere',   'loan',       100000, 'INR', 'monthly', null, null);

-- The payments, October 2026.
--   P1  ₹32,000 from the shared account.
--   P2  ₹5,000 from the partner's account.
--   P3  ₹32,000 naming no account.
--   P4  ₹5,000 from the partner's account, voided.
--   P5  ₹5,000 from the partner's account in September.
insert into public.loan_payment (id, household_id, liability_id, paid_on, amount_minor, currency, account_id, voided_at, voided_by, created_by) values
  ('b8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-05', 3200000, 'INR',
   'a8000000-0000-4000-8000-000000000001', null, null, 'd8000000-0000-4000-8000-0000000000a1'),
  ('b8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-06', 500000, 'INR',
   'a8000000-0000-4000-8000-000000000002', null, null, 'd8000000-0000-4000-8000-0000000000a2'),
  ('b8000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-07', 3200000, 'INR',
   null, null, null, 'd8000000-0000-4000-8000-0000000000a1'),
  ('b8000000-0000-4000-8000-000000000004', 'e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-08', 500000, 'INR',
   'a8000000-0000-4000-8000-000000000002', now(), 'd8000000-0000-4000-8000-0000000000a2', 'd8000000-0000-4000-8000-0000000000a2'),
  ('b8000000-0000-4000-8000-000000000005', 'e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-09-20', 500000, 'INR',
   'a8000000-0000-4000-8000-000000000002', null, null, 'd8000000-0000-4000-8000-0000000000a2');

-- ============================================== what the table refuses, as the database owner

select throws_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000003', '2026-10-10', 100, 'INR', 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'LI-I36 — a payment cannot name a loan of another household'
);

select throws_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-10', 100, 'USD', 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'LI-I36 — nor say it is in a currency the loan is not in'
);

select throws_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency, account_id, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-10', 100, 'INR',
              'a8000000-0000-4000-8000-000000000003', 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'LI-I36 — nor leave an account in another currency than its own'
);

select throws_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency, account_id, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-10', 100, 'INR',
              'a8000000-0000-4000-8000-000000000004', 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'LI-I36 — nor an account of another household'
);

select throws_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-10', 0, 'INR', 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'LI-I36 — a payment is more than nothing'
);

select throws_ok(
  $q$ update public.loan_payment set voided_at = now() where id = 'b8000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'a payment is voided by someone: the time and the person go together'
);

-- ============================================== the policies, as the owner

set local role authenticated;
set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency, account_id)
      values ('e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-20', 100, 'INR',
              'a8000000-0000-4000-8000-000000000001') $q$,
  'LI-I36 — an owner records a payment from a shared account'
);

select lives_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency, account_id)
      values ('e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-20', 100, 'INR',
              'a8000000-0000-4000-8000-000000000002') $q$,
  'LI-I36 — and from the partner''s account: there is no private account'
);

select lives_ok(
  $q$ update public.loan_payment set account_id = 'a8000000-0000-4000-8000-000000000002' where id = 'b8000000-0000-4000-8000-000000000003' $q$,
  'LI-I36 — and a payment can be moved onto it'
);

-- Of the five seeded payments and the two just recorded, the owner reads all seven.
select is(
  (select count(*)::int from public.loan_payment),
  7,
  'LI-I37 — the owner reads every payment, whichever account it names'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'loan_payment' and entity_id = 'b8000000-0000-4000-8000-000000000001'),
  1,
  'LI-I37 — the owner reads the audit row of a payment'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'loan_payment' and entity_id = 'b8000000-0000-4000-8000-000000000002'),
  1,
  'LI-I37 — and the audit row of a payment from the partner''s account'
);

select is(
  (select outstanding_minor from public.liability where id = 'a7000000-0000-4000-8000-000000000001'),
  400000000::bigint,
  'LI-I39 — recording payments leaves what the loan says is outstanding as it was'
);

-- ============================================== a contributor

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.loan_payment (household_id, liability_id, paid_on, amount_minor, currency)
      values ('e8000000-0000-4000-8000-0000000000f1', 'a7000000-0000-4000-8000-000000000001', '2026-10-21', 100, 'INR') $q$,
  '42501'::char(5), null::text,
  'LI-I36 — a contributor records no payment: only an owner or a partner does, as with a loan'
);

select * from finish();

rollback;
