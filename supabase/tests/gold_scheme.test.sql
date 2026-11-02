-- Family Finance Buddy — gold: who reads a jeweller's scheme, who writes it, what shape it may have.
--
-- A scheme's terms are as private as the holding they hang off: an owner does not read a partner's personal scheme, a contributor
-- reads only their own, a viewer reads none. They do not state that themselves; they ask the holding's own policy, and the first
-- blocks are the proof that they do. No client deletes a scheme, and a session with only a password reads and writes none.
--
-- The last blocks are the shape (gold.md, GD-I1): a gold instrument has a form and nothing else has one, a scheme belongs to a
-- jeweller's-scheme holding only, a weight scheme names a purity, and the scheme number keeps its last four.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(27);

-- ============================================================== the fixture
--
--   owner        a shared scheme (h1)
--   partner      a personal scheme (h2)
--   contributor  a shared scheme of their own (h3)
--   viewer       nothing
--   stranger     another household's scheme (h4)

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@gold.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@gold.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@gold.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@gold.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c7000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd7000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c7000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd7000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c7000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd7000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c7000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd7000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c7000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd7000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c7000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e7000000-0000-4000-8000-0000000000f1', 'Household G', 'demo'),
  ('e7000000-0000-4000-8000-0000000000f2', 'Household H', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f7000000-0000-4000-8000-0000000000a1', 'e7000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f7000000-0000-4000-8000-0000000000a2', 'e7000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f7000000-0000-4000-8000-0000000000a3', 'e7000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f7000000-0000-4000-8000-0000000000a4', 'e7000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d7000000-0000-4000-8000-0000000000a1', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d7000000-0000-4000-8000-0000000000a2', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d7000000-0000-4000-8000-0000000000a3', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d7000000-0000-4000-8000-0000000000a4', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000f2',
   'f7000000-0000-4000-8000-0000000000b1', 'owner');

insert into public.instrument
  (id, household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset) values
  ('a7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'Scheme one',   'gold', 'jeweller_scheme', 'INR', 'INR', false),
  ('a7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-0000000000f1', 'Scheme two',   'gold', 'jeweller_scheme', 'INR', 'INR', false),
  ('a7000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-0000000000f1', 'Scheme three', 'gold', 'jeweller_scheme', 'INR', 'INR', false),
  ('a7000000-0000-4000-8000-000000000004', 'e7000000-0000-4000-8000-0000000000f2', 'Scheme four',  'gold', 'jeweller_scheme', 'INR', 'INR', false),
  ('a7000000-0000-4000-8000-000000000008', 'e7000000-0000-4000-8000-0000000000f1', 'Bars',         'gold', 'physical',        'INR', 'INR', false),
  ('a7000000-0000-4000-8000-000000000009', 'e7000000-0000-4000-8000-0000000000f1', 'A fund',       'mutual_fund', null,       'INR', 'INR', false);

insert into public.holding
  (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-000000000001', 1, 'household'),
  ('b7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a2', 'a7000000-0000-4000-8000-000000000002', 1, 'personal'),
  ('b7000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a3', 'a7000000-0000-4000-8000-000000000003', 1, 'household'),
  ('b7000000-0000-4000-8000-000000000004', 'e7000000-0000-4000-8000-0000000000f2',
   'f7000000-0000-4000-8000-0000000000b1', 'a7000000-0000-4000-8000-000000000004', 1, 'household'),
  ('b7000000-0000-4000-8000-000000000008', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-000000000008', 50, 'household'),
  ('b7000000-0000-4000-8000-000000000009', 'e7000000-0000-4000-8000-0000000000f1',
   'f7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-000000000009', 10, 'household');

insert into public.gold_scheme_terms
  (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day, created_by) values
  ('b7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'Jeweller one',
   500000, 'INR', 11, date '2026-06-10', 10, 'd7000000-0000-4000-8000-0000000000a1'),
  ('b7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'Jeweller two',
   300000, 'INR', 11, date '2026-06-10', 10, 'd7000000-0000-4000-8000-0000000000a2'),
  ('b7000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'Jeweller three',
   200000, 'INR', 11, date '2026-06-10', 10, 'd7000000-0000-4000-8000-0000000000a3'),
  ('b7000000-0000-4000-8000-000000000004', 'e7000000-0000-4000-8000-0000000000f2', 'amount', 'Jeweller four',
   100000, 'INR', 11, date '2026-06-10', 10, 'd7000000-0000-4000-8000-0000000000b1');

-- ============================================ the owner: the shared ones (6)

set local role authenticated;
set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_scheme_terms),
  2,
  'the owner reads the two shared schemes, and not the partner''s personal one'
);

select is_empty(
  $q$ select holding_id from public.gold_scheme_terms where holding_id = 'b7000000-0000-4000-8000-000000000002' $q$,
  'a personal scheme is not the owner''s to read, the rule the holding states'
);

select is_empty(
  $q$ select holding_id from public.gold_scheme_terms where holding_id = 'b7000000-0000-4000-8000-000000000004' $q$,
  'and nothing of another household''s'
);

select lives_ok(
  $q$ update public.gold_scheme_terms set note = 'checked' where holding_id = 'b7000000-0000-4000-8000-000000000001' $q$,
  'the owner corrects their own scheme'
);

with attempted as (
  update public.gold_scheme_terms set note = 'mine now' where holding_id = 'b7000000-0000-4000-8000-000000000002'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'but cannot rewrite the partner''s personal one, which they cannot read'
);

select throws_ok(
  $q$ delete from public.gold_scheme_terms where holding_id = 'b7000000-0000-4000-8000-000000000001' $q$,
  '42501'::char(5),
  null::text,
  'nobody deletes a scheme: no client has the grant'
);

-- ============================================================ the partner (2)

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_scheme_terms),
  3,
  'the partner reads the two shared schemes and their own personal one'
);

select is(
  (select count(*)::int from public.gold_scheme_terms where household_id = 'e7000000-0000-4000-8000-0000000000f2'),
  0,
  'and none of another household''s'
);

-- ================================================ the contributor: their own (4)

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_scheme_terms),
  1,
  'a contributor reads only their own scheme'
);

select lives_ok(
  $q$ update public.gold_scheme_terms set jeweller = 'Jeweller three, renamed' where holding_id = 'b7000000-0000-4000-8000-000000000003' $q$,
  'and corrects it'
);

with attempted as (
  update public.gold_scheme_terms set jeweller = 'Renamed' where holding_id = 'b7000000-0000-4000-8000-000000000001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'but not the owner''s shared scheme, which they cannot read'
);

select throws_ok(
  $q$ insert into public.gold_scheme_terms (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day)
      values ('b7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'X', 100, 'INR', 11, date '2026-06-10', 10) $q$,
  '42501'::char(5),
  null::text,
  'nor adds terms to a holding that is not theirs to read'
);

-- ===================================================================== the viewer (2)

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_scheme_terms),
  0,
  'a viewer reads no scheme'
);

select throws_ok(
  $q$ insert into public.gold_scheme_terms (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day)
      values ('b7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'X', 100, 'INR', 11, date '2026-06-10', 10) $q$,
  '42501'::char(5),
  null::text,
  'and writes none'
);

-- ================================================================= no second factor (2)

set local request.jwt.claim.sub to 'c7000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c7000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is(
  (select count(*)::int from public.gold_scheme_terms),
  0,
  'a session with only a password reads no scheme'
);

with attempted as (
  update public.gold_scheme_terms set note = 'x' where holding_id = 'b7000000-0000-4000-8000-000000000001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'and changes none'
);

-- ================================================================= the shape (9)

set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, currency, exposure_currency, is_foreign_asset)
      values ('e7000000-0000-4000-8000-0000000000f1', 'No form', 'gold', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'GD-I1 — a gold instrument has a form'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset)
      values ('e7000000-0000-4000-8000-0000000000f1', 'A fund with a form', 'mutual_fund', 'physical', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'GD-I1 — and nothing else has one'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset)
      values ('e7000000-0000-4000-8000-0000000000f1', 'A bad form', 'gold', 'digital', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'and the form is one of the two the design names'
);

select throws_ok(
  $q$ insert into public.gold_scheme_terms (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day)
      values ('b7000000-0000-4000-8000-000000000009', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'X', 100, 'INR', 11, date '2026-06-10', 10) $q$,
  '23514'::char(5),
  null::text,
  'a scheme belongs to a gold holding: not to a fund'
);

select throws_ok(
  $q$ insert into public.gold_scheme_terms (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day)
      values ('b7000000-0000-4000-8000-000000000008', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'X', 100, 'INR', 11, date '2026-06-10', 10) $q$,
  '23514'::char(5),
  null::text,
  'nor to physical gold, which has no instalments'
);

select lives_ok(
  $q$ insert into public.instrument (id, household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset)
      values ('a7000000-0000-4000-8000-000000000011', 'e7000000-0000-4000-8000-0000000000f1', 'Weight scheme', 'gold', 'jeweller_scheme', 'INR', 'INR', false) $q$,
  'a second scheme''s instrument is made, to test a weight scheme on'
);

select lives_ok(
  $q$ insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility)
      values ('b7000000-0000-4000-8000-000000000011', 'e7000000-0000-4000-8000-0000000000f1',
              'f7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-000000000011', 1, 'household') $q$,
  'and its holding'
);

select throws_ok(
  $q$ insert into public.gold_scheme_terms (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day)
      values ('b7000000-0000-4000-8000-000000000011', 'e7000000-0000-4000-8000-0000000000f1', 'weight', 'X', 100, 'INR', 11, date '2026-06-10', 10) $q$,
  '23514'::char(5),
  null::text,
  'a weight scheme names a purity, since it is valued at a rate for one'
);

select throws_ok(
  $q$ insert into public.gold_scheme_terms (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day, scheme_last4)
      values ('b7000000-0000-4000-8000-000000000011', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'X', 100, 'INR', 11, date '2026-06-10', 10, '12345678') $q$,
  '23514'::char(5),
  null::text,
  'GD-I7 — a scheme number keeps its last four and no more'
);

select throws_ok(
  $q$ insert into public.gold_scheme_terms (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day)
      values ('b7000000-0000-4000-8000-000000000011', 'e7000000-0000-4000-8000-0000000000f1', 'amount', 'X', 100, 'INR', 11, date '2026-06-10', 29) $q$,
  '23514'::char(5),
  null::text,
  'a due day exists in every month: 1 to 28'
);

-- ============================================================ the log (1)

reset role;

select is(
  (select count(*)::int from public.audit_log where entity = 'gold_scheme_terms' and action = 'update'),
  2,
  'what was changed in a scheme is in the audit log: the owner''s correction and the contributor''s'
);

select * from finish();

rollback;
