-- Family Finance Buddy — policy tests for instruments, holdings and valuations.
--
-- Same discipline as the expense suite: prove the denial, then prove the
-- positive case in the same breath, so the file cannot pass against a database
-- that returns nothing to anybody.
--
-- What is being protected here is worth naming. A valuation row says what one
-- family holds in a foreign asset and what it was worth on a date — the exact
-- figures a tax disclosure is built from. If any table in this project must not
-- leak between households, it is this one.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(14);

-- ============================================================== the fixture
--
-- Two households, each holding a foreign asset.

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'anita@inv-a.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555',
   'authenticated', 'authenticated', 'bhavin@inv-b.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666',
   'authenticated', 'authenticated', 'viewer@inv-b.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'dddddddd-0000-4000-8000-0000000000a1'
  where auth_user_id = '44444444-4444-4444-8444-444444444444';
update public.user_account set id = 'dddddddd-0000-4000-8000-0000000000b1'
  where auth_user_id = '55555555-5555-4555-8555-555555555555';
update public.user_account set id = 'dddddddd-0000-4000-8000-0000000000b2'
  where auth_user_id = '66666666-6666-4666-8666-666666666666';

insert into public.household (id, name, kind) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Investors A', 'demo'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Investors B', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('a11a0000-0000-4000-8000-000000000101', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Anita',  'c1'),
  ('b11b0000-0000-4000-8000-000000000101', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Bhavin', 'c2'),
  ('b22b0000-0000-4000-8000-000000000102', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Bela',   'c3');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('dddddddd-0000-4000-8000-0000000000a1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'a11a0000-0000-4000-8000-000000000101', 'owner'),
  ('dddddddd-0000-4000-8000-0000000000b1', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
   'b11b0000-0000-4000-8000-000000000101', 'owner'),
  ('dddddddd-0000-4000-8000-0000000000b2', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
   'b22b0000-0000-4000-8000-000000000102', 'viewer');

-- A direct US ETF in each household: priced in dollars, exposed to dollars,
-- and disclosable. The case the isolation matters most for.
insert into public.instrument
  (id, household_id, name, kind, symbol, currency, exposure_currency, is_foreign_asset) values
  ('a0000000-0000-4000-8000-00000000a0f1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'US index ETF', 'etf', 'VOO', 'USD', 'USD', true),
  ('b0000000-0000-4000-8000-00000000b0f1', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
   'World index ETF', 'etf', 'VT', 'USD', 'USD', true);

-- Fractional quantities on purpose: US brokers sell part shares, and a schema
-- that quietly rounded them would be wrong from the first row.
insert into public.holding (id, household_id, member_id, instrument_id, quantity, cost_minor) values
  ('a0000000-0000-4000-8000-00000000a0d1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'a11a0000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-00000000a0f1', 12.5000000, 620000),
  ('b0000000-0000-4000-8000-00000000b0d1', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
   'b11b0000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-00000000b0f1', 40.0000000, 410000);

insert into public.valuation_snapshot
  (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'a0000000-0000-4000-8000-00000000a0d1',
   date '2026-08-31', 12.5000000, 715000, 'USD', 'manual', 'dddddddd-0000-4000-8000-0000000000a1'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'b0000000-0000-4000-8000-00000000b0d1',
   date '2026-08-31', 40.0000000, 480000, 'USD', 'manual', 'dddddddd-0000-4000-8000-0000000000b1'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'b0000000-0000-4000-8000-00000000b0d1',
   date '2026-07-31', 40.0000000, 452500, 'USD', 'manual', 'dddddddd-0000-4000-8000-0000000000b1');

-- ================================================== structural guards (2)

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'every table in public still has row-level security enabled'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and cmd = 'DELETE'),
  0,
  'still no delete policy anywhere — deletes remain soft'
);

-- ======================= household B cannot read household A's holdings (5)

set local role authenticated;
set local request.jwt.claim.sub to '55555555-5555-4555-8555-555555555555';
set local request.jwt.claims   to '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.instrument
      where household_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' $q$,
  'a member of household B cannot see household A instruments'
);

select is_empty(
  $q$ select id from public.holding
      where household_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' $q$,
  'a member of household B cannot see what household A owns'
);

select is_empty(
  $q$ select id from public.valuation_snapshot
      where household_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' $q$,
  'a member of household B cannot read household A valuations — a disclosable position stays private'
);

-- The positive case in the same breath, so none of the above passes vacuously.

select is(
  (select count(*)::int from public.holding),
  1,
  'household B does see its own holding'
);

select is(
  (select count(*)::int from public.valuation_snapshot),
  2,
  'and both of its own snapshots — the isolation is not a blackout'
);

-- ============================================ writes are denied too (4)

select throws_ok(
  $q$ insert into public.holding (household_id, member_id, instrument_id, quantity)
      values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              'a11a0000-0000-4000-8000-000000000101',
              'a0000000-0000-4000-8000-00000000a0f1', 1) $q$,
  '42501'::char(5),
  null::text,
  'a member of household B cannot write a holding into household A'
);

select throws_ok(
  $q$ insert into public.valuation_snapshot
        (household_id, holding_id, as_of_date, quantity, value_minor, currency)
      values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              'a0000000-0000-4000-8000-00000000a0d1',
              date '2026-09-30', 1, 100, 'USD') $q$,
  '42501'::char(5),
  null::text,
  'nor a valuation against household A'
);

select throws_ok(
  $q$ insert into public.valuation_snapshot
        (household_id, holding_id, as_of_date, quantity, value_minor, currency, created_by)
      values ('ffffffff-ffff-4fff-8fff-ffffffffffff',
              'b0000000-0000-4000-8000-00000000b0d1',
              date '2026-09-30', 40, 500000, 'USD',
              'dddddddd-0000-4000-8000-0000000000a1') $q$,
  '42501'::char(5),
  null::text,
  'attribution cannot be forged: created_by must be the caller'
);

-- A viewer of household B reads its holdings and records nothing.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '66666666-6666-4666-8666-666666666666';
set local request.jwt.claims   to '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.valuation_snapshot
        (household_id, holding_id, as_of_date, quantity, value_minor, currency)
      values ('ffffffff-ffff-4fff-8fff-ffffffffffff',
              'b0000000-0000-4000-8000-00000000b0d1',
              date '2026-09-30', 40, 500000, 'USD') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot record a valuation, even in their own household'
);

-- ============================ a password alone is not enough (2)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '55555555-5555-4555-8555-555555555555';
set local request.jwt.claims   to '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select id from public.holding $q$,
  'a session holding only a password reads zero holdings'
);

select is_empty(
  $q$ select id from public.valuation_snapshot $q$,
  'and zero valuations — the second factor is enforced on these tables too'
);

-- ================================================ signed out sees nothing (1)

reset role;
set local role anon;

select throws_ok(
  $q$ select id from public.holding $q$,
  '42501'::char(5),
  null::text,
  'a signed-out visitor is refused at the privilege layer, before policies are consulted'
);

select * from finish();

rollback;
