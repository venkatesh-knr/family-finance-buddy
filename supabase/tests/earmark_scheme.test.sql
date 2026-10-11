-- Family Finance Buddy — what a holding's money is for, and what a deposit is.
--
-- The migration (20261011120000) adds a column to each of two tables and no policy: the holding's and
-- the instrument's own policies decide who may write them, and their audit triggers record the row.
-- The assertions here are the ones that would break silently if either stopped being true — a viewer
-- who could retag an emergency fund as retirement money would move the FIRE figure — plus the shape
-- each column must have. Descriptions open with the rule's ID where the rule has one
-- (docs/design/keeping-docs-honest.md).

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(14);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'e1e11111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'owner@earmark.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e2e22222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'looker@earmark.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e4e44444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'other@earmark.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'ec000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'e1e11111-1111-4111-8111-111111111111';
update public.user_account set id = 'ec000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'e2e22222-2222-4222-8222-222222222222';
update public.user_account set id = 'ec000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'e4e44444-4444-4444-8444-444444444444';

insert into public.household (id, name, kind) values
  ('e1000000-0000-4000-8000-0000000000e1', 'Earmark house', 'demo'),
  ('e2000000-0000-4000-8000-0000000000e2', 'The other house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('ea000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000e1', 'Owner',  'c1'),
  ('ea000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-0000000000e1', 'Looker', 'c2'),
  ('ea000000-0000-4000-8000-0000000000a4', 'e2000000-0000-4000-8000-0000000000e2', 'Other',  'c1');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('ec000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a1', 'owner'),
  ('ec000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a2', 'viewer'),
  ('ec000000-0000-4000-8000-0000000000a4', 'e2000000-0000-4000-8000-0000000000e2',
   'ea000000-0000-4000-8000-0000000000a4', 'owner');

-- f1: a fund, which is not a deposit.  f2: a deposit.
insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('ef000000-0000-4000-8000-0000000000f1', 'e1000000-0000-4000-8000-0000000000e1',
   'A fund', 'mutual_fund', 'INR', 'INR'),
  ('ef000000-0000-4000-8000-0000000000f2', 'e1000000-0000-4000-8000-0000000000e1',
   'A deposit', 'deposit', 'INR', 'INR');

insert into public.holding (id, household_id, member_id, instrument_id, quantity) values
  ('eb000000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a1', 'ef000000-0000-4000-8000-0000000000f2', 1);

-- A holding tagged before the migration would read none; one inserted without saying reads none too.
select is(
  (select earmark from public.holding where id = 'eb000000-0000-4000-8000-0000000000b1'),
  'none',
  'a holding with no earmark reads none'
);

select is(
  (select scheme from public.instrument where id = 'ef000000-0000-4000-8000-0000000000f2'),
  null::text,
  'an instrument with no scheme reads null'
);

-- ═══════════════════════════════════════════════ what can be recorded (6)

set local role authenticated;
set local request.jwt.claim.sub to 'e1e11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"e1e11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ update public.holding set earmark = 'emergency'
       where id = 'eb000000-0000-4000-8000-0000000000b1' $q$,
  'the owner can earmark a holding'
);

select is(
  (select earmark from public.holding where id = 'eb000000-0000-4000-8000-0000000000b1'),
  'emergency',
  'and it reads back'
);

select throws_ok(
  $q$ update public.holding set earmark = 'holiday'
       where id = 'eb000000-0000-4000-8000-0000000000b1' $q$,
  '23514'::char(5),
  null::text,
  'an earmark outside the list is refused'
);

select lives_ok(
  $q$ update public.instrument set scheme = 'fd'
       where id = 'ef000000-0000-4000-8000-0000000000f2' $q$,
  'PF-C5 — a deposit can be given a scheme'
);

select throws_ok(
  $q$ update public.instrument set scheme = 'ppf'
       where id = 'ef000000-0000-4000-8000-0000000000f1' $q$,
  '23514'::char(5),
  null::text,
  'PF-C5 — a fund is refused a scheme'
);

select throws_ok(
  $q$ update public.instrument set scheme = 'epf'
       where id = 'ef000000-0000-4000-8000-0000000000f2' $q$,
  '23514'::char(5),
  null::text,
  'a scheme outside the list is refused, even on a deposit'
);

-- A deposit that already has a scheme cannot be turned into a fund and keep it.
select throws_ok(
  $q$ update public.instrument set kind = 'bond'
       where id = 'ef000000-0000-4000-8000-0000000000f2' $q$,
  '23514'::char(5),
  null::text,
  'PF-C5 — a deposit with a scheme cannot become another kind and keep it'
);

-- ═════════════════════════════════════════════════ both are in the log (2)

reset role;

select is(
  (select after ->> 'earmark' from public.audit_log
    where entity = 'holding'
      and entity_id = 'eb000000-0000-4000-8000-0000000000b1'
      and action = 'update'
    order by id desc limit 1),
  'emergency',
  'an earmark change is in the audit log'
);

select is(
  (select after ->> 'scheme' from public.audit_log
    where entity = 'instrument'
      and entity_id = 'ef000000-0000-4000-8000-0000000000f2'
      and action = 'update'
    order by id desc limit 1),
  'fd',
  'and so is a scheme'
);

-- ═══════════════════════════════════════════════ who may change them (3)

set local role authenticated;
set local request.jwt.claim.sub to 'e2e22222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"e2e22222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

with attempted as (
  update public.holding set earmark = 'retirement'
   where id = 'eb000000-0000-4000-8000-0000000000b1'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a viewer cannot earmark a holding'
);

with attempted as (
  update public.instrument set scheme = 'rd'
   where id = 'ef000000-0000-4000-8000-0000000000f2'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a viewer cannot give an instrument a scheme'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'e4e44444-4444-4444-8444-444444444444';
set local request.jwt.claims   to '{"sub":"e4e44444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';

with attempted as (
  update public.holding set earmark = 'retirement'
   where id = 'eb000000-0000-4000-8000-0000000000b1'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'another household''s owner cannot earmark this household''s holding'
);

select * from finish();

rollback;
