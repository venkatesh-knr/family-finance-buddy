-- Family Finance Buddy — private entries, and the log that must not leak them.
--
-- Section 20 makes a promise in plain words: "Any member can mark a
-- transaction, an account, an income entry or a document as personal. It
-- counts in their own figures and in household aggregates; the line-item
-- detail is returned to nobody else, the owner included."
--
-- "The owner included" is the whole difficulty, and it is what most of this
-- file is about. An owner administers the household and can do everything
-- else; this is the one place the highest privilege in the system stops. A
-- privacy feature the administrator can see through is a privacy feature in
-- name only, and the household would be right not to believe it.
--
-- Three surfaces have to hold the same line or the promise is worthless:
--
--   the table       — the row itself
--   the audit log   — which carries `before` and `after` in full, and would
--                     otherwise hand over the very figure the table withheld
--   the aggregate   — which must still be right, or members see different
--                     totals and the cure is worse than the disease
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(24);

-- ============================================================== the fixture
--
-- One household, an owner and a partner, each with something private. A second
-- household with one member, to prove the aggregate function refuses a
-- stranger rather than trusting the id it was handed.

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555',
   'authenticated', 'authenticated', 'owner@private.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666',
   'authenticated', 'authenticated', 'partner@private.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-4777-8777-777777777777',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'dddddddd-0000-4000-8000-0000000000a1'
  where auth_user_id = '55555555-5555-4555-8555-555555555555';
update public.user_account set id = 'dddddddd-0000-4000-8000-0000000000a2'
  where auth_user_id = '66666666-6666-4666-8666-666666666666';
update public.user_account set id = 'dddddddd-0000-4000-8000-0000000000b1'
  where auth_user_id = '77777777-7777-4777-8777-777777777777';

insert into public.household (id, name, kind) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Household P', 'demo'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Household Q', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('e11e0000-0000-4000-8000-000000000001', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Owner',    'c1'),
  ('e22e0000-0000-4000-8000-000000000002', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Partner',  'c2'),
  ('f11f0000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Stranger', 'c3');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('dddddddd-0000-4000-8000-0000000000a1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'e11e0000-0000-4000-8000-000000000001', 'owner'),
  ('dddddddd-0000-4000-8000-0000000000a2', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'e22e0000-0000-4000-8000-000000000002', 'partner'),
  ('dddddddd-0000-4000-8000-0000000000b1', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
   'f11f0000-0000-4000-8000-000000000001', 'owner');

-- Four expenses, all in April 2026. Distinct amounts, so an assertion on a sum
-- can only pass for one combination of rows — a coincidence cannot hide a fault.
insert into public.expense_txn
  (id, household_id, member_id, txn_date, amount_minor, currency, payee, visibility, created_by) values
  -- shared, one from each of them
  ('e0000000-0000-4000-8000-00000000e001', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'e11e0000-0000-4000-8000-000000000001', date '2026-04-02', 100000, 'INR',
   'Electricity', 'household', 'dddddddd-0000-4000-8000-0000000000a1'),
  ('e0000000-0000-4000-8000-00000000e002', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'e22e0000-0000-4000-8000-000000000002', date '2026-04-03', 200000, 'INR',
   'Grocery', 'household', 'dddddddd-0000-4000-8000-0000000000a2'),
  -- the owner's own private entry
  ('e0000000-0000-4000-8000-00000000e003', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'e11e0000-0000-4000-8000-000000000001', date '2026-04-04', 330000, 'INR',
   'A gift, not yet given', 'personal', 'dddddddd-0000-4000-8000-0000000000a1'),
  -- the partner's, which the owner must never see
  ('e0000000-0000-4000-8000-00000000e004', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'e22e0000-0000-4000-8000-000000000002', date '2026-04-05', 770000, 'INR',
   'Therapy', 'personal', 'dddddddd-0000-4000-8000-0000000000a2');

-- A personal holding, and a snapshot of it. The snapshot has no visibility
-- column of its own: it is private because its holding is, and the assertions
-- below are the only thing standing between that design and a leak.
insert into public.instrument
  (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset) values
  ('e33e0000-0000-4000-8000-000000000003', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'Vanguard Total Stock Market ETF', 'etf', 'USD', 'USD', true);

insert into public.holding
  (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('e44e0000-0000-4000-8000-000000000004', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'e22e0000-0000-4000-8000-000000000002', 'e33e0000-0000-4000-8000-000000000003',
   12.5, 'personal');

insert into public.valuation_snapshot
  (id, household_id, holding_id, as_of_date, quantity, value_minor, currency, created_by) values
  ('e55e0000-0000-4000-8000-000000000005', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'e44e0000-0000-4000-8000-000000000004', date '2026-04-30', 12.5, 4210000, 'USD',
   'dddddddd-0000-4000-8000-0000000000a2');

-- ==================================== the table: the owner is not exempt (6)

set local role authenticated;
set local request.jwt.claim.sub to '55555555-5555-4555-8555-555555555555';
set local request.jwt.claims   to '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.expense_txn
      where id = 'e0000000-0000-4000-8000-00000000e004' $q$,
  'the household owner cannot read a partner private expense'
);

select is(
  (select count(*)::int from public.expense_txn),
  3,
  'the owner reads the two shared entries and their own private one, and no fourth'
);

select is(
  (select count(*)::int from public.expense_txn where visibility = 'personal'),
  1,
  'the only private row an owner sees is their own'
);

select is_empty(
  $q$ select id from public.holding
      where id = 'e44e0000-0000-4000-8000-000000000004' $q$,
  'a personal holding is invisible to the owner too — the rule is not only about expenses'
);

select is_empty(
  $q$ select id from public.valuation_snapshot $q$,
  'and so is its valuation: privacy the snapshot inherits rather than states'
);

-- Worth pinning separately, because the snapshot is where the money actually
-- is. If it were visible, hiding the holding would have achieved nothing.
select is_empty(
  $q$ select value_minor from public.valuation_snapshot
      where holding_id = 'e44e0000-0000-4000-8000-000000000004' $q$,
  'the value of a personal holding does not reach the owner by the snapshot route'
);

-- ========================== the audit log: the same line, or none at all (5)

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'expense_txn'
        and entity_id = 'e0000000-0000-4000-8000-00000000e004' $q$,
  'no audit row for a partner private expense reaches the owner'
);

-- Said again against the payload rather than the row, because this is the
-- assertion that would have caught the log being built as a side channel: the
-- amount and the payee both sit inside `after` in full.
select is_empty(
  $q$ select after ->> 'payee' from public.audit_log
      where entity = 'expense_txn'
        and after ->> 'visibility' = 'personal'
        and (after ->> 'member_id')::uuid = 'e22e0000-0000-4000-8000-000000000002' $q$,
  'nor does the payee inside it — "Therapy" is exactly the detail §20 is about'
);

select isnt_empty(
  $q$ select id from public.audit_log
      where entity = 'expense_txn'
        and entity_id = 'e0000000-0000-4000-8000-00000000e002' $q$,
  'a shared expense is audited and readable — the log is not simply switched off'
);

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'valuation_snapshot' $q$,
  'the audit row for a snapshot of a personal holding is out of reach as well'
);

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'holding'
        and entity_id = 'e44e0000-0000-4000-8000-000000000004' $q$,
  'as is the audit row for the personal holding itself'
);

-- ============================================ append-only is a privilege (3)

select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'audit_log'
     and grantee in ('authenticated', 'anon')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0,
  'no client role holds insert, update, delete or truncate on the audit log'
);

select throws_ok(
  $q$ update public.audit_log set after = '{}'::jsonb where id > 0 $q$,
  '42501'::char(5),
  null::text,
  'the log cannot be rewritten to hide what it recorded'
);

select throws_ok(
  $q$ delete from public.audit_log where id > 0 $q$,
  '42501'::char(5),
  null::text,
  'and it cannot be cleared'
);

-- ========================= the aggregate: right for everyone, or useless (5)
--
-- "Household totals must include private amounts or the numbers disagree
-- between members, which is worse than the problem being solved." (§20)

select is(
  (select total_minor from public.personal_expense_totals(
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', date '2026-04-01', date '2026-04-30')),
  770000::bigint,
  'the owner is told the SUM of the partner private spending, though not one row of it'
);

select is(
  (select member_id from public.personal_expense_totals(
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', date '2026-04-01', date '2026-04-30')),
  'e22e0000-0000-4000-8000-000000000002'::uuid,
  'attributed to a member, so it shows as one Personal line rather than an unexplained gap'
);

select is(
  (select count(*)::int from public.personal_expense_totals(
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', date '2026-04-01', date '2026-04-30')),
  1,
  'and the caller own private entry is not in it — they read that row already, and would count it twice'
);

-- One line per member is the whole defence. A category breakdown would let a
-- member with a single private entry in a category have the amount recovered
-- by subtraction, and the row might as well have been public.
select is(
  (select count(*)::int
   from information_schema.parameters
   where specific_schema = 'public'
     and specific_name like 'personal_expense_totals%'
     and parameter_mode = 'OUT'
     and parameter_name = 'category_id'),
  0,
  'the function returns no category: a per-category total is the subtraction attack, spelled differently'
);

select is(
  (select entry_count from public.my_private_entry_count(
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') where entity = 'expense_txn'),
  1::bigint,
  'a member can be shown how many of their own entries are private — a control nobody can observe is no control'
);

-- ====================================== it is mutual, not owner-shaped (2)
--
-- The partner holds no administrative standing at all, and the same rule
-- protects them from the owner and the owner from them. A privacy feature that
-- only ran downhill would be a different feature.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '66666666-6666-4666-8666-666666666666';
set local request.jwt.claims   to '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.expense_txn
      where id = 'e0000000-0000-4000-8000-00000000e003' $q$,
  'and the partner cannot read the owner private expense either'
);

select is(
  (select total_minor from public.personal_expense_totals(
     'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', date '2026-04-01', date '2026-04-30')),
  330000::bigint,
  'each is told the other total, and neither is told the detail'
);

-- ============================== a definer function checks its own caller (2)
--
-- These functions read past every policy by design. That makes the membership
-- test inside them the only thing standing between a household id and its
-- contents, so it is tested as carefully as a policy.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local request.jwt.claims   to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select * from public.personal_expense_totals(
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', date '2026-04-01', date '2026-04-30') $q$,
  '42501'::char(5),
  null::text,
  'a stranger handed a real household id is refused: membership is checked, not the argument trusted'
);

select is_empty(
  $q$ select entry_count from public.my_private_entry_count(
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') where entry_count > 0 $q$,
  'and learns nothing from the count function either'
);

-- ================================================= signed out sees none (1)

reset role;
set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claims   to '';

select throws_ok(
  $q$ select id from public.audit_log $q$,
  '42501'::char(5),
  null::text,
  'a signed-out visitor is refused the audit log at the privilege layer'
);

reset role;

select * from finish();

rollback;
