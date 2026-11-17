-- Family Finance Buddy — a stated spend (spending-capture.md section 11, SC-I14 to SC-I19).
--
-- FOR REVIEW with the migration beside it (20261117130000_spend_statement.sql). Not run locally: Docker is blocked on the maintainer's machine, so CI's
-- policy suite is the first run.
--
-- SC-I14 — a statement is one live per household, month and currency, is changed only by voiding it and stating again, and is never edited in place.
-- SC-I19 — an owner or a partner reads and writes it; a contributor, a viewer and another household read none and write none; and it is about a month
--          that has ended.
--
-- Months used are far in the past (2020) and far in the future (2099), so the test does not depend on the day it runs.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(26);

-- ============================================================== the fixture
--
--   owner        household R (demo)
--   partner      household R
--   contributor  household R
--   viewer       household R
--   stranger     owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@sps.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@sps.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@sps.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@sps.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@sps.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd5000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd5000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd5000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd5000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd5000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e5000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e5000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f5000000-0000-4000-8000-0000000000a1', 'e5000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f5000000-0000-4000-8000-0000000000a2', 'e5000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f5000000-0000-4000-8000-0000000000a3', 'e5000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f5000000-0000-4000-8000-0000000000a4', 'e5000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f5000000-0000-4000-8000-0000000000b1', 'e5000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d5000000-0000-4000-8000-0000000000a1', 'e5000000-0000-4000-8000-0000000000f1', 'f5000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d5000000-0000-4000-8000-0000000000a2', 'e5000000-0000-4000-8000-0000000000f1', 'f5000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d5000000-0000-4000-8000-0000000000a3', 'e5000000-0000-4000-8000-0000000000f1', 'f5000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d5000000-0000-4000-8000-0000000000a4', 'e5000000-0000-4000-8000-0000000000f1', 'f5000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d5000000-0000-4000-8000-0000000000b1', 'e5000000-0000-4000-8000-0000000000f2', 'f5000000-0000-4000-8000-0000000000b1', 'owner');

-- The statements seeded for the policies to read. S1 is household R's, January 2020, in rupees. S2 is household S's.
insert into public.spend_statement (id, household_id, month, currency, amount_minor, created_by) values
  ('a5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000f1', '2020-01-01', 'INR', 8200000, 'd5000000-0000-4000-8000-0000000000a1'),
  ('a5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-0000000000f2', '2020-01-01', 'INR', 5000000, 'd5000000-0000-4000-8000-0000000000b1');

-- ============================================== what the table refuses, as the database owner

select throws_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-02-01', 'INR', 0, 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I14 — a stated spend is more than nothing'
);

select throws_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-02-15', 'INR', 100, 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I14 — and is about a whole month: a day inside one is refused'
);

select throws_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-02-01', 'rupees', 100, 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I14 — in a currency that is three capitals'
);

select throws_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', '2099-01-01', 'INR', 100, 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I19 — a month that has not ended cannot be stated'
);

select throws_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', date_trunc('month', now() at time zone 'Asia/Kolkata')::date, 'INR', 100,
              'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I19 — nor the month in progress in India'
);

select throws_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-01-01', 'INR', 100, 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23505'::char(5), null::text,
  'SC-I14 — a second live statement for the same household, month and currency is refused'
);

select lives_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-01-01', 'USD', 100, 'd5000000-0000-4000-8000-0000000000a1') $q$,
  'SC-I14 — but the same month in another currency is its own statement'
);

select throws_ok(
  $q$ update public.spend_statement set voided_at = now() where id = 'a5000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'a statement is voided by someone: the time and the person go together'
);

select throws_ok(
  $q$ update public.spend_statement set amount_minor = 9000000 where id = 'a5000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'SC-I14 — a stated spend is not edited in place: its amount cannot change'
);

select throws_ok(
  $q$ update public.spend_statement set month = '2020-02-01' where id = 'a5000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'SC-I14 — nor its month'
);

-- ============================================== the owner, with a second factor

set local role authenticated;
set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.spend_statement),
  2,
  'SC-I19 — the owner reads household R''s statements, the rupee one and the dollar one, and not household S''s'
);

select lives_ok(
  $q$ update public.spend_statement set note = 'rough, from memory' where id = 'a5000000-0000-4000-8000-000000000001' $q$,
  'SC-I14 — a note can be added: it is not the figure'
);

select lives_ok(
  $q$ update public.spend_statement set voided_at = now(), voided_by = 'd5000000-0000-4000-8000-0000000000a1'
       where id = 'a5000000-0000-4000-8000-000000000001' $q$,
  'SC-I14 — a statement is voided'
);

select lives_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-01-01', 'INR', 9100000) $q$,
  'SC-I14 — and stated again for the same month, now that the first is voided'
);

select throws_ok(
  $q$ update public.spend_statement set note = 'changed my mind' where id = 'a5000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'SC-I14 — a voided statement changes no more'
);

select throws_ok(
  $q$ delete from public.spend_statement $q$,
  '42501'::char(5), null::text,
  'nobody deletes a statement: it is voided'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'spend_statement' and entity_id = 'a5000000-0000-4000-8000-000000000001'),
  3,
  'the audit log has the statement, its note and its void'
);

select is(
  (select count(*)::int from public.spend_statement where household_id = 'e5000000-0000-4000-8000-0000000000f2'),
  0,
  'SC-I19 — nothing of another household is read'
);

-- ============================================== the partner

set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.spend_statement where voided_at is null),
  2,
  'SC-I19 — the partner reads the household''s live statements'
);

select lives_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-03-01', 'INR', 7000000) $q$,
  'SC-I19 — and states one'
);

-- ============================================== a contributor, a viewer and a stranger

set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.spend_statement) + (select count(*)::int from public.audit_log where entity = 'spend_statement'),
  0,
  'SC-I19 — a contributor reads no statement and no audit row of one'
);

select throws_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-04-01', 'INR', 100) $q$,
  '42501'::char(5), null::text,
  'SC-I19 — nor states one'
);

set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.spend_statement),
  0,
  'SC-I19 — a viewer reads none'
);

set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.spend_statement (household_id, month, currency, amount_minor)
      values ('e5000000-0000-4000-8000-0000000000f1', '2020-05-01', 'INR', 100) $q$,
  '42501'::char(5), null::text,
  'SC-I19 — another household states nothing for this one'
);

-- ============================================== the demo reset clears them

set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ select public.reset_demo_household('e5000000-0000-4000-8000-0000000000f1') $q$,
  'the owner resets the demo household'
);

select is(
  (select count(*)::int from public.spend_statement where household_id = 'e5000000-0000-4000-8000-0000000000f1'),
  0,
  'the reset cleared its stated spends'
);

select * from finish();

rollback;
