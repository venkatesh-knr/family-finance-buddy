-- Family Finance Buddy — what a policy covers, and who may touch it.
--
-- The migration (20261012120000) adds columns to a table that already has its policies, its grant and its
-- audit trigger, and adds no policy of its own. What would break silently is the part a column cannot
-- show: that a member of another household cannot reach a policy by any verb, that a viewer reads
-- nothing, that a contributor cannot write one, and that the shape the new columns promise (a policy
-- number of four characters, a surrender value carried by a holding and only by a hybrid policy) is the
-- shape the database enforces. Descriptions open with the rule's ID where it has one
-- (docs/design/keeping-docs-honest.md).

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(19);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'f1f11111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'owner@policy.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'f2f22222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'partner@policy.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'f3f33333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'contrib@policy.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'f4f44444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'viewer@policy.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'f5f55555-5555-4555-8555-555555555555',
   'authenticated', 'authenticated', 'other@policy.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'fc000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'f1f11111-1111-4111-8111-111111111111';
update public.user_account set id = 'fc000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'f2f22222-2222-4222-8222-222222222222';
update public.user_account set id = 'fc000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'f3f33333-3333-4333-8333-333333333333';
update public.user_account set id = 'fc000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'f4f44444-4444-4444-8444-444444444444';
update public.user_account set id = 'fc000000-0000-4000-8000-0000000000a5'
  where auth_user_id = 'f5f55555-5555-4555-8555-555555555555';

insert into public.household (id, name, kind) values
  ('f1000000-0000-4000-8000-0000000000e1', 'Policy house', 'demo'),
  ('f2000000-0000-4000-8000-0000000000e2', 'The other house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('fa000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-0000000000e1', 'Owner',   'c1'),
  ('fa000000-0000-4000-8000-0000000000a2', 'f1000000-0000-4000-8000-0000000000e1', 'Partner', 'c2'),
  ('fa000000-0000-4000-8000-0000000000a3', 'f1000000-0000-4000-8000-0000000000e1', 'Contrib', 'c3'),
  ('fa000000-0000-4000-8000-0000000000a4', 'f1000000-0000-4000-8000-0000000000e1', 'Viewer',  'c4'),
  ('fa000000-0000-4000-8000-0000000000a5', 'f2000000-0000-4000-8000-0000000000e2', 'Other',   'c1');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('fc000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-0000000000e1',
   'fa000000-0000-4000-8000-0000000000a1', 'owner'),
  ('fc000000-0000-4000-8000-0000000000a2', 'f1000000-0000-4000-8000-0000000000e1',
   'fa000000-0000-4000-8000-0000000000a2', 'partner'),
  ('fc000000-0000-4000-8000-0000000000a3', 'f1000000-0000-4000-8000-0000000000e1',
   'fa000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('fc000000-0000-4000-8000-0000000000a4', 'f1000000-0000-4000-8000-0000000000e1',
   'fa000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('fc000000-0000-4000-8000-0000000000a5', 'f2000000-0000-4000-8000-0000000000e2',
   'fa000000-0000-4000-8000-0000000000a5', 'owner');

-- One holding in each household, to be cited (and, across households, refused).
insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('fe000000-0000-4000-8000-0000000000f1', 'f1000000-0000-4000-8000-0000000000e1',
   'A ULIP', 'other', 'INR', 'INR'),
  ('fe000000-0000-4000-8000-0000000000f2', 'f2000000-0000-4000-8000-0000000000e2',
   'Their ULIP', 'other', 'INR', 'INR');

insert into public.holding (id, household_id, member_id, instrument_id, quantity) values
  ('fb000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-0000000000e1',
   'fa000000-0000-4000-8000-0000000000a1', 'fe000000-0000-4000-8000-0000000000f1', 1),
  ('fb000000-0000-4000-8000-0000000000b2', 'f2000000-0000-4000-8000-0000000000e2',
   'fa000000-0000-4000-8000-0000000000a5', 'fe000000-0000-4000-8000-0000000000f2', 1);

-- p1: a term policy filed under the contributor, with an insurer and a policy number.
insert into public.insurance_policy
  (id, household_id, name, kind, insurer, policy_last4, cover_minor, premium_minor, member_id) values
  ('fd000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000e1',
   'Term life', 'term_life', 'Demo Life', '4821', 1000000000, 1800000,
   'fa000000-0000-4000-8000-0000000000a3');

-- ═════════════════════════════════════════════════ what the owner can record (7)

set local role authenticated;
set local request.jwt.claim.sub to 'f1f11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"f1f11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ insert into public.insurance_policy
        (id, household_id, name, kind, insurer, policy_last4, cover_minor, renewal_on)
      values ('fd000000-0000-4000-8000-0000000000d2', 'f1000000-0000-4000-8000-0000000000e1',
              'Family health', 'health', 'Demo Health', '7305', 100000000, date '2027-01-05') $q$,
  'the owner can record a policy with its cover, insurer and renewal'
);

select throws_ok(
  $q$ update public.insurance_policy set policy_last4 = '48215'
       where id = 'fd000000-0000-4000-8000-0000000000d1' $q$,
  '23514'::char(5),
  null::text,
  'PF-C14 — a policy number is kept to four characters and no more'
);

select throws_ok(
  $q$ update public.insurance_policy set cover_minor = -1
       where id = 'fd000000-0000-4000-8000-0000000000d1' $q$,
  '23514'::char(5),
  null::text,
  'a cover below nothing is refused'
);

select lives_ok(
  $q$ insert into public.insurance_policy
        (household_id, name, kind, cover_minor, linked_holding_id)
      values ('f1000000-0000-4000-8000-0000000000e1', 'ULIP', 'ulip', 50000000,
              'fb000000-0000-4000-8000-0000000000b1') $q$,
  'PF-C4 — a ULIP is a policy and a linked holding that carries its surrender value'
);

select throws_ok(
  $q$ update public.insurance_policy set linked_holding_id = 'fb000000-0000-4000-8000-0000000000b1'
       where id = 'fd000000-0000-4000-8000-0000000000d1' $q$,
  '23514'::char(5),
  null::text,
  'PF-C4 — a term policy has no surrender value, so it is refused a linked holding'
);

select throws_ok(
  $q$ insert into public.insurance_policy
        (household_id, name, kind, cover_minor, linked_holding_id)
      values ('f1000000-0000-4000-8000-0000000000e1', 'Endowment', 'endowment', 50000000,
              'fb000000-0000-4000-8000-0000000000b2') $q$,
  '23503'::char(5),
  null::text,
  'PF-C4 — a policy cannot cite another household''s holding'
);

reset role;

select is(
  (select after ->> 'cover_minor' from public.audit_log
    where entity = 'insurance_policy'
      and entity_id = 'fd000000-0000-4000-8000-0000000000d2'
      and action = 'insert'
    order by id desc limit 1),
  '100000000',
  'a policy''s cover is in the audit log'
);

-- ══════════════════════════ another household cannot reach it, by any verb (5)

set local role authenticated;
set local request.jwt.claim.sub to 'f5f55555-5555-4555-8555-555555555555';
set local request.jwt.claims   to '{"sub":"f5f55555-5555-4555-8555-555555555555","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.insurance_policy
       where household_id = 'f1000000-0000-4000-8000-0000000000e1' $q$,
  'PF-C13 — a member of another household cannot select a policy'
);

select throws_ok(
  $q$ insert into public.insurance_policy (household_id, name, kind)
      values ('f1000000-0000-4000-8000-0000000000e1', 'Planted', 'other') $q$,
  '42501'::char(5),
  null::text,
  'PF-C13 — a member of another household cannot insert a policy'
);

with attempted as (
  update public.insurance_policy set cover_minor = 1
   where id = 'fd000000-0000-4000-8000-0000000000d1'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'PF-C13 — a member of another household cannot update a policy'
);

select throws_ok(
  $q$ delete from public.insurance_policy where id = 'fd000000-0000-4000-8000-0000000000d1' $q$,
  '42501'::char(5),
  null::text,
  'PF-C13 — a member of another household cannot delete a policy, and nobody can: there is no grant'
);

-- Its own assertion and not the table-level one: the identifying detail, asked for by name.
select is_empty(
  $q$ select insurer, policy_last4 from public.insurance_policy
       where household_id = 'f1000000-0000-4000-8000-0000000000e1' $q$,
  'PF-C14 — another household cannot read a policy''s insurer or policy number'
);

-- ═══════════════════════════════════════════════ and within it, by role (4)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'f3f33333-3333-4333-8333-333333333333';
set local request.jwt.claims   to '{"sub":"f3f33333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.insurance_policy (household_id, name, kind)
      values ('f1000000-0000-4000-8000-0000000000e1', 'Mine', 'other') $q$,
  '42501'::char(5),
  null::text,
  'a contributor cannot record a policy'
);

with attempted as (
  update public.insurance_policy set cover_minor = 1
   where id = 'fd000000-0000-4000-8000-0000000000d1'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a contributor cannot change a policy, even one filed under them'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'f4f44444-4444-4444-8444-444444444444';
set local request.jwt.claims   to '{"sub":"f4f44444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.insurance_policy $q$,
  'a viewer reads no policy'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'f2f22222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"f2f22222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ update public.insurance_policy set renewal_on = date '2027-03-01'
       where id = 'fd000000-0000-4000-8000-0000000000d1' $q$,
  'a partner can change a policy'
);

-- ══════════════════════════════════════ the cover gap's one household setting (3)

reset role;

select is(
  (select cover_dependency_years from public.household
    where id = 'f1000000-0000-4000-8000-0000000000e1'),
  10,
  'years of dependency start at ten, the default the screen shows'
);

set local role authenticated;
set local request.jwt.claim.sub to 'f1f11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"f1f11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ update public.household set cover_dependency_years = 51
       where id = 'f1000000-0000-4000-8000-0000000000e1' $q$,
  '23514'::char(5),
  null::text,
  'years of dependency past fifty are refused'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'f4f44444-4444-4444-8444-444444444444';
set local request.jwt.claims   to '{"sub":"f4f44444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';

with attempted as (
  update public.household set cover_dependency_years = 20
   where id = 'f1000000-0000-4000-8000-0000000000e1'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a viewer cannot change the years of dependency'
);

select * from finish();

rollback;
