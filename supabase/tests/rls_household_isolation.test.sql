-- Family Finance Buddy — policy tests.
--
-- The central assertion, and the reason this file gates the deploy: a person
-- authenticated as a member of household B reads zero rows of household A.
-- Around it sit the guards that stop the suite passing vacuously — B really
-- does see its own rows — and the structural checks that catch the next table
-- somebody adds without policies.
--
-- Everything under test runs as the API roles `authenticated` and `anon`,
-- never as the table owner, because the owner bypasses row-level security and
-- would prove nothing.
--
-- Run: supabase test db      (needs a local stack: supabase start)

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(18);

-- ============================================================== the fixture
--
-- Two unrelated households. Fixed UUIDs throughout, so the JWT claims and the
-- assertions below can be literals. Inserted as the owner, deliberately:
-- setting the stage is not the thing under test.

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'anita@household-a.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'bhavin@household-b.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'viewer@household-b.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

-- The user_account rows were just created by the on_auth_user_created trigger,
-- which is itself worth exercising. Give them predictable ids.
update public.user_account set id = 'cccccccc-0000-4000-8000-0000000000a1'
  where auth_user_id = '11111111-1111-4111-8111-111111111111';
update public.user_account set id = 'cccccccc-0000-4000-8000-0000000000b1'
  where auth_user_id = '22222222-2222-4222-8222-222222222222';
update public.user_account set id = 'cccccccc-0000-4000-8000-0000000000b2'
  where auth_user_id = '33333333-3333-4333-8333-333333333333';

insert into public.household (id, name, kind) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Household A', 'demo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Household B', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('a11a0000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Anita',  'c1'),
  ('b11b0000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bhavin', 'c2'),
  ('b22b0000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bela',   'c3');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('cccccccc-0000-4000-8000-0000000000a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a11a0000-0000-4000-8000-000000000001', 'owner'),
  ('cccccccc-0000-4000-8000-0000000000b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'b11b0000-0000-4000-8000-000000000001', 'owner'),
  ('cccccccc-0000-4000-8000-0000000000b2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'b22b0000-0000-4000-8000-000000000002', 'viewer');

insert into public.expense_txn
  (id, household_id, member_id, txn_date, amount_minor, currency, payee, created_by) values
  ('a0000000-0000-4000-8000-00000000e001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a11a0000-0000-4000-8000-000000000001', date '2026-04-02', 249900, 'INR',
   'A private grocery bill', 'cccccccc-0000-4000-8000-0000000000a1'),
  ('b0000000-0000-4000-8000-00000000e001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'b11b0000-0000-4000-8000-000000000001', date '2026-04-03', 120000, 'INR',
   'B electricity', 'cccccccc-0000-4000-8000-0000000000b1'),
  ('b0000000-0000-4000-8000-00000000e002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'b22b0000-0000-4000-8000-000000000002', date '2026-04-04', 45050, 'INR',
   'B pharmacy', 'cccccccc-0000-4000-8000-0000000000b1');

-- ==================================================== structural guards (4)
--
-- These fail the day somebody adds a table and forgets, which is the failure
-- mode the whole layer exists to prevent.

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'every table in public has row-level security enabled'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and cmd = 'DELETE'),
  0,
  'no delete policy exists anywhere — deletes are soft'
);

select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'),
  0,
  'the anon role holds no privilege on any table in public'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and roles::text[] && array['public', 'anon']),
  0,
  'no policy is written for public or anon — there is no permissive fallback'
);

-- ============================== household B cannot read household A (5 + 2)

set local role authenticated;
set local request.jwt.claim.sub to '22222222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.expense_txn
      where household_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $q$,
  'a member of household B reads zero expense rows from household A'
);

select is_empty(
  $q$ select id from public.household
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $q$,
  'a member of household B cannot see household A itself'
);

select is_empty(
  $q$ select id from public.member
      where household_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $q$,
  'a member of household B cannot see who is in household A'
);

select is_empty(
  $q$ select id from public.membership
      where household_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $q$,
  'a member of household B cannot see household A memberships'
);

select is_empty(
  $q$ select id from public.user_account
      where auth_user_id = '11111111-1111-4111-8111-111111111111' $q$,
  'one identity cannot read another identity row'
);

-- The suite would pass against a database that returns nothing to anybody, so
-- prove the positive case in the same breath.

select is(
  (select count(*)::int from public.expense_txn),
  2,
  'and household B does see its own two expenses — the isolation is not a blackout'
);

select is(
  (select count(*)::int from public.household),
  1,
  'household B sees exactly one household: its own'
);

-- ================================================== writes are denied too (4)

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'a11a0000-0000-4000-8000-000000000001',
              date '2026-04-05', 100000, 'INR') $q$,
  '42501'::char(5),
  null::text,
  'a member of household B cannot write a row into household A'
);

select throws_ok(
  $q$ insert into public.expense_txn
        (household_id, member_id, txn_date, amount_minor, currency, created_by)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              'b11b0000-0000-4000-8000-000000000001',
              date '2026-04-05', 100000, 'INR',
              'cccccccc-0000-4000-8000-0000000000a1') $q$,
  '42501'::char(5),
  null::text,
  'attribution cannot be forged: created_by must be the caller'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims   to '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              'b22b0000-0000-4000-8000-000000000002',
              date '2026-04-05', 100000, 'INR') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot insert an expense, even in their own household'
);

-- An update the policy rejects is not an error; it simply matches no row.

with attempted as (
  update public.expense_txn
     set note = 'a viewer edited this'
   where id = 'b0000000-0000-4000-8000-00000000e001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a viewer cannot update an expense: the row is out of reach, so nothing changes'
);

-- ============================ a password alone is not enough (2)
--
-- Same person, same household, same policies — but this session never
-- presented an authenticator code, so the restrictive policy holds it out.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '22222222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select id from public.expense_txn $q$,
  'a session holding only a password reads zero expenses, even in its own household'
);

select is_empty(
  $q$ select id from public.household $q$,
  'and cannot see the household either — the second factor is enforced by the database'
);

-- ================================================ signed out sees nothing (1)

reset role;
set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claims   to '';

select throws_ok(
  $q$ select id from public.expense_txn $q$,
  '42501'::char(5),
  null::text,
  'a signed-out visitor is refused at the privilege layer, before policies are consulted'
);

reset role;

select * from finish();

rollback;
