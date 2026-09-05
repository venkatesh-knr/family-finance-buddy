-- Family Finance Buddy — policy and function tests for invites.
--
-- An invite is the only thing in this system that turns a stranger into a
-- household member, so the tests are mostly about refusal: a non-owner cannot
-- issue one, a used code cannot be used again, an expired one is dead, and a
-- code for household A does nothing for anyone poking at household B.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(19);

-- ============================================================== the fixture

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-4777-8777-777777777777',
   'authenticated', 'authenticated', 'owner@inv.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '88888888-8888-4888-8888-888888888888',
   'authenticated', 'authenticated', 'viewer@inv.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-4999-8999-999999999999',
   'authenticated', 'authenticated', 'newcomer@inv.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'aaaaaaaa-1111-4111-8111-000000000001'
  where auth_user_id = '77777777-7777-4777-8777-777777777777';
update public.user_account set id = 'aaaaaaaa-1111-4111-8111-000000000002'
  where auth_user_id = '88888888-8888-4888-8888-888888888888';
update public.user_account set id = 'aaaaaaaa-1111-4111-8111-000000000003'
  where auth_user_id = '99999999-9999-4999-8999-999999999999';

insert into public.household (id, name, kind) values
  ('cccccccc-1111-4111-8111-000000000001', 'Invite household', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('dddddddd-1111-4111-8111-000000000001', 'cccccccc-1111-4111-8111-000000000001', 'Owner',  'c1'),
  ('dddddddd-1111-4111-8111-000000000002', 'cccccccc-1111-4111-8111-000000000001', 'Viewer', 'c2');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('aaaaaaaa-1111-4111-8111-000000000001', 'cccccccc-1111-4111-8111-000000000001',
   'dddddddd-1111-4111-8111-000000000001', 'owner'),
  ('aaaaaaaa-1111-4111-8111-000000000002', 'cccccccc-1111-4111-8111-000000000001',
   'dddddddd-1111-4111-8111-000000000002', 'viewer');

-- ================================================== structural guards (3)

select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'invite'
     and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'no client may write the invite table directly — the functions do the writing'
);

select is(
  (select count(*)::int
   from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'invite'
     and column_name = 'code_hash' and grantee = 'authenticated'),
  0,
  'code_hash is not readable by any client'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'invite' and cmd <> 'ALL' and cmd <> 'SELECT'),
  0,
  'the invite table has no write policy at all'
);

-- ======================================= only an owner may issue one (2)

set local role authenticated;
set local request.jwt.claim.sub to '88888888-8888-4888-8888-888888888888';
set local request.jwt.claims   to '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.create_invite(
        'cccccccc-1111-4111-8111-000000000001', 'Sneaky', 'owner') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot issue an invite'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '99999999-9999-4999-8999-999999999999';
set local request.jwt.claims   to '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.create_invite(
        'cccccccc-1111-4111-8111-000000000001', 'Sneaky', 'owner') $q$,
  '42501'::char(5),
  null::text,
  'someone outside the household cannot issue an invite into it'
);

-- ==================================================== the owner can (4)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local request.jwt.claims   to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated","aal":"aal2"}';

create temporary table issued (code text);
insert into issued
select public.create_invite(
  'cccccccc-1111-4111-8111-000000000001', 'Partner', 'owner', 'c3', interval '7 days');

select matches(
  (select code from issued),
  '^[0-9A-HJKMNP-TV-Z]{10}$',
  'the code is ten unambiguous characters — no I, L, O or U to misread aloud'
);

select is(
  (select count(*)::int from public.invite where accepted_at is null),
  1,
  'and one open invite now exists'
);

-- Reading code_hash as a client is itself refused, which is the point of the
-- column-level grant. So prove that, then check the stored value as the table
-- owner, where the question can actually be asked.
select throws_ok(
  $q$ select code_hash from public.invite $q$,
  '42501'::char(5),
  null::text,
  'a client cannot read code_hash at all'
);

reset role;

select isnt(
  (select code_hash from public.invite limit 1),
  (select code from issued),
  'and what is stored is not the code — a copy of this table yields no invites'
);

set local role authenticated;
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local request.jwt.claims   to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated","aal":"aal2"}';

-- ==================================== a bad code does nothing (3)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '99999999-9999-4999-8999-999999999999';
set local request.jwt.claims   to '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.accept_invite('NOTAREALCODE') $q$,
  '22023'::char(5),
  null::text,
  'a made-up code is refused'
);

select is(
  (select count(*)::int from public.membership
    where user_account_id = 'aaaaaaaa-1111-4111-8111-000000000003'),
  0,
  'and creates no membership'
);

select is_empty(
  $q$ select id from public.invite $q$,
  'a stranger cannot even see that an invite exists'
);

-- ============================== the real code works, exactly once (3)

select lives_ok(
  $q$ select public.accept_invite((select code from issued)) $q$,
  'the newcomer accepts the invite'
);

select is(
  (select role from public.membership
    where user_account_id = 'aaaaaaaa-1111-4111-8111-000000000003'),
  'owner',
  'and receives the role the invite granted — a second owner, which is how a locked-out household is prevented'
);

select throws_ok(
  $q$ select public.accept_invite((select code from issued)) $q$,
  '22023'::char(5),
  null::text,
  'the same code cannot be used twice'
);

-- ============================================== expiry is real (2)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '77777777-7777-4777-8777-777777777777';
set local request.jwt.claims   to '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated","aal":"aal2"}';

delete from issued;
insert into issued
select public.create_invite(
  'cccccccc-1111-4111-8111-000000000001', 'Late', 'viewer', 'c4', interval '1 second');

-- Reach past the expiry without waiting for it. As the table owner, because a
-- client has no update grant here — which is the point, and is why the app can
-- never quietly extend an invite it issued.
reset role;
update public.invite set expires_at = now() - interval '1 minute'
  where code_hash = encode(extensions.digest((select code from issued), 'sha256'), 'hex');

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '88888888-8888-4888-8888-888888888888';
set local request.jwt.claims   to '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.accept_invite((select code from issued)) $q$,
  '22023'::char(5),
  null::text,
  'an expired code is dead'
);

select throws_ok(
  $q$ select public.accept_invite('') $q$,
  '22023'::char(5),
  null::text,
  'and so is an empty one'
);

-- ============= the redemption function is not reachable by a client (2)
--
-- redeem_invite takes an account id on trust, so anything able to call it could
-- join any account to any household. It is in `public` because the endpoint
-- reaches it over the API, so the grant is the whole of the control — which
-- makes asserting the grant worth doing rather than assuming.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to '88888888-8888-4888-8888-888888888888';
set local request.jwt.claims   to '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.redeem_invite('ANYCODE123', '88888888-8888-4888-8888-888888888888') $q$,
  '42501'::char(5),
  null::text,
  'a client cannot call the redemption function directly'
);

reset role;

select is(
  (select count(*)::int
   from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name = 'redeem_invite'
     and grantee in ('authenticated', 'anon', 'PUBLIC')),
  0,
  'and holds no grant on it — only service_role does'
);

select * from finish();

rollback;
