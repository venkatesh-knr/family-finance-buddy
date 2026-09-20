-- Family Finance Buddy — what the registrar says a position holds.
--
-- The migration adds no policy: a balance rides on the holding row, so the
-- holding's own policies decide who reads and who writes it. The assertions
-- here are the ones that would break silently if that stopped being true.
--
-- The one that matters most is the second block. A personal holding's units
-- are its value divided by a public price, so a closing balance leaking from
-- one gives away the holding as surely as a reading would.
--
-- Around it: the shape a balance must have — a date, or it is not one — and
-- that it cannot cite another household's import.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(13);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'e1e11111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'owner@stated.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e2e22222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'looker@stated.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e3e33333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'filer@stated.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e4e44444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'other@stated.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'ec000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'e1e11111-1111-4111-8111-111111111111';
update public.user_account set id = 'ec000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'e2e22222-2222-4222-8222-222222222222';
update public.user_account set id = 'ec000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'e3e33333-3333-4333-8333-333333333333';
update public.user_account set id = 'ec000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'e4e44444-4444-4444-8444-444444444444';

insert into public.household (id, name, kind) values
  ('e1000000-0000-4000-8000-0000000000e1', 'Stating house', 'demo'),
  ('e2000000-0000-4000-8000-0000000000e2', 'The other house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('ea000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000e1', 'Owner',  'c1'),
  ('ea000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-0000000000e1', 'Looker', 'c2'),
  ('ea000000-0000-4000-8000-0000000000a3', 'e1000000-0000-4000-8000-0000000000e1', 'Filer',  'c3'),
  ('ea000000-0000-4000-8000-0000000000a4', 'e2000000-0000-4000-8000-0000000000e2', 'Other',  'c1');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('ec000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a1', 'owner'),
  ('ec000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a2', 'viewer'),
  ('ec000000-0000-4000-8000-0000000000a3', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('ec000000-0000-4000-8000-0000000000a4', 'e2000000-0000-4000-8000-0000000000e2',
   'ea000000-0000-4000-8000-0000000000a4', 'owner');

insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('ef000000-0000-4000-8000-0000000000f1', 'e1000000-0000-4000-8000-0000000000e1',
   'A fund', 'mutual_fund', 'INR', 'INR'),
  ('ef000000-0000-4000-8000-0000000000f2', 'e1000000-0000-4000-8000-0000000000e1',
   'Another fund', 'mutual_fund', 'INR', 'INR'),
  ('ef000000-0000-4000-8000-0000000000f3', 'e1000000-0000-4000-8000-0000000000e1',
   'A private fund', 'mutual_fund', 'INR', 'INR');

-- b1: the household's, held by the owner.  b2: the owner's, another fund.
-- b3: the filer's, and personal — with a balance already stated on it.
insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('eb000000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a1', 'ef000000-0000-4000-8000-0000000000f1', 0, 'household'),
  ('eb000000-0000-4000-8000-0000000000b2', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a1', 'ef000000-0000-4000-8000-0000000000f2', 0, 'household'),
  ('eb000000-0000-4000-8000-0000000000b3', 'e1000000-0000-4000-8000-0000000000e1',
   'ea000000-0000-4000-8000-0000000000a3', 'ef000000-0000-4000-8000-0000000000f3', 0, 'personal');

update public.holding
   set stated_quantity = 4013.730, stated_as_at = date '2026-09-30'
 where id = 'eb000000-0000-4000-8000-0000000000b3';

insert into public.import_batch (id, household_id, kind, period_start, period_end, row_count, created_by) values
  ('c1000000-0000-4000-8000-00000000c1e1', 'e1000000-0000-4000-8000-0000000000e1',
   'ecas_cams', date '2026-04-01', date '2026-09-30', 3,
   'ec000000-0000-4000-8000-0000000000a1'),
  ('c2000000-0000-4000-8000-00000000c2e2', 'e2000000-0000-4000-8000-0000000000e2',
   'ecas_cams', null, null, 1,
   'ec000000-0000-4000-8000-0000000000a4');

-- ═══════════════════════════════════════ a balance can be recorded (3)

set local role authenticated;
set local request.jwt.claim.sub to 'e1e11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"e1e11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ update public.holding
         set stated_quantity = 4013.730,
             stated_as_at = date '2026-09-30',
             stated_source_batch_id = 'c1000000-0000-4000-8000-00000000c1e1'
       where id = 'eb000000-0000-4000-8000-0000000000b1' $q$,
  'the owner can record what a statement reported, and which import said so'
);

select is(
  (select stated_quantity from public.holding where id = 'eb000000-0000-4000-8000-0000000000b1'),
  4013.730::numeric,
  'and it is stored exactly — three decimals in, three decimals out'
);

-- The exact number and its date, in the log, with everything else. Nothing to
-- add to the audit function: it records the row, and the row now has these.
reset role;

select is(
  (select after ->> 'stated_as_at' from public.audit_log
    where entity = 'holding'
      and entity_id = 'eb000000-0000-4000-8000-0000000000b1'
      and action = 'update'
    order by id desc limit 1),
  '2026-09-30',
  'a recorded balance is in the audit log with its date'
);

-- ═════════════════════════════════ its shape, which is not negotiable (5)

set local role authenticated;
set local request.jwt.claim.sub to 'e1e11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"e1e11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

-- "A balance without a date silently ages into a wrong figure."
select throws_ok(
  $q$ update public.holding set stated_quantity = 10
       where id = 'eb000000-0000-4000-8000-0000000000b2' $q$,
  '23514'::char(5),
  null::text,
  'a balance with no date is refused'
);

select throws_ok(
  $q$ update public.holding set stated_as_at = date '2026-09-30'
       where id = 'eb000000-0000-4000-8000-0000000000b2' $q$,
  '23514'::char(5),
  null::text,
  'and a date with no balance'
);

select throws_ok(
  $q$ update public.holding set stated_quantity = -1, stated_as_at = date '2026-09-30'
       where id = 'eb000000-0000-4000-8000-0000000000b2' $q$,
  '23514'::char(5),
  null::text,
  'and a balance below zero'
);

select throws_ok(
  $q$ update public.holding
         set stated_source_batch_id = 'c1000000-0000-4000-8000-00000000c1e1'
       where id = 'eb000000-0000-4000-8000-0000000000b2' $q$,
  '23514'::char(5),
  null::text,
  'an import cannot be cited for a balance that was never stated'
);

-- One household's positions under another's audit trail. The composite key
-- refuses it, as it does for lot and disposal.
select throws_ok(
  $q$ update public.holding
         set stated_quantity = 1, stated_as_at = date '2026-09-30',
             stated_source_batch_id = 'c2000000-0000-4000-8000-00000000c2e2'
       where id = 'eb000000-0000-4000-8000-0000000000b2' $q$,
  '23503'::char(5),
  null::text,
  'a holding cannot cite another household''s import'
);

-- ═══════════════════════════════════════════ who may change it (2)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'e2e22222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"e2e22222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

with attempted as (
  update public.holding
     set stated_quantity = 1, stated_as_at = date '2026-09-30'
   where id = 'eb000000-0000-4000-8000-0000000000b2'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a viewer cannot state a balance'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'e3e33333-3333-4333-8333-333333333333';
set local request.jwt.claims   to '{"sub":"e3e33333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';

-- A contributor records their own positions and nobody else's. A balance is
-- the number a valuation is built on, so moving one moves somebody's net worth.
with attempted as (
  update public.holding
     set stated_quantity = 1, stated_as_at = date '2026-09-30'
   where id = 'eb000000-0000-4000-8000-0000000000b2'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a contributor cannot state a balance on somebody else''s holding'
);

-- ═══════════════════════════════════ and who may read it (3)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'e1e11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"e1e11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

-- Units on a personal holding are its value over a public price. A balance
-- returned to the owner would return the holding.
select is_empty(
  $q$ select stated_quantity from public.holding
       where id = 'eb000000-0000-4000-8000-0000000000b3' $q$,
  'the owner cannot read the balance on a member''s personal holding'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'e4e44444-4444-4444-8444-444444444444';
set local request.jwt.claims   to '{"sub":"e4e44444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select stated_quantity from public.holding
       where household_id = 'e1000000-0000-4000-8000-0000000000e1' $q$,
  'another household reads no balances at all'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'e1e11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"e1e11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select stated_quantity from public.holding
       where household_id = 'e1000000-0000-4000-8000-0000000000e1' $q$,
  'and a password without a second factor reads none either'
);

select * from finish();

rollback;
