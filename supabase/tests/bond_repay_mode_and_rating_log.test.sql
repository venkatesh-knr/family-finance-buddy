-- Family Finance Buddy — a bond's rating log, and what a repay mode may be.
--
-- The log is the point: "rating changes are logged so a downgrade doesn't pass
-- unnoticed", and a log somebody can edit does not do that. So the first assertions
-- are about who cannot write it. Nobody inserts, updates or deletes a row; only the
-- trigger on the terms does, and it writes one row for each change and none for a
-- save that changed nothing.
--
-- It hangs off the holding and is as private as it is, so the second set is the
-- usual one: an owner does not read a partner's personal bond's log, a contributor
-- reads only their own, a viewer none, and a session with only a password none.
--
-- The last four are the repay mode: only a bond has one, and only two values exist.
--
-- Ratings themselves are data, and belong to the agencies; none is asserted.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(23);

-- ============================================================== the fixture
--
--   owner        a shared bond (h1), rated, and a deposit (h5)
--   partner      a personal bond (h2), rated
--   contributor  a shared bond of their own (h3), rated
--   viewer       nothing
--   stranger     another household's bond (h4)
--   h9           the owner's bond whose repay mode is changed below

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@rating.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@rating.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@rating.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@rating.test', 'not-a-real-hash',
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
  ('e4000000-0000-4000-8000-0000000000f1', 'Household H', 'demo'),
  ('e4000000-0000-4000-8000-0000000000f2', 'Household I', 'demo');

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

insert into public.instrument
  (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset) values
  ('a4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-0000000000f1', 'Bond one',   'bond',    'INR', 'INR', false),
  ('a4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-0000000000f1', 'Bond two',   'bond',    'INR', 'INR', false),
  ('a4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-0000000000f1', 'Bond three', 'bond',    'INR', 'INR', false),
  ('a4000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-0000000000f2', 'Bond four',  'bond',    'INR', 'INR', false),
  ('a4000000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-0000000000f1', 'FD five',    'deposit', 'INR', 'INR', false),
  ('a4000000-0000-4000-8000-000000000009', 'e4000000-0000-4000-8000-0000000000f1', 'Bond nine',  'bond',    'INR', 'INR', false);

insert into public.holding
  (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a1', 'a4000000-0000-4000-8000-000000000001', 1, 'household'),
  ('b4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a2', 'a4000000-0000-4000-8000-000000000002', 1, 'personal'),
  ('b4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a3', 'a4000000-0000-4000-8000-000000000003', 1, 'household'),
  ('b4000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-0000000000f2',
   'f4000000-0000-4000-8000-0000000000b1', 'a4000000-0000-4000-8000-000000000004', 1, 'household'),
  ('b4000000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a1', 'a4000000-0000-4000-8000-000000000005', 1, 'household'),
  ('b4000000-0000-4000-8000-000000000009', 'e4000000-0000-4000-8000-0000000000f1',
   'f4000000-0000-4000-8000-0000000000a1', 'a4000000-0000-4000-8000-000000000009', 1, 'household');

-- Each rated bond's terms, inserted as the migration owner: the trigger writes the
-- first row of each bond's log, "the rating as first recorded".
insert into public.fixed_income_terms
  (holding_id, household_id, kind, principal_minor, currency, rate_pct, start_date, maturity_date,
   compounding, coupon_frequency, rating, created_by) values
  ('b4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-0000000000f1', 'bond',
   10000000, 'INR', 10.750, date '2026-01-01', date '2029-01-01', null, 'yearly', 'CRISIL AA',
   'd4000000-0000-4000-8000-0000000000a1'),
  ('b4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-0000000000f1', 'bond',
   20000000, 'INR', 11.500, date '2026-01-01', date '2029-01-01', null, 'monthly', 'CARE A',
   'd4000000-0000-4000-8000-0000000000a2'),
  ('b4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-0000000000f1', 'bond',
   30000000, 'INR', 9.500, date '2026-01-01', date '2029-01-01', null, 'half_yearly', 'ICRA A+',
   'd4000000-0000-4000-8000-0000000000a3'),
  ('b4000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-0000000000f2', 'bond',
   40000000, 'INR', 9.000, date '2026-01-01', date '2029-01-01', null, 'yearly', 'CRISIL A',
   'd4000000-0000-4000-8000-0000000000b1'),
  ('b4000000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-0000000000f1', 'deposit',
   50000000, 'INR', 7.000, date '2026-01-01', date '2027-01-01', 'yearly', null, null,
   'd4000000-0000-4000-8000-0000000000a1'),
  ('b4000000-0000-4000-8000-000000000009', 'e4000000-0000-4000-8000-0000000000f1', 'bond',
   60000000, 'INR', 8.000, date '2026-01-01', date '2029-01-01', null, 'yearly', null,
   'd4000000-0000-4000-8000-0000000000a1');

-- ===================================== the owner: the shared bonds, and no writes (9)

set local role authenticated;
set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.bond_rating_change),
  2,
  'the owner reads the first row of the log of each shared bond, and not the partner''s personal one'
);

select is_empty(
  $q$ select id from public.bond_rating_change
      where holding_id = 'b4000000-0000-4000-8000-000000000002' $q$,
  'a personal bond''s log is not the owner''s to read, the rule the holding states'
);

select is_empty(
  $q$ select id from public.bond_rating_change
      where holding_id = 'b4000000-0000-4000-8000-000000000004' $q$,
  'and nothing of another household''s'
);

select throws_ok(
  $q$ insert into public.bond_rating_change
        (household_id, holding_id, from_rating, to_rating, changed_on)
      values ('e4000000-0000-4000-8000-0000000000f1', 'b4000000-0000-4000-8000-000000000001',
              'CRISIL AA', 'CRISIL AAA', date '2026-06-01') $q$,
  '42501'::char(5),
  null::text,
  'nobody inserts a row of the log: a made-up upgrade, or a downgrade filed as one, is not possible'
);

select throws_ok(
  $q$ update public.bond_rating_change set to_rating = 'CRISIL AAA' $q$,
  '42501'::char(5),
  null::text,
  'nobody updates one, so a downgrade cannot be edited into something milder'
);

select throws_ok(
  $q$ delete from public.bond_rating_change $q$,
  '42501'::char(5),
  null::text,
  'nobody deletes one, so a downgrade cannot be tidied away'
);

-- A change to the rating on the terms is the only way a row is written.
select lives_ok(
  $q$ update public.fixed_income_terms set rating = 'CRISIL A'
       where holding_id = 'b4000000-0000-4000-8000-000000000001' $q$,
  'the owner changes the rating of their bond, as a correction in place'
);

select is(
  (select from_rating || ' > ' || to_rating from public.bond_rating_change
    where holding_id = 'b4000000-0000-4000-8000-000000000001'
    order by id desc limit 1),
  'CRISIL AA > CRISIL A',
  'and the log has the change, from what it was to what it is'
);

select lives_ok(
  $q$ update public.fixed_income_terms set rating = 'CRISIL A', note = 'saved again'
       where holding_id = 'b4000000-0000-4000-8000-000000000001' $q$,
  'saving the terms again with the same rating'
);

-- ============================================ a save that changed nothing, and a removal (3)

select is(
  (select count(*)::int from public.bond_rating_change
    where holding_id = 'b4000000-0000-4000-8000-000000000001'),
  2,
  'writes no row: the log has a first rating and one change, and nothing for a save that changed nothing'
);

select lives_ok(
  $q$ update public.fixed_income_terms set rating = null
       where holding_id = 'b4000000-0000-4000-8000-000000000001' $q$,
  'a rating can be removed'
);

select is(
  (select to_rating from public.bond_rating_change
    where holding_id = 'b4000000-0000-4000-8000-000000000001'
    order by id desc limit 1),
  null::text,
  'and the removal is in the log as a change to nothing, not lost'
);

-- ===================================================== the audit rows are as private (1)

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'bond_rating_change'
        and after ->> 'holding_id' = 'b4000000-0000-4000-8000-000000000002' $q$,
  'the owner does not read the audit row for the partner''s personal bond''s log'
);

-- ============================================================ the partner (1)

set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.bond_rating_change),
  5,
  'the partner reads the shared bonds'' logs (three rows for the first, one for the third) and their own personal one'
);

-- ====================================================== the contributor: their own (3)

set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.bond_rating_change),
  1,
  'a contributor reads only the log of their own bond'
);

with attempted as (
  update public.fixed_income_terms set rating = 'CRISIL AAA'
   where holding_id = 'b4000000-0000-4000-8000-000000000001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'and cannot change the rating of a bond they cannot read, which would write a row of someone else''s log'
);

select is_empty(
  $q$ select id from public.bond_rating_change
      where holding_id = 'b4000000-0000-4000-8000-000000000001' $q$,
  'nor read it'
);

-- ============================================================= the viewer (1)

set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.bond_rating_change $q$,
  'a viewer reads no log: a summary is the whole of what they are given'
);

-- ======================================================= a password alone (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c4000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c4000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select id from public.bond_rating_change $q$,
  'a session with a password but no second factor reads no log'
);

-- ============================================= the repay mode, as the table owner (4)
--
-- A check constraint applies to everybody, so this is the refusal a client would meet.

reset role;

select throws_ok(
  $q$ update public.fixed_income_terms set repay_mode = 'cumulative'
       where holding_id = 'b4000000-0000-4000-8000-000000000005' $q$,
  '23514'::char(5),
  null::text,
  'a deposit has no repay mode: it has its own compounding, and two answers to one question are refused'
);

select throws_ok(
  $q$ update public.fixed_income_terms set repay_mode = 'monthly'
       where holding_id = 'b4000000-0000-4000-8000-000000000009' $q$,
  '23514'::char(5),
  null::text,
  'and a bond''s repay mode is payout or cumulative, not a frequency'
);

select lives_ok(
  $q$ update public.fixed_income_terms set repay_mode = 'cumulative'
       where holding_id = 'b4000000-0000-4000-8000-000000000009' $q$,
  'a bond can be cumulative'
);

select is(
  (select repay_mode from public.fixed_income_terms
    where holding_id = 'b4000000-0000-4000-8000-000000000009'),
  'cumulative',
  'and it says so; a bond recorded before this existed has none, which means payout'
);

select * from finish();

rollback;
