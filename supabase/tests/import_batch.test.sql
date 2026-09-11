-- Family Finance Buddy — where an imported row came from.
--
-- The assertion that matters most here is the boring one: the same statement
-- line cannot arrive twice. A doubled SIP is a doubled cost basis and a wrong
-- capital gain years later, and by then nobody remembers importing the file
-- twice. So it is refused by an index rather than by a client that means well.
--
-- Around it: who may import, that an import cannot be edited or tidied away
-- afterwards, that a row cannot cite another household's import, and that two
-- folios of one scheme are two positions while two of nothing are still a
-- mistake.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(17);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'a1a11111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'owner@import.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c3c33333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'filer@import.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'b2b22222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'looker@import.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'd4d44444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'other@import.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'ac000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'a1a11111-1111-4111-8111-111111111111';
update public.user_account set id = 'ac000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c3c33333-3333-4333-8333-333333333333';
update public.user_account set id = 'ac000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'b2b22222-2222-4222-8222-222222222222';
update public.user_account set id = 'ac000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'd4d44444-4444-4444-8444-444444444444';

insert into public.household (id, name, kind) values
  ('d1000000-0000-4000-8000-0000000000d1', 'Importing house', 'demo'),
  ('d2000000-0000-4000-8000-0000000000d2', 'The other house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('aa000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-0000000000d1', 'Owner',  'c1'),
  ('aa000000-0000-4000-8000-0000000000a3', 'd1000000-0000-4000-8000-0000000000d1', 'Filer',  'c3'),
  ('aa000000-0000-4000-8000-0000000000a2', 'd1000000-0000-4000-8000-0000000000d1', 'Looker', 'c2'),
  ('cc000000-0000-4000-8000-0000000000c1', 'd2000000-0000-4000-8000-0000000000d2', 'Other',  'c1');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('ac000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a1', 'owner'),
  ('ac000000-0000-4000-8000-0000000000a3', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('ac000000-0000-4000-8000-0000000000a2', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a2', 'viewer'),
  ('ac000000-0000-4000-8000-0000000000a4', 'd2000000-0000-4000-8000-0000000000d2',
   'cc000000-0000-4000-8000-0000000000c1', 'owner');

insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('f1000000-0000-4000-8000-0000000000f1', 'd1000000-0000-4000-8000-0000000000d1',
   'A fund with two folios', 'mutual_fund', 'INR', 'INR'),
  ('f2000000-0000-4000-8000-0000000000f2', 'd2000000-0000-4000-8000-0000000000d2',
   'Their fund', 'mutual_fund', 'INR', 'INR');

insert into public.holding (id, household_id, member_id, instrument_id, quantity, folio_last4) values
  ('b0000000-0000-4000-8000-0000000000b1', 'd1000000-0000-4000-8000-0000000000d1',
   'aa000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-0000000000f1', 100, '4821'),
  ('b0000000-0000-4000-8000-0000000000b2', 'd2000000-0000-4000-8000-0000000000d2',
   'cc000000-0000-4000-8000-0000000000c1', 'f2000000-0000-4000-8000-0000000000f2', 50, null);

-- One import in each household, made the long way so the assertions below can
-- cite them as postgres before anybody signs in.
insert into public.import_batch (id, household_id, kind, period_start, period_end, label, row_count, created_by) values
  ('c1000000-0000-4000-8000-00000000c101', 'd1000000-0000-4000-8000-0000000000d1',
   'ecas_cams', date '2024-04-01', date '2026-03-31', 'Three years of SIPs', 2,
   'ac000000-0000-4000-8000-0000000000a1'),
  ('c2000000-0000-4000-8000-00000000c201', 'd2000000-0000-4000-8000-0000000000d2',
   'ecas_kfintech', null, null, null, 1,
   'ac000000-0000-4000-8000-0000000000a4');

-- ═══════════════════════════════════════════════════ who may import (4)

set local role authenticated;
set local request.jwt.claim.sub to 'b2b22222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"b2b22222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.import_batch (household_id, kind)
      values ('d1000000-0000-4000-8000-0000000000d1', 'ecas_cams') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot import'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c3c33333-3333-4333-8333-333333333333';
set local request.jwt.claims   to '{"sub":"c3c33333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';

-- Somebody who may record their own purchases may import the statement those
-- purchases are on.
select lives_ok(
  $q$ insert into public.import_batch (household_id, kind, label)
      values ('d1000000-0000-4000-8000-0000000000d1', 'broker_csv', 'My own trades') $q$,
  'a contributor can import'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'a1a11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"a1a11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

-- An import is a statement of what happened. There is no grant to rewrite one
-- and none to tidy it away, which the rows citing it depend on.
select throws_ok(
  $q$ update public.import_batch set label = 'something else'
       where id = 'c1000000-0000-4000-8000-00000000c101' $q$,
  '42501'::char(5),
  null::text,
  'an import cannot be rewritten afterwards'
);

select throws_ok(
  $q$ delete from public.import_batch where id = 'c1000000-0000-4000-8000-00000000c101' $q$,
  '42501'::char(5),
  null::text,
  'and cannot be deleted'
);

-- ═════════════════════════════════════════════════ and who may read it (2)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'd4d44444-4444-4444-8444-444444444444';
set local request.jwt.claims   to '{"sub":"d4d44444-4444-4444-8444-444444444444","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.import_batch
       where household_id = 'd1000000-0000-4000-8000-0000000000d1' $q$,
  'another household sees none of your imports'
);

-- The publishable key ships in the bundle, so a password alone must not reach
-- an import — which says which statements a household has and when.
reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'a1a11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"a1a11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select id from public.import_batch
       where household_id = 'd1000000-0000-4000-8000-0000000000d1' $q$,
  'and a password without a second factor reads none of them either'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'a1a11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"a1a11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

-- ═══════════════════════════════════════ the line that cannot import twice (4)

select lives_ok(
  $q$ insert into public.lot
        (household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by,
         source_batch_id, source_hash)
      values ('d1000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000b1',
              date '2025-05-01', 12.345, 500000, 'INR', 'ac000000-0000-4000-8000-0000000000a1',
              'c1000000-0000-4000-8000-00000000c101',
              '1111111111111111111111111111111111111111111111111111111111111111') $q$,
  'an imported purchase records the statement line it came from'
);

-- The assertion this table exists for.
select throws_ok(
  $q$ insert into public.lot
        (household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by,
         source_batch_id, source_hash)
      values ('d1000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000b1',
              date '2025-05-01', 12.345, 500000, 'INR', 'ac000000-0000-4000-8000-0000000000a1',
              'c1000000-0000-4000-8000-00000000c101',
              '1111111111111111111111111111111111111111111111111111111111111111') $q$,
  '23505'::char(5),
  null::text,
  're-importing the same statement line is refused — a doubled SIP is a doubled cost basis'
);

-- Two rows somebody typed have no statement line, and nulls do not collide.
select lives_ok(
  $q$ insert into public.lot
        (household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by)
      values ('d1000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000b1',
              date '2025-06-01', 1, 10000, 'INR', 'ac000000-0000-4000-8000-0000000000a1'),
             ('d1000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000b1',
              date '2025-06-01', 1, 10000, 'INR', 'ac000000-0000-4000-8000-0000000000a1') $q$,
  'two typed purchases that look alike are still two purchases'
);

-- A hash that is not one. The column takes 64 lower-case hex characters and
-- nothing else, so a client sending a folio number in that field is refused
-- rather than storing an account identifier.
select throws_ok(
  $q$ insert into public.lot
        (household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by, source_hash)
      values ('d1000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000b1',
              date '2025-07-01', 1, 10000, 'INR', 'ac000000-0000-4000-8000-0000000000a1',
              'folio-4821') $q$,
  '23514'::char(5),
  null::text,
  'the identity column takes a hash and nothing else'
);

-- ════════════════════════════════════════════ an import stays where it was (3)

select throws_ok(
  $q$ update public.lot
         set source_hash = '2222222222222222222222222222222222222222222222222222222222222222'
       where source_hash = '1111111111111111111111111111111111111111111111111111111111111111' $q$,
  '22023'::char(5),
  null::text,
  'the statement line a row came from cannot be changed'
);

select lives_ok(
  $q$ update public.lot set cost_minor = 505000
       where source_hash = '1111111111111111111111111111111111111111111111111111111111111111' $q$,
  'while the figures stay correctable in place'
);

-- Citing another household's import would put one household's rows under
-- another's audit trail. The composite key refuses it.
select throws_ok(
  $q$ insert into public.lot
        (household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by, source_batch_id)
      values ('d1000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-0000000000b1',
              date '2025-08-01', 1, 10000, 'INR', 'ac000000-0000-4000-8000-0000000000a1',
              'c2000000-0000-4000-8000-00000000c201') $q$,
  '23503'::char(5),
  null::text,
  'a row cannot cite another household''s import'
);

-- ═══════════════════════════════════════════ two folios, one scheme (3)

select lives_ok(
  $q$ insert into public.holding (household_id, member_id, instrument_id, quantity, folio_last4)
      values ('d1000000-0000-4000-8000-0000000000d1', 'aa000000-0000-4000-8000-0000000000a1',
              'f1000000-0000-4000-8000-0000000000f1', 40, '9007') $q$,
  'a second folio of the same scheme is a second position'
);

select throws_ok(
  $q$ insert into public.holding (household_id, member_id, instrument_id, quantity, folio_last4)
      values ('d1000000-0000-4000-8000-0000000000d1', 'aa000000-0000-4000-8000-0000000000a1',
              'f1000000-0000-4000-8000-0000000000f1', 5, '9007') $q$,
  '23505'::char(5),
  null::text,
  'but the same folio twice is the same position'
);

-- The mistake the old constraint caught, still caught.
select throws_ok(
  $q$ insert into public.holding (household_id, member_id, instrument_id, quantity)
      values ('d1000000-0000-4000-8000-0000000000d1', 'aa000000-0000-4000-8000-0000000000a3',
              'f1000000-0000-4000-8000-0000000000f1', 1),
             ('d1000000-0000-4000-8000-0000000000d1', 'aa000000-0000-4000-8000-0000000000a3',
              'f1000000-0000-4000-8000-0000000000f1', 2) $q$,
  '23505'::char(5),
  null::text,
  'and two positions with no folio at all are still one mistake'
);

-- ══════════════════════════════════════════════════ it is audited (1)

reset role;

select isnt_empty(
  $q$ select 1 from public.audit_log
       where entity = 'import_batch'
         and entity_id = 'c1000000-0000-4000-8000-00000000c101'
         and action = 'insert' $q$,
  'an import writes its own audit row'
);

select * from finish();

rollback;
