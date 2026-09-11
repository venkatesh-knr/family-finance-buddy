-- Family Finance Buddy — resetting the demo household.
--
-- The one hard delete in the schema. Two halves need proving and the first
-- matters more: who CANNOT reset, and what a reset CANNOT reach. Then that it
-- does what it says — the old rows gone, the seed back, the people who sign in
-- still there, and the audit trail untouched.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(21);

-- ─────────────────────────────────────────────────────────────── fixtures
--
-- Demo household D1: owner A, partner P, viewer V, and a member nobody signs
-- in as. Real household R1, also owned by A. Demo household D2, owned by O,
-- who is not in D1 at all.

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'a1a11111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'owner@reset.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'b2b22222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'partner@reset.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c3c33333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'viewer@reset.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'd4d44444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'other@reset.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'ac000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'a1a11111-1111-4111-8111-111111111111';
update public.user_account set id = 'ac000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'b2b22222-2222-4222-8222-222222222222';
update public.user_account set id = 'ac000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c3c33333-3333-4333-8333-333333333333';
update public.user_account set id = 'ac000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'd4d44444-4444-4444-8444-444444444444';

insert into public.household (id, name, kind, fire_multiplier) values
  ('d1000000-0000-4000-8000-0000000000d1', 'Sandbox',       'demo', 40),
  ('e1000000-0000-4000-8000-0000000000e1', 'The real one',  'real', 25),
  ('d2000000-0000-4000-8000-0000000000d2', 'Other sandbox', 'demo', 25);

insert into public.member (id, household_id, display_name, colour) values
  ('aa000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-0000000000d1', 'Owner',   'c1'),
  ('aa000000-0000-4000-8000-0000000000a2', 'd1000000-0000-4000-8000-0000000000d1', 'Partner', 'c2'),
  ('aa000000-0000-4000-8000-0000000000a3', 'd1000000-0000-4000-8000-0000000000d1', 'Viewer',  'c3'),
  -- Nobody signs in as this one. A reset removes it.
  ('aa000000-0000-4000-8000-0000000000a9', 'd1000000-0000-4000-8000-0000000000d1', 'Stray',   'c4'),
  ('bb000000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-0000000000e1', 'Owner',   'c1'),
  ('cc000000-0000-4000-8000-0000000000c1', 'd2000000-0000-4000-8000-0000000000d2', 'Other',   'c1');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('ac000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a1', 'owner'),
  ('ac000000-0000-4000-8000-0000000000a2', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a2', 'partner'),
  ('ac000000-0000-4000-8000-0000000000a3', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a3', 'viewer'),
  ('ac000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000e1',
   'bb000000-0000-4000-8000-0000000000b1', 'owner'),
  ('ac000000-0000-4000-8000-0000000000a4', 'd2000000-0000-4000-8000-0000000000d2',
   'cc000000-0000-4000-8000-0000000000c1', 'owner');

-- The leftovers of an experiment in D1, touching every kind of table the reset
-- has to clear — including the three that have no delete grant at all.
insert into public.expense_txn
  (id, household_id, member_id, txn_date, amount_minor, currency, payee, method, visibility, created_by)
values
  ('ee000000-0000-4000-8000-0000000000e1', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a9', date '2026-08-01', 12000, 'INR', 'Typed in to try it',
   'upi', 'household', 'ac000000-0000-4000-8000-0000000000a1'),
  ('ee000000-0000-4000-8000-0000000000e2', 'e1000000-0000-4000-8000-0000000000e1',
   'bb000000-0000-4000-8000-0000000000b1', date '2026-08-01', 55000, 'INR', 'A real expense',
   'upi', 'household', 'ac000000-0000-4000-8000-0000000000a1'),
  ('ee000000-0000-4000-8000-0000000000e3', 'd2000000-0000-4000-8000-0000000000d2',
   'cc000000-0000-4000-8000-0000000000c1', date '2026-08-01', 7000, 'INR', 'Someone else''s sandbox',
   'upi', 'household', 'ac000000-0000-4000-8000-0000000000a4');

insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('f1000000-0000-4000-8000-0000000000f1', 'd1000000-0000-4000-8000-0000000000d1',
   'Test bond', 'bond', 'INR', 'INR');

insert into public.holding (id, household_id, member_id, instrument_id, quantity) values
  ('b0000000-0000-4000-8000-0000000000b1', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-0000000000f1', 100);

insert into public.lot (id, household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by) values
  ('10000000-0000-4000-8000-000000000101', 'd1000000-0000-4000-8000-0000000000d1',
   'b0000000-0000-4000-8000-0000000000b1', date '2024-07-01', 100, 10000000, 'INR',
   'ac000000-0000-4000-8000-0000000000a1');

insert into public.disposal (id, household_id, holding_id, disposed_on, quantity, proceeds_minor, currency, created_by) values
  ('20000000-0000-4000-8000-000000000201', 'd1000000-0000-4000-8000-0000000000d1',
   'b0000000-0000-4000-8000-0000000000b1', date '2026-07-01', 10, 1100000, 'INR',
   'ac000000-0000-4000-8000-0000000000a1');

insert into public.valuation_snapshot
  (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by) values
  ('d1000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000b1',
   date '2026-07-31', 90, 9500000, 'INR', 'manual', 'ac000000-0000-4000-8000-0000000000a1');

insert into public.fx_rate (household_id, base_currency, quote_currency, rate, as_of_date, created_by) values
  ('d1000000-0000-4000-8000-0000000000d1', 'USD', 'INR', 88.5, date '2026-08-01',
   'ac000000-0000-4000-8000-0000000000a1');

-- ═══════════════════════════════════════════════ who cannot reset (7)

set local role anon;

select throws_ok(
  $q$ select public.reset_demo_household('d1000000-0000-4000-8000-0000000000d1') $q$,
  '42501'::char(5),
  null::text,
  'the publishable key alone cannot reach it'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'a1a11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"a1a11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}';

-- Definer rights step past the restrictive second-factor policy, so the
-- function has to ask for itself. This is the assertion that proves it does.
select throws_ok(
  $q$ select public.reset_demo_household('d1000000-0000-4000-8000-0000000000d1') $q$,
  '42501'::char(5),
  null::text,
  'the owner with a password but no authenticator code cannot reset'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c3c33333-3333-4333-8333-333333333333';
set local request.jwt.claims   to '{"sub":"c3c33333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.reset_demo_household('d1000000-0000-4000-8000-0000000000d1') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot reset'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'b2b22222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"b2b22222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.reset_demo_household('d1000000-0000-4000-8000-0000000000d1') $q$,
  '42501'::char(5),
  null::text,
  'a partner cannot reset — the one destructive setting is the owner''s alone'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'd4d44444-4444-4444-8444-444444444444';
set local request.jwt.claims   to '{"sub":"d4d44444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.reset_demo_household('d1000000-0000-4000-8000-0000000000d1') $q$,
  '42501'::char(5),
  null::text,
  'the owner of a different demo household cannot reset this one'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'a1a11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"a1a11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

-- The refusal the whole exception rests on.
select throws_ok(
  $q$ select public.reset_demo_household('e1000000-0000-4000-8000-0000000000e1') $q$,
  '22023'::char(5),
  null::text,
  'an owner cannot reset a household marked real'
);

select throws_ok(
  $q$ select app.seed_demo_household('d1000000-0000-4000-8000-0000000000d1',
                                     'ac000000-0000-4000-8000-0000000000a1') $q$,
  '42501'::char(5),
  null::text,
  'a client cannot call the seed directly'
);

-- ═══════════════════════════════════════════════════ the reset itself (1)

select lives_ok(
  $q$ select public.reset_demo_household('d1000000-0000-4000-8000-0000000000d1') $q$,
  'the owner, with a second factor, resets the demo household'
);

reset role;

-- ═════════════════════════════════════════════════════════ what went (2)

select is_empty(
  $q$ select 1 from public.expense_txn where id = 'ee000000-0000-4000-8000-0000000000e1'
      union all
      select 1 from public.lot where id = '10000000-0000-4000-8000-000000000101'
      union all
      select 1 from public.disposal where id = '20000000-0000-4000-8000-000000000201'
      union all
      select 1 from public.instrument where id = 'f1000000-0000-4000-8000-0000000000f1'
      union all
      select 1 from public.fx_rate where household_id = 'd1000000-0000-4000-8000-0000000000d1' $q$,
  'the experiment is gone — expense, lot, disposal, instrument and rate'
);

select is_empty(
  $q$ select 1 from public.member where id = 'aa000000-0000-4000-8000-0000000000a9' $q$,
  'a member nobody signs in as is removed'
);

-- ═══════════════════════════════════════════════════ what came back (3)

select isnt_empty(
  $q$ select 1 from public.expense_category
       where household_id = 'd1000000-0000-4000-8000-0000000000d1'
         and name = 'Piano lessons (never used)' $q$,
  'the seed is back'
);

select isnt_empty(
  $q$ select 1 from public.member
       where household_id = 'd1000000-0000-4000-8000-0000000000d1' and display_name = 'Meera' $q$,
  'with its member who has no login'
);

select is(
  (select fire_multiplier from public.household where id = 'd1000000-0000-4000-8000-0000000000d1'),
  25::numeric,
  'and the FIRE inputs are back at their defaults'
);

-- ═══════════════════════════════════════════════════════ what stayed (5)

select is(
  (select count(*)::int from public.membership
    where household_id = 'd1000000-0000-4000-8000-0000000000d1' and revoked_at is null),
  3,
  'every membership survives — the reset locks nobody out'
);

select isnt_empty(
  $q$ select 1 from public.member where id = 'aa000000-0000-4000-8000-0000000000a2' $q$,
  'and so do the members they sign in as'
);

select isnt_empty(
  $q$ select 1 from public.expense_txn where id = 'ee000000-0000-4000-8000-0000000000e2' $q$,
  'the owner''s real household is untouched'
);

select isnt_empty(
  $q$ select 1 from public.expense_txn where id = 'ee000000-0000-4000-8000-0000000000e3' $q$,
  'another demo household is untouched'
);

select isnt_empty(
  $q$ select 1 from public.audit_log
       where entity = 'expense_txn'
         and entity_id = 'ee000000-0000-4000-8000-0000000000e1'
         and action = 'insert' $q$,
  'the audit log keeps what was there before'
);

-- ═══════════════════════════════════════════════════ how it is recorded (1)

select isnt_empty(
  $q$ select 1 from public.audit_log
       where entity = 'expense_txn'
         and entity_id = 'ee000000-0000-4000-8000-0000000000e1'
         and action = 'delete'
         and actor = 'a1a11111-1111-4111-8111-111111111111' $q$,
  'and records its removal against the person who reset'
);

-- ═════════════════════════════════════════════════════ a known state (1)

create temp table first_reset as
  select (select count(*) from public.expense_txn where household_id = 'd1000000-0000-4000-8000-0000000000d1') as txns,
         (select count(*) from public.holding     where household_id = 'd1000000-0000-4000-8000-0000000000d1') as holdings,
         (select count(*) from public.member      where household_id = 'd1000000-0000-4000-8000-0000000000d1') as members;

set local role authenticated;
set local request.jwt.claim.sub to 'a1a11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"a1a11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

select public.reset_demo_household('d1000000-0000-4000-8000-0000000000d1');

reset role;

select results_eq(
  $q$ select (select count(*) from public.expense_txn where household_id = 'd1000000-0000-4000-8000-0000000000d1'),
             (select count(*) from public.holding     where household_id = 'd1000000-0000-4000-8000-0000000000d1'),
             (select count(*) from public.member      where household_id = 'd1000000-0000-4000-8000-0000000000d1') $q$,
  $q$ select txns, holdings, members from first_reset $q$,
  'resetting twice lands in the same state as resetting once'
);

-- ═════════════════════════════════════════════ the guard on the next table (1)
--
-- A household table the reset has never heard of. The reset must refuse and
-- roll back rather than leave its rows behind and call the result known.

create table public.reset_guard_probe (household_id uuid not null);
insert into public.reset_guard_probe values ('d1000000-0000-4000-8000-0000000000d1');

set local role authenticated;
set local request.jwt.claim.sub to 'a1a11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"a1a11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

select throws_like(
  $q$ select public.reset_demo_household('d1000000-0000-4000-8000-0000000000d1') $q$,
  '%reset_guard_probe%',
  'a household table the reset does not know about stops it, by name'
);

reset role;

select * from finish();

rollback;
