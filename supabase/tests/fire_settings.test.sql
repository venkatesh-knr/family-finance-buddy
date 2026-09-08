-- Family Finance Buddy — the FIRE inputs are one household's answer.
--
-- The point of moving them out of React state is that two members see the same
-- number. So the assertions are about exactly that: a partner reads what the
-- owner set, a viewer reads it and cannot change it, and another household
-- sees neither.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(9);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'ca110000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'fire-owner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'ca110000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'fire-partner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'ca110000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'fire-viewer@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'cb220000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'ca110000-0000-4000-8000-000000000001';
update public.user_account set id = 'cb220000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'ca110000-0000-4000-8000-000000000002';
update public.user_account set id = 'cb220000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'ca110000-0000-4000-8000-000000000003';

insert into public.household (id, name, kind) values
  ('cc330000-0000-4000-8000-00000000e001', 'Shared house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('cd440000-0000-4000-8000-00000000c001', 'cc330000-0000-4000-8000-00000000e001', 'Owner', 'c1'),
  ('cd440000-0000-4000-8000-00000000c002', 'cc330000-0000-4000-8000-00000000e001', 'Partner', 'c2'),
  ('cd440000-0000-4000-8000-00000000c003', 'cc330000-0000-4000-8000-00000000e001', 'Looker', 'c3');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('cb220000-0000-4000-8000-0000000000a1', 'cc330000-0000-4000-8000-00000000e001',
   'cd440000-0000-4000-8000-00000000c001', 'owner'),
  ('cb220000-0000-4000-8000-0000000000a2', 'cc330000-0000-4000-8000-00000000e001',
   'cd440000-0000-4000-8000-00000000c002', 'partner'),
  ('cb220000-0000-4000-8000-0000000000a3', 'cc330000-0000-4000-8000-00000000e001',
   'cd440000-0000-4000-8000-00000000c003', 'viewer');

-- ================================================== sensible to begin with (2)

reset role;

select is(
  (select fire_multiplier::text from public.household where id = 'cc330000-0000-4000-8000-00000000e001'),
  '25.00',
  'a new household starts at 25x, the common rule of thumb'
);

select throws_ok(
  $q$ update public.household set fire_years_ahead = 80
       where id = 'cc330000-0000-4000-8000-00000000e001' $q$,
  '23514'::char(5),
  null::text,
  'and cannot be struck eighty years out, where compounding stops being a plan'
);

-- ============================================ the owner sets it, once (2)

set local role authenticated;
set local request.jwt.claim.sub to 'ca110000-0000-4000-8000-000000000001';
set local request.jwt.claims   to '{"sub":"ca110000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ update public.household
         set fire_multiplier = 30, fire_inflation_pct = 7, fire_years_ahead = 15
       where id = 'cc330000-0000-4000-8000-00000000e001' $q$,
  'an owner sets the household multiplier, inflation and horizon'
);

select is(
  (select fire_multiplier::text from public.household where id = 'cc330000-0000-4000-8000-00000000e001'),
  '30.00',
  'and it is stored rather than held on their phone'
);

-- ======================================= and everybody else sees it (3)
--
-- The whole reason these left React state. A couple planning to retire
-- together were looking at two different numbers.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'ca110000-0000-4000-8000-000000000002';
set local request.jwt.claims   to '{"sub":"ca110000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';

select is(
  (select fire_multiplier::text from public.household where id = 'cc330000-0000-4000-8000-00000000e001'),
  '30.00',
  'the partner opens the app to the number the owner set, not to a default'
);

select lives_ok(
  $q$ update public.household set fire_multiplier = 35
       where id = 'cc330000-0000-4000-8000-00000000e001' $q$,
  'and can change it too: a shared target is a decision either of them may make'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'ca110000-0000-4000-8000-000000000003';
set local request.jwt.claims   to '{"sub":"ca110000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}';

select is(
  (select fire_multiplier::text from public.household where id = 'cc330000-0000-4000-8000-00000000e001'),
  '35.00',
  'a viewer sees the same figure — it is the household total they are looking at'
);

-- ================================================ but does not set it (2)

with attempted as (
  update public.household set fire_multiplier = 50
   where id = 'cc330000-0000-4000-8000-00000000e001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a viewer cannot move the household target'
);

-- And nobody outside the household can read it at all, which the select
-- policy already governed and this confirms still holds with a write policy
-- beside it.
reset role;
set local role authenticated;
set local request.jwt.claim.sub to '00000000-0000-4000-8000-00000000dead';
set local request.jwt.claims   to '{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.household where id = 'cc330000-0000-4000-8000-00000000e001' $q$,
  'and somebody with no membership sees no household to change'
);

reset role;

select * from finish();

rollback;
