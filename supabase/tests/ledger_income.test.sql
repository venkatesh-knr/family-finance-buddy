-- Family Finance Buddy — step 6a: who reads and writes accounts, balances, credits, transfers and tax inputs, and what the tables refuse.
--
-- FOR REVIEW with the migration beside it (20261114120000_ledger_income.sql). Not run locally: Docker is blocked on the maintainer's
-- machine, so CI's policy suite is the first run.
--
-- LI-I4  — a credit names an account of its own household, in the account's own currency, or none (accounts are optional, 14 November 2026).
-- LI-I26 — an account's type and currency cannot change once a credit, a transfer or a balance refers to it.
-- LI-I12 — a viewer reads no credit; a contributor reads only their own; nobody reads another member's private credit.
-- LI-I13 — the household's total of private income is reachable only through the sum function, by an owner or a partner, as totals
--          per currency, and the result has no member in it.
-- LI-I21 — a member's tax inputs are readable only by that member's login and by whoever typed them.
-- LI-I22 — an audit row for a credit or a tax input is readable only by whoever can read the row it records.
--
-- The table's half of four others is checked here without claiming them, because each has a half that is a pure domain test and is
-- not written yet: the category rule (LI-I1), a move being in neither came in nor spent (LI-I2), a credit rule never posting and
-- posting once per due date (LI-I8), the Form 16 precedence (LI-I11) and the business loss (LI-I19).
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(86);

-- ============================================================== the fixture
--
--   owner        household R (demo): a household account, a personal account, a private salary, a typed row for a parent
--   partner      household R: a personal card, a private salary, tax inputs of their own
--   contributor  household R: an account and a salary of their own
--   viewer       household R
--   parent       a member of R with no login, whose tax inputs the owner typed
--   stranger     owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@led.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@led.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@led.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@led.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000d1',
   'authenticated', 'authenticated', 'towner@led.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000b1';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000d1'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000d1';

insert into public.household (id, name, kind) values
  ('e9000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e9000000-0000-4000-8000-0000000000f2', 'Household S', 'demo'),
  ('e9000000-0000-4000-8000-0000000000f3', 'Household T', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f9000000-0000-4000-8000-0000000000a1', 'e9000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f9000000-0000-4000-8000-0000000000a2', 'e9000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f9000000-0000-4000-8000-0000000000a3', 'e9000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f9000000-0000-4000-8000-0000000000a4', 'e9000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f9000000-0000-4000-8000-0000000000a5', 'e9000000-0000-4000-8000-0000000000f1', 'Parent',      'c6'),
  ('f9000000-0000-4000-8000-0000000000b1', 'e9000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5'),
  ('f9000000-0000-4000-8000-0000000000c1', 'e9000000-0000-4000-8000-0000000000f3', 'T owner',     'c1'),
  ('f9000000-0000-4000-8000-0000000000c2', 'e9000000-0000-4000-8000-0000000000f3', 'T earner two', 'c2'),
  ('f9000000-0000-4000-8000-0000000000c3', 'e9000000-0000-4000-8000-0000000000f3', 'T earner three', 'c3');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d9000000-0000-4000-8000-0000000000a1', 'e9000000-0000-4000-8000-0000000000f1',
   'f9000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d9000000-0000-4000-8000-0000000000a2', 'e9000000-0000-4000-8000-0000000000f1',
   'f9000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d9000000-0000-4000-8000-0000000000a3', 'e9000000-0000-4000-8000-0000000000f1',
   'f9000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d9000000-0000-4000-8000-0000000000a4', 'e9000000-0000-4000-8000-0000000000f1',
   'f9000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d9000000-0000-4000-8000-0000000000b1', 'e9000000-0000-4000-8000-0000000000f2',
   'f9000000-0000-4000-8000-0000000000b1', 'owner'),
  ('d9000000-0000-4000-8000-0000000000d1', 'e9000000-0000-4000-8000-0000000000f3',
   'f9000000-0000-4000-8000-0000000000c1', 'owner');

-- Accounts. 01 household, INR, the owner's. 02 the owner's personal one. 03 the partner's personal card. 04 the contributor's.
-- 05 a household USD account. 06 belongs to household S.
insert into public.account (id, household_id, member_id, name, type, currency, visibility, created_by) values
  ('a9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'HDFC savings', 'savings', 'INR', 'household', 'd9000000-0000-4000-8000-0000000000a1'),
  ('a9000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'Owner''s own', 'savings', 'INR', 'personal', 'd9000000-0000-4000-8000-0000000000a1'),
  ('a9000000-0000-4000-8000-000000000003', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2',
   'Partner''s card', 'card', 'INR', 'personal', 'd9000000-0000-4000-8000-0000000000a2'),
  ('a9000000-0000-4000-8000-000000000004', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a3',
   'Contributor''s', 'savings', 'INR', 'household', 'd9000000-0000-4000-8000-0000000000a3'),
  ('a9000000-0000-4000-8000-000000000005', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'Dollar account', 'savings', 'USD', 'household', 'd9000000-0000-4000-8000-0000000000a1'),
  ('a9000000-0000-4000-8000-000000000006', 'e9000000-0000-4000-8000-0000000000f2', 'f9000000-0000-4000-8000-0000000000b1',
   'Elsewhere', 'savings', 'INR', 'household', 'd9000000-0000-4000-8000-0000000000b1');

-- Credits, all in October 2026. 01 the owner's private salary, 02 interest and 03 a refund (shared), 04 the partner's private salary,
-- 05 the contributor's salary, 06 a USD dividend, 07 household S's.
insert into public.credit_entry
  (id, household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility, created_by) values
  ('b9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'a9000000-0000-4000-8000-000000000001', 'salary',   14200000, 'INR', '2026-10-01', 'personal',  'd9000000-0000-4000-8000-0000000000a1'),
  ('b9000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'a9000000-0000-4000-8000-000000000001', 'interest',   125000, 'INR', '2026-10-05', 'household', 'd9000000-0000-4000-8000-0000000000a1'),
  ('b9000000-0000-4000-8000-000000000003', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'a9000000-0000-4000-8000-000000000001', 'refund',     129900, 'INR', '2026-10-07', 'household', 'd9000000-0000-4000-8000-0000000000a1'),
  ('b9000000-0000-4000-8000-000000000004', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2',
   'a9000000-0000-4000-8000-000000000001', 'salary',    9000000, 'INR', '2026-10-01', 'personal',  'd9000000-0000-4000-8000-0000000000a2'),
  ('b9000000-0000-4000-8000-000000000005', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a3',
   'a9000000-0000-4000-8000-000000000004', 'salary',    5000000, 'INR', '2026-10-01', 'personal',  'd9000000-0000-4000-8000-0000000000a3'),
  ('b9000000-0000-4000-8000-000000000006', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'a9000000-0000-4000-8000-000000000005', 'dividend',     20000, 'USD', '2026-10-09', 'household', 'd9000000-0000-4000-8000-0000000000a1'),
  ('b9000000-0000-4000-8000-000000000007', 'e9000000-0000-4000-8000-0000000000f2', 'f9000000-0000-4000-8000-0000000000b1',
   'a9000000-0000-4000-8000-000000000006', 'salary',    7000000, 'INR', '2026-10-01', 'personal',  'd9000000-0000-4000-8000-0000000000b1');

-- Balances: 01 of the household account, 02 of the owner's personal one, 03 of the partner's personal card.
insert into public.account_balance (id, household_id, account_id, as_at, balance_minor, currency, created_by) values
  ('c9000000-0000-4000-8000-0000000000c1', 'e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000001',
   '2026-10-31', 21238000, 'INR', 'd9000000-0000-4000-8000-0000000000a1'),
  ('c9000000-0000-4000-8000-0000000000c2', 'e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000002',
   '2026-10-31', 500000, 'INR', 'd9000000-0000-4000-8000-0000000000a1'),
  ('c9000000-0000-4000-8000-0000000000c3', 'e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000003',
   '2026-10-31', 220000, 'INR', 'd9000000-0000-4000-8000-0000000000a2');

-- Transfers: 01 from the household account to the owner's personal one; 02 from it to the partner's personal card.
insert into public.account_transfer (id, household_id, from_account_id, to_account_id, transfer_date, amount_minor, currency, created_by) values
  ('d9000000-0000-4000-8000-0000000000d1', 'e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000001',
   'a9000000-0000-4000-8000-000000000002', '2026-10-10', 1000000, 'INR', 'd9000000-0000-4000-8000-0000000000a1'),
  ('d9000000-0000-4000-8000-0000000000d2', 'e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000001',
   'a9000000-0000-4000-8000-000000000003', '2026-10-11', 1824000, 'INR', 'd9000000-0000-4000-8000-0000000000a1');

-- Tax inputs: 01 the owner's own, 02 a parent's that the owner typed, 03 the partner's own, 04 the contributor's own.
insert into public.income_entry (id, household_id, member_id, tax_year, head, amount_minor, source, created_by) values
  ('e9000000-0000-4000-8000-0000000000e1', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   '2026-27', 'salary', 22800000, 'payslip', 'd9000000-0000-4000-8000-0000000000a1'),
  ('e9000000-0000-4000-8000-0000000000e2', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a5',
   '2026-27', 'salary',  6000000, 'typed',   'd9000000-0000-4000-8000-0000000000a1'),
  ('e9000000-0000-4000-8000-0000000000e3', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2',
   '2026-27', 'salary', 18000000, 'payslip', 'd9000000-0000-4000-8000-0000000000a2'),
  ('e9000000-0000-4000-8000-0000000000e4', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a3',
   '2026-27', 'salary',  9000000, 'payslip', 'd9000000-0000-4000-8000-0000000000a3');


-- Household T: three earners, for the design's yearly-income vectors (ledger-income.md section 7), worked out as at 13 November 2026.
--   earner one   Salary May to October: 1,42,000 four times, 1,38,450 once, 2,10,000 once  -> usual 1,42,000 (LI-I9)
--                Business: 1,44,000 in ten of the twelve months November 2025 to October 2026, none in two, and a credit this month
--                that must not count                                                       -> 14,40,000 (LI-I18)
--   earner two   Salary: 1,30,000 three times then 1,50,000 three times (a tie)           -> the more recent, 1,50,000 (LI-I20)
--                Business: five complete months of 1,08,000 (5,40,000 in all)             -> average of 5 months times 12 = 12,96,000
--   earner three Salary April to October, seven different-or-equal months: April equals May, and the other six are all different, so
--                the seventh month back must drop out                                      -> the latest, 1,50,000 (LI-I20)
insert into public.account (id, household_id, member_id, name, type, currency, visibility, created_by) values
  ('a9000000-0000-4000-8000-00000000000a', 'e9000000-0000-4000-8000-0000000000f3', 'f9000000-0000-4000-8000-0000000000c1',
   'T savings', 'savings', 'INR', 'household', 'd9000000-0000-4000-8000-0000000000d1');

insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility, created_by)
select 'e9000000-0000-4000-8000-0000000000f3', v.member_id::uuid, 'a9000000-0000-4000-8000-00000000000a', v.category, v.amount, 'INR', v.day::date,
       'household', 'd9000000-0000-4000-8000-0000000000d1'
  from (values
    ('f9000000-0000-4000-8000-0000000000c1', 'salary', 14200000, '2026-05-01'),
    ('f9000000-0000-4000-8000-0000000000c1', 'salary', 14200000, '2026-06-01'),
    ('f9000000-0000-4000-8000-0000000000c1', 'salary', 13845000, '2026-07-01'),
    ('f9000000-0000-4000-8000-0000000000c1', 'salary', 14200000, '2026-08-01'),
    ('f9000000-0000-4000-8000-0000000000c1', 'salary', 21000000, '2026-09-01'),
    ('f9000000-0000-4000-8000-0000000000c1', 'salary', 14200000, '2026-10-01'),
    ('f9000000-0000-4000-8000-0000000000c2', 'salary', 13000000, '2026-05-01'),
    ('f9000000-0000-4000-8000-0000000000c2', 'salary', 13000000, '2026-06-01'),
    ('f9000000-0000-4000-8000-0000000000c2', 'salary', 13000000, '2026-07-01'),
    ('f9000000-0000-4000-8000-0000000000c2', 'salary', 15000000, '2026-08-01'),
    ('f9000000-0000-4000-8000-0000000000c2', 'salary', 15000000, '2026-09-01'),
    ('f9000000-0000-4000-8000-0000000000c2', 'salary', 15000000, '2026-10-01'),
    ('f9000000-0000-4000-8000-0000000000c3', 'salary', 10000000, '2026-04-01'),
    ('f9000000-0000-4000-8000-0000000000c3', 'salary', 10000000, '2026-05-01'),
    ('f9000000-0000-4000-8000-0000000000c3', 'salary', 11000000, '2026-06-01'),
    ('f9000000-0000-4000-8000-0000000000c3', 'salary', 12000000, '2026-07-01'),
    ('f9000000-0000-4000-8000-0000000000c3', 'salary', 13000000, '2026-08-01'),
    ('f9000000-0000-4000-8000-0000000000c3', 'salary', 14000000, '2026-09-01'),
    ('f9000000-0000-4000-8000-0000000000c3', 'salary', 15000000, '2026-10-01'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2025-11-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2025-12-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2026-01-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2026-04-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2026-05-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2026-06-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2026-07-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2026-08-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2026-09-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 14400000, '2026-10-03'),
    ('f9000000-0000-4000-8000-0000000000c1', 'business', 99900000, '2026-11-05'),
    ('f9000000-0000-4000-8000-0000000000c2', 'business', 10800000, '2026-06-03'),
    ('f9000000-0000-4000-8000-0000000000c2', 'business', 10800000, '2026-07-03'),
    ('f9000000-0000-4000-8000-0000000000c2', 'business', 10800000, '2026-08-03'),
    ('f9000000-0000-4000-8000-0000000000c2', 'business', 10800000, '2026-09-03'),
    ('f9000000-0000-4000-8000-0000000000c2', 'business', 10800000, '2026-10-03')
  ) as v (member_id, category, amount, day);

-- A salary rule: it reminds, and never posts.
insert into public.recurring_rule
  (id, household_id, name, direction, credit_category, account_id, member_id, amount_minor, currency, cadence, due_day, next_due,
   visibility, auto_post, created_by) values
  ('f9000000-0000-4000-8000-0000000000f9', 'e9000000-0000-4000-8000-0000000000f1', 'Salary', 'credit', 'salary',
   'a9000000-0000-4000-8000-000000000001', 'f9000000-0000-4000-8000-0000000000a1', 14200000, 'INR', 'monthly', 1,
   '2026-11-01', 'personal', false, 'd9000000-0000-4000-8000-0000000000a1');

-- As the database owner nobody is signed in, so created_by has no default. The tests below insert without it, to reach the check each one is
-- about, and a missing created_by would be refused first. It is given the owner's, and put back before any role is used.
alter table public.account alter column created_by set default 'd9000000-0000-4000-8000-0000000000a1';
alter table public.account_balance alter column created_by set default 'd9000000-0000-4000-8000-0000000000a1';
alter table public.credit_entry alter column created_by set default 'd9000000-0000-4000-8000-0000000000a1';
alter table public.account_transfer alter column created_by set default 'd9000000-0000-4000-8000-0000000000a1';
alter table public.income_entry alter column created_by set default 'd9000000-0000-4000-8000-0000000000a1';
alter table public.recurring_rule alter column created_by set default 'd9000000-0000-4000-8000-0000000000a1';

-- ============================================ what the tables refuse, as the database owner

select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'credit_entry' and column_name = 'account_id'),
  'YES',
  'LI-I4 — a credit may name no account: the column accepts null'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000006', 'salary', 100, 'INR', '2026-10-02') $q$,
  '23503'::char(5), null::text,
  'LI-I4 — nor to an account of another household'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000001', 'salary', 100, 'USD', '2026-10-02') $q$,
  '23503'::char(5), null::text,
  'LI-I4 — nor in a currency the account is not in'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000001', 'bonus', 100, 'INR', '2026-10-02') $q$,
  '23514'::char(5), null::text,
  'a category outside the seven is refused by the table''s check'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000001', 'salary', 0, 'INR', '2026-10-02') $q$,
  '23514'::char(5), null::text,
  'a credit of nothing is refused'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, source)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000001', 'salary', 100, 'INR', '2026-10-02', 'rule') $q$,
  '23514'::char(5), null::text,
  'a credit that says it came from a rule must say which rule and which due date'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, voided_at)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000001', 'salary', 100, 'INR', '2026-10-02', now()) $q$,
  '23514'::char(5), null::text,
  'a credit is voided by someone, or not at all'
);

select lives_ok(
  $q$ insert into public.credit_entry
        (household_id, member_id, account_id, category, amount_minor, currency, credit_date, source, recurring_rule_id, due_date)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000001', 'salary', 14200000, 'INR', '2026-10-01', 'rule',
              'f9000000-0000-4000-8000-0000000000f9', '2026-10-01') $q$,
  'a credit confirmed from the salary rule is made'
);

select throws_ok(
  $q$ insert into public.credit_entry
        (household_id, member_id, account_id, category, amount_minor, currency, credit_date, source, recurring_rule_id, due_date)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000001', 'salary', 14200000, 'INR', '2026-10-01', 'rule',
              'f9000000-0000-4000-8000-0000000000f9', '2026-10-01') $q$,
  '23505'::char(5), null::text,
  'confirming the same due date twice makes one credit and refuses the second'
);

select throws_ok(
  $q$ insert into public.recurring_rule
        (household_id, name, direction, credit_category, account_id, member_id, amount_minor, currency, cadence, due_day, next_due, auto_post)
      values ('e9000000-0000-4000-8000-0000000000f1', 'Bad', 'credit', 'salary', 'a9000000-0000-4000-8000-000000000001',
              'f9000000-0000-4000-8000-0000000000a1', 100, 'INR', 'monthly', 1, '2026-11-01', true) $q$,
  '23514'::char(5), null::text,
  'a credit rule that posts by itself is refused'
);

select throws_ok(
  $q$ insert into public.recurring_rule
        (household_id, name, direction, credit_category, member_id, amount_minor, currency, cadence, due_day, next_due, auto_post)
      values ('e9000000-0000-4000-8000-0000000000f1', 'Bad', 'credit', 'salary',
              'f9000000-0000-4000-8000-0000000000a1', 100, 'INR', 'monthly', 1, '2026-11-01', false) $q$,
  '23514'::char(5), null::text,
  'a credit rule names the account it will arrive in'
);

select throws_ok(
  $q$ insert into public.recurring_rule
        (household_id, name, category_id, direction, credit_category, member_id, amount_minor, currency, cadence, due_day, next_due)
      values ('e9000000-0000-4000-8000-0000000000f1', 'Bad', null, 'debit', 'salary',
              'f9000000-0000-4000-8000-0000000000a1', 100, 'INR', 'monthly', 1, '2026-11-01') $q$,
  '23514'::char(5), null::text,
  'a debit rule has a category and no credit category'
);

select throws_ok(
  $q$ insert into public.account (household_id, member_id, name, type, currency)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'Wallet', 'cash', 'INR') $q$,
  '23514'::char(5), null::text,
  'cash is not an account'
);

select throws_ok(
  $q$ insert into public.account (household_id, member_id, name, type, currency, account_last4)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'Long', 'savings', 'INR', '123456') $q$,
  '23514'::char(5), null::text,
  'an account keeps its last four characters and no more'
);

select throws_ok(
  $q$ insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency)
      values ('e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000001', '2026-09-30', 100, 'USD') $q$,
  '23503'::char(5), null::text,
  'a balance in a currency the account is not in is refused'
);

select throws_ok(
  $q$ insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency)
      values ('e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000001', '2026-10-31', 100, 'INR') $q$,
  '23505'::char(5), null::text,
  'one typed balance per account and day'
);

select throws_ok(
  $q$ insert into public.account_transfer (household_id, from_account_id, to_account_id, transfer_date, amount_minor, currency)
      values ('e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000001',
              'a9000000-0000-4000-8000-000000000001', '2026-10-12', 100, 'INR') $q$,
  '23514'::char(5), null::text,
  'a move from an account to itself is not a move'
);

select throws_ok(
  $q$ insert into public.account_transfer (household_id, from_account_id, to_account_id, transfer_date, amount_minor, currency)
      values ('e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000001',
              'a9000000-0000-4000-8000-000000000005', '2026-10-12', 100, 'INR') $q$,
  '23503'::char(5), null::text,
  'a move between two currencies is not modelled: both accounts must be in the transfer''s currency'
);

select throws_ok(
  $q$ insert into public.income_entry (household_id, member_id, tax_year, head, amount_minor)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', '2026-27', 'business', -1) $q$,
  '23514'::char(5), null::text,
  'a business loss is refused by the table: the typed profit is not negative'
);

select throws_ok(
  $q$ insert into public.income_entry (household_id, member_id, tax_year, head, amount_minor)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', '2026-27', 'house_property', 1) $q$,
  '23514'::char(5), null::text,
  'a head the design does not list is refused'
);

select throws_ok(
  $q$ insert into public.income_entry (household_id, member_id, tax_year, head, amount_minor)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', '2026-28', 'salary', 1) $q$,
  '23514'::char(5), null::text,
  'a tax year whose second half does not follow its first is refused'
);

select throws_ok(
  $q$ insert into public.income_entry (household_id, member_id, tax_year, head, amount_minor)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'abcd-ef', 'salary', 1) $q$,
  '23514'::char(5), null::text,
  'and one that is not a year at all is refused by the check, not by a failed cast'
);

select throws_ok(
  $q$ insert into public.income_entry (household_id, member_id, tax_year, head, amount_minor, source)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', '2026-27', 'salary', 1, 'payslip') $q$,
  '23505'::char(5), null::text,
  'one figure per member, tax year, head and source'
);

select lives_ok(
  $q$ insert into public.income_entry (household_id, member_id, tax_year, head, amount_minor, source)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', '2026-27', 'salary', 22500000, 'form16') $q$,
  'a Form 16 figure is its own row beside the payslip one'
);

-- LI-I26: an account with history keeps its type and currency. 01 has credits and a balance, 03 a balance and a transfer.
select throws_ok(
  $q$ update public.account set type = 'current' where id = 'a9000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'LI-I26 — an account with credits cannot change type'
);

select throws_ok(
  $q$ update public.account set type = 'savings' where id = 'a9000000-0000-4000-8000-000000000003' $q$,
  '23514'::char(5), null::text,
  'LI-I26 — nor one with only a balance and a transfer'
);

select throws_ok(
  $q$ update public.account set currency = 'USD' where id = 'a9000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'LI-I26 — nor change currency, in words a person can read before the key refuses it'
);

-- An account nothing refers to may still be corrected. Made, changed and removed in one block, so nothing below counts it.
select lives_ok(
  $q$ do $d$
      begin
        insert into public.account (id, household_id, member_id, name, type, currency)
          values ('a9000000-0000-4000-8000-0000000000f7', 'e9000000-0000-4000-8000-0000000000f1',
                  'f9000000-0000-4000-8000-0000000000a1', 'Typed wrongly', 'card', 'INR');
        update public.account set type = 'current', currency = 'USD' where id = 'a9000000-0000-4000-8000-0000000000f7';
        delete from public.account where id = 'a9000000-0000-4000-8000-0000000000f7';
      end $d$ $q$,
  'LI-I26 — an account with no history can still change its type and currency'
);

-- Put back, so that every insert below is attributed to whoever makes it.
alter table public.account alter column created_by set default app.current_account_id();
alter table public.account_balance alter column created_by set default app.current_account_id();
alter table public.credit_entry alter column created_by set default app.current_account_id();
alter table public.account_transfer alter column created_by set default app.current_account_id();
alter table public.income_entry alter column created_by set default app.current_account_id();
alter table public.recurring_rule alter column created_by set default app.current_account_id();

-- ============================================== the owner, with a second factor

set local role authenticated;
set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.account),
  4,
  'the owner reads the shared accounts and their own personal one, and not the partner''s personal card or another household''s'
);

select is(
  (select count(*)::int from public.credit_entry where credit_date between '2026-10-01' and '2026-10-31'),
  5,
  'LI-I12 — the owner reads their own two shared credits, their private salary and the dollar dividend, not the partner''s or the contributor''s private salaries'
);

select is(
  (select count(*)::int from public.income_entry),
  3,
  'LI-I21 — the owner reads their own two tax rows and the parent''s that they typed, and not the partner''s or the contributor''s'
);

select is(
  (select count(*)::int from public.account_balance),
  2,
  'a balance follows its account: the owner reads those of the shared account and their own, not the partner''s card'
);

select is(
  (select count(*)::int from public.account_transfer),
  1,
  'a transfer is read by whoever can read both of its accounts: the move into the partner''s personal card is not the owner''s to read'
);

select is_empty(
  $q$ with u as (update public.credit_entry set note = 'x' where id = 'b9000000-0000-4000-8000-000000000004' returning id) select id from u $q$,
  'LI-I12 — the owner updates nothing of the partner''s private credit: they cannot see it'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2',
              'a9000000-0000-4000-8000-000000000001', 'salary', 100, 'INR', '2026-09-02', 'personal') $q$,
  '42501'::char(5), null::text,
  'the owner cannot make a credit personal on somebody else''s behalf: nobody could read it again'
);

select lives_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a5',
              'a9000000-0000-4000-8000-000000000001', 'rent', 1500000, 'INR', '2026-09-15', 'household') $q$,
  'the owner records a parent''s income as the household''s'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000003', 'salary', 100, 'INR', '2026-09-02', 'personal') $q$,
  '42501'::char(5), null::text,
  'nor can a credit be put into an account the owner cannot read'
);

select lives_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              null, 'other_income', 250000, 'INR', '2026-09-16', 'household') $q$,
  'LI-I4 — the owner records money that came in outside the accounts added: a credit with no account'
);

select throws_ok(
  $q$ delete from public.credit_entry $q$,
  '42501'::char(5), null::text,
  'nobody deletes a credit: it is voided'
);

select throws_ok(
  $q$ delete from public.income_entry $q$,
  '42501'::char(5), null::text,
  'nobody deletes a tax input'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'credit_entry' and entity_id = 'b9000000-0000-4000-8000-000000000001'),
  1,
  'LI-I22 — the owner reads the audit row of their own private salary'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'income_entry' and entity_id = 'e9000000-0000-4000-8000-0000000000e1'),
  1,
  'and of their own tax input'
);

select is_empty(
  $q$ select 1 from public.audit_log where entity = 'credit_entry' and entity_id = 'b9000000-0000-4000-8000-000000000004' $q$,
  'LI-I22 — but not the audit row of the partner''s private salary'
);

select is_empty(
  $q$ select 1 from public.audit_log where entity = 'account' and entity_id = 'a9000000-0000-4000-8000-000000000003' $q$,
  'nor of the partner''s personal card'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'account_balance' and entity_id = 'c9000000-0000-4000-8000-0000000000c3'),
  0,
  'nor of a balance of that card'
);

-- ================================================ the sum function, as the owner

select results_eq(
  $q$ select currency, came_in_minor, refunds_minor
        from public.household_money_totals('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31')
       order by currency $q$,
  $q$ values ('INR'::text, 42525000::bigint, 129900::bigint), ('USD'::text, 20000::bigint, 0::bigint) $q$,
  'LI-I13 — came in per currency includes the private salaries, refunds are apart, and the currencies are never added'
);

select is(
  (select proargnames from pg_proc where proname = 'household_money_totals'),
  array['target_household_id', 'from_date', 'to_date', 'currency', 'came_in_minor', 'refunds_minor']::text[],
  'LI-I13 — its result has a currency and two sums and no member'
);

select throws_ok(
  $q$ select * from public.household_money_totals('e9000000-0000-4000-8000-0000000000f2', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'it raises for another household'
);

-- ================================================ the owner without a second factor

set local request.jwt.claims to '{"sub":"c9000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is(
  (select count(*)::int from public.credit_entry),
  0,
  'with a password alone the owner reads no credit: the second factor is a restrictive policy'
);

select is(
  (select count(*)::int from public.income_entry),
  0,
  'nor any tax input'
);

select throws_ok(
  $q$ select * from public.household_money_totals('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'and the sum function raises'
);

-- ===================================================== the partner

set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.income_entry),
  1,
  'LI-I21 — the partner reads their own tax row and nothing of the owner''s or the parent''s'
);

select is(
  (select count(*)::int from public.credit_entry where visibility = 'personal'),
  1,
  'LI-I12 — and of the private credits only their own'
);

select is_empty(
  $q$ select 1 from public.audit_log where entity = 'credit_entry' and entity_id = 'b9000000-0000-4000-8000-000000000001' $q$,
  'LI-I22 — the partner reads no audit row of the owner''s private salary'
);

select is_empty(
  $q$ select 1 from public.audit_log where entity = 'income_entry' and entity_id in
       ('e9000000-0000-4000-8000-0000000000e1', 'e9000000-0000-4000-8000-0000000000e2') $q$,
  'LI-I22 — nor of the owner''s tax input, nor of the parent''s'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'credit_entry' and entity_id = 'b9000000-0000-4000-8000-000000000002'),
  1,
  'but reads the audit row of a shared credit'
);

select is(
  (select count(*)::int from public.household_money_totals('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31')),
  2,
  'LI-I13 — the partner reads the household''s totals, one line per currency'
);

select is(
  (select count(*)::int from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f1', '2026-11-13')),
  1,
  'and its yearly income: one line, in rupees'
);

-- ================================================== the contributor

set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.credit_entry),
  1,
  'LI-I12 — the contributor reads their own credit and no other'
);

select is(
  (select count(*)::int from public.account),
  1,
  'and their own account'
);

select is(
  (select count(*)::int from public.income_entry),
  1,
  'LI-I21 — and their own tax row'
);

select lives_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a3',
              'a9000000-0000-4000-8000-000000000004', 'interest', 5000, 'INR', '2026-09-20', 'personal') $q$,
  'the contributor records their own credit'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
              'a9000000-0000-4000-8000-000000000004', 'interest', 5000, 'INR', '2026-09-20', 'household') $q$,
  '42501'::char(5), null::text,
  'but not under somebody else''s name'
);

select throws_ok(
  $q$ select * from public.household_money_totals('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'LI-I13 — and the sum function raises for a contributor'
);

select throws_ok(
  $q$ select * from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f1', '2026-11-13') $q$,
  '42501'::char(5), null::text,
  'and so does the yearly income'
);

-- ===================================================== the viewer

set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.credit_entry)
  + (select count(*)::int from public.income_entry)
  + (select count(*)::int from public.account)
  + (select count(*)::int from public.account_balance)
  + (select count(*)::int from public.account_transfer),
  0,
  'LI-I12 — a viewer reads no credit, no tax input, no account, no balance and no transfer'
);

select throws_ok(
  $q$ insert into public.credit_entry (household_id, member_id, account_id, category, amount_minor, currency, credit_date)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a4',
              'a9000000-0000-4000-8000-000000000001', 'salary', 100, 'INR', '2026-10-02') $q$,
  '42501'::char(5), null::text,
  'a viewer writes no credit'
);

select throws_ok(
  $q$ insert into public.account (household_id, member_id, name, type, currency)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a4', 'Mine', 'savings', 'INR') $q$,
  '42501'::char(5), null::text,
  'nor an account'
);

select throws_ok(
  $q$ insert into public.income_entry (household_id, member_id, tax_year, head, amount_minor)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a4', '2026-27', 'salary', 100) $q$,
  '42501'::char(5), null::text,
  'nor a tax input'
);

select throws_ok(
  $q$ select * from public.household_money_totals('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'LI-I13 — and the sum function raises for a viewer'
);

select throws_ok(
  $q$ select * from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f1', '2026-11-13') $q$,
  '42501'::char(5), null::text,
  'and so does the yearly income'
);

select is(
  (select count(*)::int from public.audit_log where entity in ('credit_entry', 'income_entry', 'account', 'account_balance', 'account_transfer')),
  0,
  'LI-I22 — and reads no audit row of any of them'
);

select is_empty(
  $q$ with u as (update public.account set name = 'x' where id = 'a9000000-0000-4000-8000-000000000001' returning id) select id from u $q$,
  'a viewer changes no account: they cannot see it'
);

-- ============================ the household's yearly income, as the owner of household T

set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000d1';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal2"}';

select results_eq(
  $q$ select currency, yearly_salary_minor, yearly_business_minor
        from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f3', '2026-11-13') $q$,
  $q$ values ('INR'::text, 530400000::bigint, 273600000::bigint) $q$,
  'the household''s yearly income is the sum over its earners: usual salary times twelve, plus business income over the last twelve complete months'
);

select is(
  (select yearly_salary_minor from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f3', '2026-11-13')),
  (14200000::bigint * 12) + (15000000::bigint * 12) + (15000000::bigint * 12),
  'the usual salary is the amount that occurs most often in the last six months entered; on a tie the more recent amount; when nothing repeats the latest month; and the seventh month back does not count'
);

select is(
  (select yearly_business_minor from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f3', '2026-11-13')),
  144000000::bigint + 129600000::bigint,
  'a month with nothing is zero inside the twelve; fewer than twelve months is their average times twelve; and a credit in the current month changes nothing'
);

select results_eq(
  $q$ select yearly_business_minor from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f3', '2026-12-05') $q$,
  $q$ values (337500000::bigint) $q$,
  'a month later the window has moved on: November 2025 drops out, the November credit counts, and the second earner''s six months are averaged'
);

select is_empty(
  $q$ select 1 from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f3', '2025-01-01') $q$,
  'with no Salary or Business income credit yet there is no line, and so no yearly income: never zero'
);

select is(
  (select proargnames from pg_proc where proname = 'household_yearly_income'),
  array['target_household_id', 'as_of', 'currency', 'yearly_salary_minor', 'yearly_business_minor']::text[],
  'its result has a currency and two sums and no member'
);

set local request.jwt.claims to '{"sub":"c9000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal1"}';

select throws_ok(
  $q$ select * from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f3', '2026-11-13') $q$,
  '42501'::char(5), null::text,
  'it raises without a second factor'
);

-- ===================================================== the stranger

set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.credit_entry where household_id = 'e9000000-0000-4000-8000-0000000000f1')
  + (select count(*)::int from public.account where household_id = 'e9000000-0000-4000-8000-0000000000f1')
  + (select count(*)::int from public.income_entry where household_id = 'e9000000-0000-4000-8000-0000000000f1'),
  0,
  'a stranger reads nothing of household R'
);

select throws_ok(
  $q$ select * from public.household_money_totals('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'and the sum function raises for a stranger'
);

select throws_ok(
  $q$ select * from public.household_yearly_income('e9000000-0000-4000-8000-0000000000f1', '2026-11-13') $q$,
  '42501'::char(5), null::text,
  'and so does the yearly income'
);

-- ================================================ the demo reset clears them

set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ select public.reset_demo_household('e9000000-0000-4000-8000-0000000000f1') $q$,
  'the owner resets the demo household'
);

select is(
  (select count(*)::int from public.credit_entry where household_id = 'e9000000-0000-4000-8000-0000000000f1')
  + (select count(*)::int from public.account_transfer where household_id = 'e9000000-0000-4000-8000-0000000000f1')
  + (select count(*)::int from public.account_balance where household_id = 'e9000000-0000-4000-8000-0000000000f1'),
  0,
  'the reset cleared its credits, transfers and balances'
);

select is(
  (select count(*)::int from public.account where household_id = 'e9000000-0000-4000-8000-0000000000f1')
  + (select count(*)::int from public.income_entry where household_id = 'e9000000-0000-4000-8000-0000000000f1'),
  0,
  'and its accounts and tax inputs'
);

select * from finish();

rollback;
