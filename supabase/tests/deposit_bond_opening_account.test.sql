-- Family Finance Buddy — a deposit, a bond and a holding's opening cost name the account they were paid from or into
-- (ledger-income.md section 4b, LI-I32 to LI-I35).
--
-- FOR REVIEW with the migration beside it (20261115200000_deposit_bond_opening_account.sql). Not run locally: Docker is blocked on the maintainer's
-- machine, so CI's policy suite is the first run.
--
-- LI-I32 — a deposit's principal names an account of its own household, in its own currency or with what left the account, or none.
-- LI-I33 — its payout is paid into an account of its own household in its own currency, or none.
-- LI-I34 — a holding's opening cost names an account only with a cost and a currency; and an account named is one its writer can read (LI-I29).
-- LI-I35 — the month close's sum function adds the principal and the opening cost the caller's own screen cannot, and only those, and not a recurring
--          deposit's, an earlier month's, a holding that has a purchase or terms, or a cost in another currency than the account's.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(16);

-- ============================================================== the fixture
--
--   owner        household R: a shared account, shared holdings
--   partner      household R: a savings account, a private deposit
--   contributor  household R
--   stranger     owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@dba.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@dba.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@dba.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@dba.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c9000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e9000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e9000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f9000000-0000-4000-8000-0000000000a1', 'e9000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f9000000-0000-4000-8000-0000000000a2', 'e9000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f9000000-0000-4000-8000-0000000000a3', 'e9000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f9000000-0000-4000-8000-0000000000b1', 'e9000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d9000000-0000-4000-8000-0000000000a1', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d9000000-0000-4000-8000-0000000000a2', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d9000000-0000-4000-8000-0000000000a3', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d9000000-0000-4000-8000-0000000000b1', 'e9000000-0000-4000-8000-0000000000f2', 'f9000000-0000-4000-8000-0000000000b1', 'owner');

-- Accounts, all the household's. 01 INR. 02 the partner's own savings. 03 a USD account. 04 belongs to household S.
insert into public.account (id, household_id, member_id, name, type, currency, visibility, created_by) values
  ('a9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'HDFC savings', 'savings', 'INR', 'household', 'd9000000-0000-4000-8000-0000000000a1'),
  ('a9000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2',
   'Partner''s own', 'savings', 'INR', 'household', 'd9000000-0000-4000-8000-0000000000a2'),
  ('a9000000-0000-4000-8000-000000000003', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1',
   'Dollar account', 'savings', 'USD', 'household', 'd9000000-0000-4000-8000-0000000000a1'),
  ('a9000000-0000-4000-8000-000000000004', 'e9000000-0000-4000-8000-0000000000f2', 'f9000000-0000-4000-8000-0000000000b1',
   'Elsewhere', 'savings', 'INR', 'household', 'd9000000-0000-4000-8000-0000000000b1');

-- The partner's account had ₹10,000 on 30 September and ₹4,000 on 31 October.
insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency, created_by) values
  ('e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000002', '2026-09-30', 1000000, 'INR', 'd9000000-0000-4000-8000-0000000000a2'),
  ('e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-000000000002', '2026-10-31', 400000, 'INR', 'd9000000-0000-4000-8000-0000000000a2');

-- Instruments, one per holding (a member holds an instrument once). 01 to 05 and 07 INR deposits (06 is dollars; 04 a recurring one); 11 to 14 funds and an ETF.
insert into public.instrument (id, household_id, name, kind, scheme, currency, exposure_currency, is_foreign_asset) values
  ('a6000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-0000000000f1', 'FD one',   'deposit', 'fd', 'INR', 'INR', false),
  ('a6000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-0000000000f1', 'FD two',   'deposit', 'fd', 'INR', 'INR', false),
  ('a6000000-0000-4000-8000-000000000003', 'e9000000-0000-4000-8000-0000000000f1', 'FD three', 'deposit', 'fd', 'INR', 'INR', false),
  ('a6000000-0000-4000-8000-000000000004', 'e9000000-0000-4000-8000-0000000000f1', 'RD',       'deposit', 'rd', 'INR', 'INR', false),
  ('a6000000-0000-4000-8000-000000000005', 'e9000000-0000-4000-8000-0000000000f1', 'FD five',  'deposit', 'fd', 'INR', 'INR', false),
  ('a6000000-0000-4000-8000-000000000006', 'e9000000-0000-4000-8000-0000000000f1', 'USD FD',   'deposit', 'fd', 'USD', 'USD', true);
insert into public.instrument (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset) values
  ('a6000000-0000-4000-8000-000000000011', 'e9000000-0000-4000-8000-0000000000f1', 'Fund one',   'mutual_fund', 'INR', 'INR', false),
  ('a6000000-0000-4000-8000-000000000012', 'e9000000-0000-4000-8000-0000000000f1', 'Fund two',   'mutual_fund', 'INR', 'INR', false),
  ('a6000000-0000-4000-8000-000000000013', 'e9000000-0000-4000-8000-0000000000f1', 'Fund three', 'mutual_fund', 'INR', 'INR', false),
  ('a6000000-0000-4000-8000-000000000014', 'e9000000-0000-4000-8000-0000000000f1', 'A US ETF',   'etf', 'USD', 'USD', true),
  ('a6000000-0000-4000-8000-000000000015', 'e9000000-0000-4000-8000-0000000000f1', 'Fund five', 'mutual_fund', 'INR', 'INR', false);

-- Holdings. D1 to D6 the deposits: D2 is the partner's, private; the rest the owner's. H1 to H4 opened with a cost and no purchase (H3 then given one).
insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b6000000-0000-4000-8000-0000000000d1', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000001', 1, 'household'),
  ('b6000000-0000-4000-8000-0000000000d2', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2', 'a6000000-0000-4000-8000-000000000002', 1, 'personal'),
  ('b6000000-0000-4000-8000-0000000000d3', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000003', 1, 'household'),
  ('b6000000-0000-4000-8000-0000000000d4', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000004', 1, 'household'),
  ('b6000000-0000-4000-8000-0000000000d5', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000005', 1, 'household'),
  ('b6000000-0000-4000-8000-0000000000d6', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000006', 1, 'household');

-- The contributor's own holding, with no cost and no account.
insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b6000000-0000-4000-8000-0000000000e5', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a3',
   'a6000000-0000-4000-8000-000000000015', 1, 'household');

insert into public.holding
  (id, household_id, member_id, instrument_id, quantity, visibility, cost_minor, opened_on, cost_account_id, cost_account_currency) values
  ('b6000000-0000-4000-8000-0000000000e1', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000011',
   10, 'household', 400000, '2026-10-05', 'a9000000-0000-4000-8000-000000000002', 'INR'),
  ('b6000000-0000-4000-8000-0000000000e2', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000012',
   10, 'household', 250000, '2026-10-06', 'a9000000-0000-4000-8000-000000000001', 'INR'),
  ('b6000000-0000-4000-8000-0000000000e3', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000013',
   10, 'household', 111111, '2026-10-07', 'a9000000-0000-4000-8000-000000000002', 'INR'),
  ('b6000000-0000-4000-8000-0000000000e4', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'a6000000-0000-4000-8000-000000000014',
   5, 'household', 1000, '2026-10-09', 'a9000000-0000-4000-8000-000000000002', 'INR');

-- H3 has a purchase after all, so its cost is no longer what went in.
insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by) values
  ('e9000000-0000-4000-8000-0000000000f1', 'b6000000-0000-4000-8000-0000000000e3', '2026-10-07', 10, 111111, 'INR', 'd9000000-0000-4000-8000-0000000000a1');

-- The terms. October 2026, as the month close reads it. The owner is the one asking.
--   In the sum:  D2 the partner's private deposit, ₹3,000 from the shared account.
--   Not in it:   D1 ₹5,000 and D6 ₹8,500 from the partner's account, and D3 ₹7,000 from the shared account (the owner's holdings, so the owner's screen adds
--                them: every account is read); D4 a recurring deposit; D5 started in September.
insert into public.fixed_income_terms
  (holding_id, household_id, kind, principal_minor, currency, rate_pct, start_date, maturity_date, compounding,
   account_id, account_currency, account_amount_minor, created_by) values
  ('b6000000-0000-4000-8000-0000000000d1', 'e9000000-0000-4000-8000-0000000000f1', 'deposit', 500000, 'INR', 7.1, '2026-10-05', '2027-10-05', 'yearly',
   'a9000000-0000-4000-8000-000000000002', 'INR', null, 'd9000000-0000-4000-8000-0000000000a1'),
  ('b6000000-0000-4000-8000-0000000000d2', 'e9000000-0000-4000-8000-0000000000f1', 'deposit', 300000, 'INR', 7.1, '2026-10-07', '2027-10-07', 'yearly',
   'a9000000-0000-4000-8000-000000000001', 'INR', null, 'd9000000-0000-4000-8000-0000000000a2'),
  ('b6000000-0000-4000-8000-0000000000d3', 'e9000000-0000-4000-8000-0000000000f1', 'deposit', 700000, 'INR', 7.1, '2026-10-08', '2027-10-08', 'yearly',
   'a9000000-0000-4000-8000-000000000001', 'INR', null, 'd9000000-0000-4000-8000-0000000000a1'),
  ('b6000000-0000-4000-8000-0000000000d4', 'e9000000-0000-4000-8000-0000000000f1', 'deposit', 100000, 'INR', 6.5, '2026-10-09', '2027-10-09', 'quarterly',
   'a9000000-0000-4000-8000-000000000002', 'INR', null, 'd9000000-0000-4000-8000-0000000000a1'),
  ('b6000000-0000-4000-8000-0000000000d5', 'e9000000-0000-4000-8000-0000000000f1', 'deposit', 200000, 'INR', 7.1, '2026-09-20', '2027-09-20', 'yearly',
   'a9000000-0000-4000-8000-000000000002', 'INR', null, 'd9000000-0000-4000-8000-0000000000a1'),
  ('b6000000-0000-4000-8000-0000000000d6', 'e9000000-0000-4000-8000-0000000000f1', 'deposit', 10000, 'USD', 4.5, '2026-10-15', '2027-10-15', 'yearly',
   'a9000000-0000-4000-8000-000000000002', 'INR', 850000, 'd9000000-0000-4000-8000-0000000000a1');

-- ============================================== what the tables refuse, as the database owner

select throws_ok(
  $q$ update public.fixed_income_terms set account_id = 'a9000000-0000-4000-8000-000000000004', account_currency = 'INR'
       where holding_id = 'b6000000-0000-4000-8000-0000000000d3' $q$,
  '23503'::char(5), null::text,
  'LI-I32 — a principal cannot be paid from an account of another household'
);

select throws_ok(
  $q$ update public.fixed_income_terms set account_id = 'a9000000-0000-4000-8000-000000000001', account_currency = 'USD', account_amount_minor = 100
       where holding_id = 'b6000000-0000-4000-8000-0000000000d3' $q$,
  '23503'::char(5), null::text,
  'LI-I32 — nor can an entry say an account is in a currency it is not in'
);

select throws_ok(
  $q$ update public.fixed_income_terms set account_amount_minor = null
       where holding_id = 'b6000000-0000-4000-8000-0000000000d6' $q$,
  '23514'::char(5), null::text,
  'LI-I32 — a dollar deposit paid from a rupee account needs what left the account'
);

select throws_ok(
  $q$ update public.fixed_income_terms set account_amount_minor = 100
       where holding_id = 'b6000000-0000-4000-8000-0000000000d3' $q$,
  '23514'::char(5), null::text,
  'LI-I32 — and a rupee deposit paid from a rupee account does not say it'
);

select throws_ok(
  $q$ update public.fixed_income_terms set payout_account_id = 'a9000000-0000-4000-8000-000000000003'
       where holding_id = 'b6000000-0000-4000-8000-0000000000d3' $q$,
  '23503'::char(5), null::text,
  'LI-I33 — a rupee deposit is not paid out into a dollar account'
);

select lives_ok(
  $q$ update public.fixed_income_terms set payout_account_id = 'a9000000-0000-4000-8000-000000000001'
       where holding_id = 'b6000000-0000-4000-8000-0000000000d3' $q$,
  'LI-I33 — it is paid into a shared account in its own currency'
);

select throws_ok(
  $q$ update public.holding set cost_account_currency = null where id = 'b6000000-0000-4000-8000-0000000000e2' $q$,
  '23514'::char(5), null::text,
  'LI-I34 — an opening cost cannot name an account without saying its currency'
);

select throws_ok(
  $q$ update public.holding set cost_minor = null where id = 'b6000000-0000-4000-8000-0000000000e2' $q$,
  '23514'::char(5), null::text,
  'LI-I34 — nor an account with no cost to have paid'
);

select throws_ok(
  $q$ update public.holding set cost_account_id = 'a9000000-0000-4000-8000-000000000004' where id = 'b6000000-0000-4000-8000-0000000000e2' $q$,
  '23503'::char(5), null::text,
  'LI-I34 — nor an account of another household'
);

-- ============================================== the policies: every account of the household is the owner's to read

set local role authenticated;
set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.account where id = 'a9000000-0000-4000-8000-000000000002'),
  1,
  'LI-I29 — the owner reads the partner''s account, so a deposit, a payout or an opening cost can name it: there is no private account'
);

-- ============================================== the sums, for the owner

-- No account is hidden from the owner. Into holdings that the owner's own screen cannot add: D2 ₹3,000, the partner's private deposit. Not in it: D1, D3, D6,
-- H1 and H3 (the owner's own holdings, which the owner's screen adds), D4 (a recurring deposit), D5 (September), H2 (the owner's), H3 (it has a purchase),
-- H4 (a cost in dollars named against a rupee account).
select results_eq(
  $q$ select currency, left_minor, outside_minor, refunds_minor, came_in_minor, into_holdings_minor, out_of_holdings_minor
        from public.household_private_close('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31')
       order by currency $q$,
  $q$ values ('INR'::text, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 300000::bigint, 0::bigint) $q$,
  'LI-I35 — the sum adds only the principal of the partner''s private deposit: what the owner''s own screen adds is not in it, nor a recurring deposit, an earlier month or a cost in the wrong currency'
);

select is(
  (select proargnames from pg_proc where proname = 'household_private_close'),
  array['target_household_id', 'month_first', 'month_last', 'currency', 'left_minor', 'outside_minor', 'refunds_minor',
        'came_in_minor', 'into_holdings_minor', 'out_of_holdings_minor']::text[],
  'LI-I31 — its result is a currency and six sums, and no account, no member, no holding, no balance and no date'
);

select throws_ok(
  $q$ select * from public.household_private_close('e9000000-0000-4000-8000-0000000000f2', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'LI-I31 — it raises for another household'
);

-- ============================================== a contributor, and an owner with a password alone

set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select * from public.household_private_close('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'LI-I31 — it raises for a contributor'
);

-- LI-I29 for the role that still reads only its own accounts: account 01 is the owner's, so a contributor cannot say their holding's opening cost was paid from it.
set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ update public.holding set cost_minor = 100, cost_account_id = 'a9000000-0000-4000-8000-000000000001', cost_account_currency = 'INR'
       where id = 'b6000000-0000-4000-8000-0000000000e5' $q$,
  '42501'::char(5), null::text,
  'LI-I29 — a contributor cannot pay an opening cost from an account that is another member''s'
);

set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select throws_ok(
  $q$ select * from public.household_private_close('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'LI-I31 — and for an owner with a password alone'
);

select * from finish();

rollback;
