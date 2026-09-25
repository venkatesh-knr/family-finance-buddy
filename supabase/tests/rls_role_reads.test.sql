-- Family Finance Buddy — what each role can read.
--
-- docs/blueprint.md §11: a contributor sees their own records plus household
-- expense totals; a viewer sees a household summary and nothing else. Until
-- 20260925120000 the database enforced neither — every role read every household
-- row — so this file is the proof of the narrowing, and it is written the way the
-- rest of the suite is: each policy with an assertion that it *denies*.
--
-- One household, one login of each role, and rows that belong to each of them.
-- The amounts are all different powers of two times a hundred thousand, so an
-- assertion on a sum can only pass for one combination of rows.
--
--   expenses     owner shared 100000, partner shared 200000,
--                contributor shared 400000, contributor private 800000,
--                owner private 1600000
--   holdings     owner, partner and contributor one shared holding each, valued
--                1000000, 2000000, 4000000; the contributor also has a private
--                one valued 8000000
--
-- Then the same question asked as each role. The owner and the partner are
-- asserted to read exactly what they did before; a narrowing that took a row from
-- them would be a regression, not a feature.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(37);

-- ============================================================== the fixture

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@roles.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@roles.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@roles.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@roles.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd0000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c0000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd0000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c0000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd0000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c0000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd0000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c0000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd0000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c0000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e0000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e0000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f0000000-0000-4000-8000-0000000000a2', 'e0000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f0000000-0000-4000-8000-0000000000a3', 'e0000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f0000000-0000-4000-8000-0000000000a4', 'e0000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d0000000-0000-4000-8000-0000000000a2', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d0000000-0000-4000-8000-0000000000a3', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d0000000-0000-4000-8000-0000000000a4', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000f2',
   'f0000000-0000-4000-8000-0000000000b1', 'owner');

-- Expenses, all in April 2026.
insert into public.expense_txn
  (id, household_id, member_id, txn_date, amount_minor, currency, payee, visibility, created_by) values
  ('10000000-0000-4000-8000-0000000000e1', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a1', date '2026-04-02', 100000, 'INR',
   'Electricity', 'household', 'd0000000-0000-4000-8000-0000000000a1'),
  ('10000000-0000-4000-8000-0000000000e2', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a2', date '2026-04-03', 200000, 'INR',
   'Grocery', 'household', 'd0000000-0000-4000-8000-0000000000a2'),
  ('10000000-0000-4000-8000-0000000000e3', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a3', date '2026-04-04', 400000, 'INR',
   'Bus pass', 'household', 'd0000000-0000-4000-8000-0000000000a3'),
  ('10000000-0000-4000-8000-0000000000e4', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a3', date '2026-04-05', 800000, 'INR',
   'A private thing', 'personal', 'd0000000-0000-4000-8000-0000000000a3'),
  ('10000000-0000-4000-8000-0000000000e5', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a1', date '2026-04-06', 1600000, 'INR',
   'Another private thing', 'personal', 'd0000000-0000-4000-8000-0000000000a1');

-- The plan.
insert into public.expense_category (id, household_id, name, nature) values
  ('ca000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1', 'Utilities', 'fixed');

insert into public.budget
  (id, household_id, category_id, fy, cadence, period, planned_minor, currency) values
  ('0b000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1',
   'ca000000-0000-4000-8000-000000000001', 2026, 'monthly', 4, 5000000, 'INR');

-- Holdings, and a reading of each.
insert into public.instrument
  (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset) values
  ('a1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1',
   'A shared fund', 'etf', 'INR', 'INR', false),
  ('a2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-0000000000f1',
   'A private fund', 'etf', 'INR', 'INR', false);

insert into public.holding
  (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000001', 10, 'household'),
  ('b1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-000000000001', 20, 'household'),
  ('b1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a3', 'a1000000-0000-4000-8000-000000000001', 40, 'household'),
  ('b1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-0000000000f1',
   'f0000000-0000-4000-8000-0000000000a3', 'a2000000-0000-4000-8000-000000000002', 80, 'personal');

insert into public.valuation_snapshot
  (id, household_id, holding_id, as_of_date, quantity, value_minor, currency, created_by) values
  ('b2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1',
   'b1000000-0000-4000-8000-000000000001', date '2026-04-30', 10, 1000000, 'INR',
   'd0000000-0000-4000-8000-0000000000a1'),
  ('b2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-0000000000f1',
   'b1000000-0000-4000-8000-000000000002', date '2026-04-30', 20, 2000000, 'INR',
   'd0000000-0000-4000-8000-0000000000a2'),
  ('b2000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-0000000000f1',
   'b1000000-0000-4000-8000-000000000003', date '2026-04-30', 40, 4000000, 'INR',
   'd0000000-0000-4000-8000-0000000000a3'),
  ('b2000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-0000000000f1',
   'b1000000-0000-4000-8000-000000000004', date '2026-04-30', 80, 8000000, 'INR',
   'd0000000-0000-4000-8000-0000000000a3');

-- A household loan, the owner's, and the contributor's; and two policies.
insert into public.liability (id, household_id, name, member_id) values
  ('11000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1', 'Home loan', null),
  ('11000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-0000000000f1', 'Owner car loan',
   'f0000000-0000-4000-8000-0000000000a1'),
  ('11000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-0000000000f1', 'Contributor loan',
   'f0000000-0000-4000-8000-0000000000a3');

insert into public.insurance_policy (id, household_id, name, kind, member_id) values
  ('12000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1', 'Family floater', 'health', null),
  ('12000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-0000000000f1', 'Contributor term', 'term_life',
   'f0000000-0000-4000-8000-0000000000a3');

-- A pending invitation, the imports two people ran, and a rate.
insert into public.invite
  (id, household_id, display_name, role, email, code_hash, expires_at, created_by) values
  ('13000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1',
   'A guest', 'viewer', 'guest@roles.test', repeat('a', 64), now() + interval '1 day',
   'd0000000-0000-4000-8000-0000000000a1');

insert into public.import_batch (id, household_id, kind, created_by) values
  ('14000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1', 'bank_csv',
   'd0000000-0000-4000-8000-0000000000a1'),
  ('14000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-0000000000f1', 'bank_csv',
   'd0000000-0000-4000-8000-0000000000a3');

insert into public.fx_rate
  (id, household_id, base_currency, quote_currency, rate, as_of_date, created_by) values
  ('15000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000f1',
   'USD', 'INR', 83.5, date '2026-04-01', 'd0000000-0000-4000-8000-0000000000a1');

-- ==================================================== the owner: unchanged (6)

set local role authenticated;
set local request.jwt.claim.sub to 'c0000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c0000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.expense_txn),
  4,
  'the owner reads the shared entries and their own private one, and not the contributor''s private one'
);

select is(
  (select count(*)::int from public.holding),
  3,
  'the owner reads the three shared holdings, and not the contributor''s private one'
);

select is(
  (select count(*)::int from public.liability),
  3,
  'the owner reads every loan, the household''s and each member''s'
);

select is(
  (select count(*)::int from public.invite),
  1,
  'the owner reads the pending invitation'
);

select is(
  (select count(*)::int from public.import_batch),
  2,
  'the owner reads every import'
);

select is(
  (select total_minor from public.personal_holding_totals('e0000000-0000-4000-8000-0000000000f1')
    where member_id = 'f0000000-0000-4000-8000-0000000000a3'),
  8000000::bigint,
  'and the one-sum-per-member total of the contributor''s private holding, which is the owner''s to read'
);

-- =================================================== the partner: unchanged (3)

set local request.jwt.claim.sub to 'c0000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c0000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.expense_txn),
  3,
  'the partner reads the three shared entries and none of the private ones'
);

select is(
  (select count(*)::int from public.holding),
  3,
  'the partner reads the three shared holdings'
);

select is(
  (select count(*)::int from public.invite),
  1,
  'the partner reads the pending invitation'
);

-- ============================================ the contributor: their own (17)

set local request.jwt.claim.sub to 'c0000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c0000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.expense_txn),
  2,
  'a contributor reads their own two entries, the shared one and the private one'
);

select is(
  (select sum(amount_minor)::bigint from public.expense_txn),
  1200000::bigint,
  'and they are the contributor''s two, 400000 and 800000, and nobody else''s'
);

select is_empty(
  $q$ select id from public.expense_txn
      where id = '10000000-0000-4000-8000-0000000000e1' $q$,
  'a shared entry of the owner''s is not the contributor''s to read'
);

select is(
  (select count(*)::int from public.holding),
  2,
  'a contributor reads their own two holdings, the shared one and the private one'
);

select is(
  (select count(*)::int from public.valuation_snapshot),
  2,
  'and only their two valuations: the ones for other holdings go with those holdings'
);

select is(
  (select count(*)::int from public.liability
    where id = '11000000-0000-4000-8000-000000000003'),
  1,
  'a contributor reads the loan filed under them'
);

select is(
  (select count(*)::int from public.liability),
  1,
  'and no other: not the household''s, not the owner''s'
);

select is(
  (select count(*)::int from public.insurance_policy),
  1,
  'and one policy, the one filed under them, not the family floater'
);

select is_empty(
  $q$ select id from public.invite $q$,
  'a contributor cannot read invitations, which carry email addresses'
);

select is(
  (select count(*)::int from public.import_batch),
  1,
  'a contributor reads the import they ran, and not the owner''s'
);

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'expense_txn'
        and entity_id = '10000000-0000-4000-8000-0000000000e1' $q$,
  'the audit row for the owner''s entry does not reach the contributor'
);

select isnt_empty(
  $q$ select id from public.audit_log
      where entity = 'expense_txn'
        and entity_id = '10000000-0000-4000-8000-0000000000e3' $q$,
  'the audit row for the contributor''s own entry does — the log is not simply switched off'
);

select isnt_empty(
  $q$ select id from public.expense_category $q$,
  'a contributor reads the categories, or they could not file an expense'
);

select isnt_empty(
  $q$ select id from public.budget $q$,
  'and the household plan, to see how the household is doing against it'
);

select is(
  (select sum(total_minor)::bigint
     from public.household_expense_totals(
            'e0000000-0000-4000-8000-0000000000f1', date '2026-04-01', date '2026-04-30')),
  700000::bigint,
  'the household spending total is the three shared entries, 100000 + 200000 + 400000, and no private one'
);

select is(
  (select sum(total_minor)::bigint
     from public.household_asset_totals('e0000000-0000-4000-8000-0000000000f1')),
  7000000::bigint,
  'the shared holdings total 1000000 + 2000000 + 4000000, and not the private one that is the contributor''s own'
);

select throws_ok(
  $q$ select * from public.personal_holding_totals('e0000000-0000-4000-8000-0000000000f1') $q$,
  '42501'::char(5),
  null::text,
  'another member''s private asset total is not a contributor''s to read'
);

-- ================================================== the viewer: a summary (9)

set local request.jwt.claim.sub to 'c0000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c0000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id::text from public.expense_txn
     union all select id::text from public.holding
     union all select id::text from public.valuation_snapshot $q$,
  'a viewer reads no expense, no holding and no valuation'
);

select is_empty(
  $q$ select id::text from public.liability
     union all select id::text from public.insurance_policy $q$,
  'nor any loan or policy'
);

select is_empty(
  $q$ select id::text from public.invite
     union all select id::text from public.import_batch
     union all select id::text from public.audit_log $q$,
  'nor any invitation, import or audit entry'
);

select is_empty(
  $q$ select id::text from public.expense_category
     union all select id::text from public.budget
     union all select id::text from public.instrument $q$,
  'nor the plan or the catalogue: a viewer reads a summary'
);

select isnt_empty(
  $q$ select id from public.fx_rate $q$,
  'but a viewer still reads the exchange rates, which are part of every figure shown and nobody''s record'
);

select is(
  (select count(*)::int from public.household)
    + (select count(*)::int from public.member where household_id = 'e0000000-0000-4000-8000-0000000000f1'),
  5,
  'but a viewer still reads the household and its four members, so a name can render'
);

select is(
  (select sum(total_minor)::bigint
     from public.household_expense_totals(
            'e0000000-0000-4000-8000-0000000000f1', date '2026-04-01', date '2026-04-30')),
  700000::bigint,
  'the summary gives a viewer the household spending, 700000, without a row of it'
);

select is(
  (select sum(total_minor)::bigint
     from public.household_asset_totals('e0000000-0000-4000-8000-0000000000f1')),
  7000000::bigint,
  'and the shared holdings, 7000000, without a holding'
);

select throws_ok(
  $q$ select * from public.personal_holding_totals('e0000000-0000-4000-8000-0000000000f1') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot read the private asset totals either'
);

-- ================================================ a stranger is refused (2)

set local request.jwt.claim.sub to 'c0000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims   to '{"sub":"c0000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select * from public.household_expense_totals(
        'e0000000-0000-4000-8000-0000000000f1', date '2026-04-01', date '2026-04-30') $q$,
  '42501'::char(5),
  null::text,
  'a member of another household is refused the spending summary, not given an empty result'
);

select throws_ok(
  $q$ select * from public.household_asset_totals('e0000000-0000-4000-8000-0000000000f1') $q$,
  '42501'::char(5),
  null::text,
  'and the asset summary'
);

select * from finish();

rollback;
