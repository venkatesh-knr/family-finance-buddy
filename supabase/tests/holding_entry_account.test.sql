-- Family Finance Buddy — a holding's entries name the account they were paid from or into (ledger-income.md section 4a, LI-I28 to LI-I31).
--
-- FOR REVIEW with the migration beside it (20261115180000_holding_entry_account.sql). Not run locally: Docker is blocked on the maintainer's
-- machine, so CI's policy suite is the first run.
--
-- LI-I28 — an entry names an account of its own household, in its own currency, or none.
-- LI-I29 — an entry may name any account of the household: there is no private account (decisions.md, 16 November 2026).
-- LI-I30 — the month close's sum function adds the holding entries the caller's own screen cannot, and only those: a purchase of another member's
--          private holding from an account the caller reads, and the proceeds of a sale in the same case.
-- LI-I31 — what that function returns has no account, no member, no holding and no date, and it is refused to anyone but an owner or a partner
--          with a second factor.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(18);

-- ============================================================== the fixture
--
--   owner        household R: a shared account, the shared holding
--   partner      household R: a savings account, a private holding
--   contributor  household R
--   stranger     owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@hea.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@hea.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@hea.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@hea.test', 'not-a-real-hash',
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

insert into public.instrument (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset) values
  ('a7000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', 'A fund', 'mutual_fund', 'INR', 'INR', false);

-- 01 a household holding of the owner's; 02 the partner's private one.
insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b7000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1',
   'a7000000-0000-4000-8000-000000000001', 10, 'household'),
  ('b7000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2',
   'a7000000-0000-4000-8000-000000000001', 20, 'personal');

-- 03 a dollar holding of the owner's, household-visible.
insert into public.instrument (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset) values
  ('a7000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f1', 'A US ETF', 'etf', 'USD', 'USD', true);
insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b7000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1',
   'a7000000-0000-4000-8000-000000000002', 5, 'household');

-- October 2026, as the month close reads it. The owner is the one asking.
--   Seen by the owner's own screen, so not in the sum: a ₹7,000 purchase of the shared holding from the shared account, and everything paid from or into
--   the partner's account for a holding of the household's, since every account is read.
--   Not in the sum for another reason: a purchase in November, and a gift (no money moved).
--   In it: ₹3,000 purchase of the partner's private holding from the shared account, and ₹1,000 of proceeds paid into it.
insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, kind, account_id, account_currency, created_by) values
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-03', 1, 700000, 'INR', 'purchase',
   'a8000000-0000-4000-8000-000000000001', 'INR', 'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-10', 1, 500000, 'INR', 'purchase',
   'a8000000-0000-4000-8000-000000000002', 'INR', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000002', '2026-10-12', 1, 300000, 'INR', 'purchase',
   'a8000000-0000-4000-8000-000000000001', 'INR', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-11-02', 1, 900000, 'INR', 'purchase',
   'a8000000-0000-4000-8000-000000000002', 'INR', 'd8000000-0000-4000-8000-0000000000a2');

insert into public.lot
  (household_id, holding_id, acquired_on, quantity, cost_minor, currency, kind, account_id, account_currency, account_amount_minor, created_by) values
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000003', '2026-10-15', 5, 10000, 'USD', 'purchase',
   'a8000000-0000-4000-8000-000000000002', 'INR', 850000, 'd8000000-0000-4000-8000-0000000000a2');

insert into public.disposal (household_id, holding_id, disposed_on, quantity, proceeds_minor, currency, kind, account_id, account_currency, created_by) values
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-20', 1, 200000, 'INR', 'sale',
   'a8000000-0000-4000-8000-000000000002', 'INR', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000002', '2026-10-21', 1, 100000, 'INR', 'redemption',
   'a8000000-0000-4000-8000-000000000001', 'INR', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-22', 1, 999999, 'INR', 'gift',
   'a8000000-0000-4000-8000-000000000002', 'INR', 'd8000000-0000-4000-8000-0000000000a2');

insert into public.disposal
  (household_id, holding_id, disposed_on, quantity, proceeds_minor, currency, kind, account_id, account_currency, account_amount_minor, created_by) values
  ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000003', '2026-10-25', 2, 5000, 'USD', 'sale',
   'a8000000-0000-4000-8000-000000000002', 'INR', 400000, 'd8000000-0000-4000-8000-0000000000a2');

-- ============================================== what the tables refuse, as the database owner

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name in ('lot', 'disposal', 'ppf_entry') and column_name = 'account_id' and is_nullable = 'YES'),
  3,
  'LI-I28 — a lot, a disposal and a PPF entry may each name no account: the column accepts null'
);

select throws_ok(
  $q$ insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, account_id, account_currency, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-02', 1, 100, 'INR',
              'a8000000-0000-4000-8000-000000000004', 'INR', 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'LI-I28 — a purchase cannot name an account of another household'
);

select throws_ok(
  $q$ insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, account_id, account_currency, account_amount_minor, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-02', 1, 100, 'INR',
              'a8000000-0000-4000-8000-000000000001', 'USD', 100, 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'LI-I28 — an entry cannot say an account is in a currency it is not in'
);

select throws_ok(
  $q$ insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, account_id, account_currency, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000003', '2026-10-02', 1, 100, 'USD',
              'a8000000-0000-4000-8000-000000000001', 'INR', 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'LI-I28 — a purchase paid from an account in another currency needs what left the account'
);

select throws_ok(
  $q$ insert into public.disposal
        (household_id, holding_id, disposed_on, quantity, proceeds_minor, currency, account_id, account_currency, account_amount_minor, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-02', 1, 100, 'INR',
              'a8000000-0000-4000-8000-000000000001', 'INR', 100, 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'LI-I28 — and a sale paid into an account in its own currency does not say it'
);

select throws_ok(
  $q$ insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, account_amount_minor, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-02', 1, 100, 'INR',
              100, 'd8000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'LI-I28 — an amount with no account is refused'
);

-- ============================================== the owner, with a second factor

set local role authenticated;
set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, account_id, account_currency)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-02', 1, 100, 'INR',
              'a8000000-0000-4000-8000-000000000001', 'INR') $q$,
  'LI-I28 — a purchase names a shared account of its own household and currency'
);

select lives_ok(
  $q$ insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, account_id, account_currency, account_amount_minor)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000003', '2026-10-02', 1, 10000, 'USD',
              'a8000000-0000-4000-8000-000000000001', 'INR', 850000) $q$,
  'LI-I28 — and a dollar purchase names a rupee account with what left it'
);

select lives_ok(
  $q$ insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-02', 1, 100, 'INR') $q$,
  'LI-I28 — and names none just as well'
);

select lives_ok(
  $q$ insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, account_id, account_currency)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-02', 1, 100, 'INR',
              'a8000000-0000-4000-8000-000000000002', 'INR') $q$,
  'LI-I29 — a purchase can be paid from the partner''s account: there is no private account'
);

select lives_ok(
  $q$ update public.lot set account_id = 'a8000000-0000-4000-8000-000000000002', account_currency = 'INR'
       where holding_id = 'b7000000-0000-4000-8000-000000000001' and acquired_on = '2026-10-03' $q$,
  'LI-I29 — and an existing purchase can be moved onto it'
);

select lives_ok(
  $q$ insert into public.disposal (household_id, holding_id, disposed_on, quantity, proceeds_minor, currency, account_id, account_currency)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-25', 1, 100, 'INR',
              'a8000000-0000-4000-8000-000000000001', 'INR') $q$,
  'LI-I28 — a sale is paid into a shared account'
);

select lives_ok(
  $q$ insert into public.disposal (household_id, holding_id, disposed_on, quantity, proceeds_minor, currency, account_id, account_currency)
      values ('e8000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-000000000001', '2026-10-25', 1, 100, 'INR',
              'a8000000-0000-4000-8000-000000000002', 'INR') $q$,
  'LI-I29 — and a sale can be paid into it'
);

-- ============================================== the sums, for the owner

-- The rows added above by the owner for October are of shared holdings and are seen by the owner's own screen: they add nothing. What the owner's screen
-- cannot add, for October 2026, per the fixture: ₹3,000 into the partner's private holding from the shared account, and ₹1,000 of its proceeds paid into the
-- shared account, which is money in to that account and so left it: ₹1,000 left, ₹1,000 out of holdings. Everything paid from or into the partner's account
-- for a shared holding is the owner's to see, the November purchase is another month's, and the ₹9,999.99 gift moved no money.
select results_eq(
  $q$ select currency, left_minor, outside_minor, refunds_minor, came_in_minor, into_holdings_minor, out_of_holdings_minor
        from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31')
       order by currency $q$,
  $q$ values ('INR'::text, 100000::bigint, 0::bigint, 0::bigint, 0::bigint, 300000::bigint, 100000::bigint) $q$,
  'LI-I30 — the sum adds a purchase of a private holding and its proceeds, and nothing the caller''s screen adds'
);

select is(
  (select proargnames from pg_proc where proname = 'household_private_close'),
  array['target_household_id', 'month_first', 'month_last', 'currency', 'left_minor', 'outside_minor', 'refunds_minor',
        'came_in_minor', 'into_holdings_minor', 'out_of_holdings_minor']::text[],
  'LI-I31 — its result has a currency and six sums, and no account, no member, no holding, no balance and no date'
);

select throws_ok(
  $q$ select * from public.household_private_close('e8000000-0000-4000-8000-0000000000f2', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'LI-I31 — it raises for another household'
);

-- ============================================== a contributor, and an owner with a password alone

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select * from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'LI-I31 — it raises for a contributor'
);

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select throws_ok(
  $q$ select * from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'LI-I31 — and for an owner with a password alone'
);

select * from finish();

rollback;
