-- Family Finance Buddy — property: who reads it, who writes it, what shape a row may have, and that its audit rows
-- are as private as it is.
--
-- A property, its improvements and its valuations are as private as the property: an owner does not read a partner's
-- personal property, a contributor reads only their own, a viewer reads none. The improvements and valuations do not
-- state that themselves; they ask the property's own policy, and the first blocks are the proof that they do.
--
-- The last blocks are the shape. A share of nothing or of more than all of it, a negative cost, work in another
-- currency than the property, two estimates for one day, a loan from another household and a household setting out
-- of range are all refused by the table whoever writes.
--
-- Amounts are not asserted: they are data. Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(36);

-- ============================================================== the fixture
--
--   owner        a shared apartment (p1), linked to a loan
--   partner      a personal house (p2)
--   contributor  a shared plot of land of their own (p3)
--   viewer       nothing
--   stranger     another household's house (p4)

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@property.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@property.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@property.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@property.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd4000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c4000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd4000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c4000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd4000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c4000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd4000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c4000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd4000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c4000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e4000000-0000-4000-8000-0000000000f1', 'Household P', 'demo'),
  ('e4000000-0000-4000-8000-0000000000f2', 'Household Q', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f4000000-0000-4000-8000-0000000000a1', 'e4000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f4000000-0000-4000-8000-0000000000a2', 'e4000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f4000000-0000-4000-8000-0000000000a3', 'e4000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f4000000-0000-4000-8000-0000000000a4', 'e4000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f4000000-0000-4000-8000-0000000000b1', 'e4000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d4000000-0000-4000-8000-0000000000a1', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d4000000-0000-4000-8000-0000000000a2', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d4000000-0000-4000-8000-0000000000a3', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d4000000-0000-4000-8000-0000000000a4', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d4000000-0000-4000-8000-0000000000b1', 'e4000000-0000-4000-8000-0000000000f2',
   'f4000000-0000-4000-8000-0000000000b1', 'owner');

-- A loan in each household: one for p1 to cite, and the stranger's, which p1 may not.
insert into public.liability (id, household_id, name, kind) values
  ('a4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-0000000000f1', 'Home loan', 'home_loan'),
  ('a4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-0000000000f2', 'Their loan', 'home_loan');

insert into public.property
  (id, household_id, member_id, kind, label, currency, purchase_date, purchase_cost_minor,
   stamp_duty_minor, registration_minor, co_owner_share_pct, linked_liability_id, visibility, created_by) values
  ('b4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a1', 'apartment', 'Apartment', 'INR', date '2019-03-01',
   800000000, 56000000, 8000000, 100, 'a4000000-0000-4000-8000-000000000001', 'household',
   'd4000000-0000-4000-8000-0000000000a1'),
  ('b4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a2', 'house', 'Partner house', 'INR', date '2015-06-01',
   500000000, 0, 0, 50, null, 'personal',
   'd4000000-0000-4000-8000-0000000000a2'),
  ('b4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a3', 'land', 'Plot', 'INR', date '2021-01-01',
   300000000, 21000000, 3000000, 100, null, 'household',
   'd4000000-0000-4000-8000-0000000000a3'),
  ('b4000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-0000000000f2',
   'f4000000-0000-4000-8000-0000000000b1', 'house', 'Their house', 'INR', date '2018-01-01',
   900000000, 0, 0, 100, null, 'household',
   'd4000000-0000-4000-8000-0000000000b1');

insert into public.property_improvement
  (id, household_id, property_id, currency, work_date, description, amount_minor, is_capital, created_by) values
  ('c4a00000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-0000000000f1',
   'b4000000-0000-4000-8000-000000000001', 'INR', date '2020-02-01', 'New kitchen', 35000000, true,
   'd4000000-0000-4000-8000-0000000000a1'),
  ('c4a00000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-0000000000f1',
   'b4000000-0000-4000-8000-000000000002', 'INR', date '2020-02-01', 'A room added', 12000000, true,
   'd4000000-0000-4000-8000-0000000000a2'),
  ('c4a00000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-0000000000f1',
   'b4000000-0000-4000-8000-000000000003', 'INR', date '2022-02-01', 'Fencing', 4000000, true,
   'd4000000-0000-4000-8000-0000000000a3'),
  ('c4a00000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-0000000000f2',
   'b4000000-0000-4000-8000-000000000004', 'INR', date '2022-02-01', 'Painting', 1000000, false,
   'd4000000-0000-4000-8000-0000000000b1');

insert into public.property_valuation
  (id, household_id, property_id, currency, as_of_date, value_minor, basis, created_by) values
  ('c4b00000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-0000000000f1',
   'b4000000-0000-4000-8000-000000000001', 'INR', date '2026-04-01', 1100000000, 'broker',
   'd4000000-0000-4000-8000-0000000000a1'),
  ('c4b00000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-0000000000f1',
   'b4000000-0000-4000-8000-000000000002', 'INR', date '2026-04-01', 900000000, 'own_estimate',
   'd4000000-0000-4000-8000-0000000000a2'),
  ('c4b00000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-0000000000f1',
   'b4000000-0000-4000-8000-000000000003', 'INR', date '2026-04-01', 450000000, 'circle_rate',
   'd4000000-0000-4000-8000-0000000000a3'),
  ('c4b00000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-0000000000f2',
   'b4000000-0000-4000-8000-000000000004', 'INR', date '2026-04-01', 950000000, 'registered',
   'd4000000-0000-4000-8000-0000000000b1');

-- ============================================ the owner: the shared ones (7)

set local role authenticated;
set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.property),
  2,
  'the owner reads the two shared properties, and not the partner''s personal house'
);

select is_empty(
  $q$ select id from public.property where id = 'b4000000-0000-4000-8000-000000000002' $q$,
  'a personal property is not the owner''s to read'
);

select is_empty(
  $q$ select id from public.property where id = 'b4000000-0000-4000-8000-000000000004' $q$,
  'and nothing of another household''s'
);

select is(
  (select count(*)::int from public.property_improvement),
  2,
  'the owner reads the work done on the two shared properties and not on the personal one: the property''s rule, asked'
);

select is(
  (select count(*)::int from public.property_valuation),
  2,
  'and the valuations of the same two'
);

select lives_ok(
  $q$ insert into public.property_valuation
        (household_id, property_id, currency, as_of_date, value_minor, basis)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000001',
              'INR', date '2026-10-01', 1150000000, 'registered') $q$,
  'the owner records a valuation of their own shared property'
);

select throws_ok(
  $q$ insert into public.property_improvement
        (household_id, property_id, currency, work_date, description, amount_minor, is_capital)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000002',
              'INR', date '2026-01-01', 'Roof', 100, true) $q$,
  '42501'::char(5),
  null::text,
  'but cannot record work on the partner''s personal property, which they cannot read'
);

-- ============================================================ the partner (2)

set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.property),
  3,
  'the partner reads the two shared properties and their own personal house'
);

select is(
  (select count(*)::int from public.property_valuation),
  4,
  'and every valuation of those three, the one the owner just recorded included'
);

-- ================================================ the contributor: their own (7)

set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.property),
  1,
  'a contributor reads only their own property'
);

select is(
  (select count(*)::int from public.property_improvement),
  1,
  'and only the work done on it'
);

select lives_ok(
  $q$ insert into public.property_improvement
        (household_id, property_id, currency, work_date, description, amount_minor, is_capital)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000003',
              'INR', date '2026-03-01', 'Borewell', 8000000, true) $q$,
  'a contributor records work on their own property'
);

select throws_ok(
  $q$ insert into public.property_improvement
        (household_id, property_id, currency, work_date, description, amount_minor, is_capital)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000001',
              'INR', date '2026-03-01', 'Balcony', 100, true) $q$,
  '42501'::char(5),
  null::text,
  'but not on the owner''s shared apartment, which they cannot read'
);

with attempted as (
  update public.property set label = 'Renamed' where id = 'b4000000-0000-4000-8000-000000000001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'nor rename it'
);

select throws_ok(
  $q$ insert into public.property
        (household_id, member_id, kind, label, currency, purchase_date, purchase_cost_minor)
      values ('e4000000-0000-4000-8000-0000000000f1', 'f4000000-0000-4000-8000-0000000000a2',
              'land', 'Filed under the partner', 'INR', date '2024-01-01', 100) $q$,
  '42501'::char(5),
  null::text,
  'and cannot file a property under somebody else''s name'
);

select lives_ok(
  $q$ insert into public.property
        (household_id, member_id, kind, label, currency, purchase_date, purchase_cost_minor)
      values ('e4000000-0000-4000-8000-0000000000f1', 'f4000000-0000-4000-8000-0000000000a3',
              'land', 'Their second plot', 'INR', date '2024-01-01', 100) $q$,
  'while a property under their own name is theirs to file'
);

-- ============================================================ the viewer (3)

set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id::text from public.property
      union all select id::text from public.property_improvement
      union all select id::text from public.property_valuation $q$,
  'a viewer reads no property, no work and no valuation: a summary is the whole of what they are given'
);

select throws_ok(
  $q$ insert into public.property
        (household_id, member_id, kind, label, currency, purchase_date, purchase_cost_minor)
      values ('e4000000-0000-4000-8000-0000000000f1', 'f4000000-0000-4000-8000-0000000000a4',
              'land', 'A viewer''s plot', 'INR', date '2024-01-01', 100) $q$,
  '42501'::char(5),
  null::text,
  'and cannot record one'
);

select throws_ok(
  $q$ delete from public.property $q$,
  '42501'::char(5),
  null::text,
  'nobody can delete a property: it is archived, and the audit log keeps the version a correction replaced'
);

-- ======================================================= a password alone (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select id from public.property $q$,
  'a session with a password but no second factor reads no property'
);

-- ============================================= the audit rows are as private (3)
--
-- They carry the cost and the value in full. A property's own row states its visibility and member; the work and the
-- valuations name a property_id, and are readable only by whoever can read that property.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'property_valuation'
        and after ->> 'property_id' = 'b4000000-0000-4000-8000-000000000002' $q$,
  'the owner does not read the audit row for a valuation of the partner''s personal house, its value inside it'
);

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'property' and entity_id = 'b4000000-0000-4000-8000-000000000002' $q$,
  'nor the audit row for the personal house itself'
);

select isnt_empty(
  $q$ select id from public.audit_log
      where entity = 'property_valuation'
        and after ->> 'property_id' = 'b4000000-0000-4000-8000-000000000001' $q$,
  'while the audit row for a shared property''s valuation is readable: the log is not switched off'
);

-- ========================================= malformed rows are refused by the table (10)
--
-- As the owner of the tables, which is how a migration would write one. A check or a key applies to everybody, so
-- this is the refusal a client would meet.

reset role;

select throws_ok(
  $q$ update public.property set co_owner_share_pct = 0 where id = 'b4000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5),
  null::text,
  'a share of nothing is refused'
);

select throws_ok(
  $q$ update public.property set co_owner_share_pct = 100.01 where id = 'b4000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5),
  null::text,
  'and a share of more than all of it'
);

select throws_ok(
  $q$ update public.property set purchase_cost_minor = -1 where id = 'b4000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5),
  null::text,
  'a negative cost is refused'
);

select throws_ok(
  $q$ update public.property set kind = 'castle' where id = 'b4000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5),
  null::text,
  'a kind that is not one of the five is refused'
);

select throws_ok(
  $q$ update public.property set status = 'archived' where id = 'b4000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5),
  null::text,
  'archived with no time archived is refused: the two say the same thing or neither'
);

select throws_ok(
  $q$ insert into public.property_improvement
        (household_id, property_id, currency, work_date, description, amount_minor, is_capital, created_by)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000001',
              'INR', date '2026-01-01', 'Nothing', 0, true, 'd4000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5),
  null::text,
  'work of no cost is refused'
);

select throws_ok(
  $q$ insert into public.property_improvement
        (household_id, property_id, currency, work_date, description, amount_minor, is_capital, created_by)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000001',
              'USD', date '2026-01-01', 'Dollars', 100, true, 'd4000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5),
  null::text,
  'work in another currency than the property is refused: the key is the property and its currency'
);

select throws_ok(
  $q$ insert into public.property_valuation
        (household_id, property_id, currency, as_of_date, value_minor, basis, created_by)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000001',
              'INR', date '2026-12-01', 100, 'guess', 'd4000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5),
  null::text,
  'a valuation basis that is not one of the four is refused'
);

select throws_ok(
  $q$ insert into public.property_valuation
        (household_id, property_id, currency, as_of_date, value_minor, basis, created_by)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000001',
              'INR', date '2026-04-01', 100, 'broker', 'd4000000-0000-4000-8000-0000000000a1') $q$,
  '23505'::char(5),
  null::text,
  'two estimates for one day are refused: a misread one is corrected in place'
);

select throws_ok(
  $q$ update public.property set linked_liability_id = 'a4000000-0000-4000-8000-000000000002'
       where id = 'b4000000-0000-4000-8000-000000000001' $q$,
  '23503'::char(5),
  null::text,
  'a home loan from another household is refused'
);

-- ============================================================ the setting (3)

select is(
  (select property_valuation_stale_months::int from public.household
    where id = 'e4000000-0000-4000-8000-0000000000f1'),
  12,
  'a valuation is stale after twelve months unless the household says otherwise'
);

select throws_ok(
  $q$ update public.household set property_valuation_stale_months = 0
       where id = 'e4000000-0000-4000-8000-0000000000f1' $q$,
  '23514'::char(5),
  null::text,
  'a household cannot say no months'
);

select throws_ok(
  $q$ update public.household set property_valuation_stale_months = 121
       where id = 'e4000000-0000-4000-8000-0000000000f1' $q$,
  '23514'::char(5),
  null::text,
  'nor more than ten years'
);

select * from finish();

rollback;
