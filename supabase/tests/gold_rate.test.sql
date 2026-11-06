-- Family Finance Buddy — gold: the household's typed rate, and the shape of a gold instrument.
--
-- The rate (GD-I12) is read by everyone in the household and typed by an owner or a partner alone. It is appended and never edited or
-- removed, so no role has an update or a delete: each is proved denied for each role, and across households. A session with only a
-- password reads and writes none.
--
-- The last blocks are the shape (gold.md, GD-I1): a gold instrument has a form, and nothing else has one; physical gold names a
-- purity, and nothing else does; the jeweller's scheme is no longer a form.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(38);

-- ============================================================== the fixture
--
--   owner, partner, contributor, viewer   one household (F1)
--   stranger                              another (F2)

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@goldrate.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@goldrate.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@goldrate.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@goldrate.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e8000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e8000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f8000000-0000-4000-8000-0000000000a2', 'e8000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f8000000-0000-4000-8000-0000000000a3', 'e8000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f8000000-0000-4000-8000-0000000000a4', 'e8000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-0000000000f1',
   'f8000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d8000000-0000-4000-8000-0000000000a2', 'e8000000-0000-4000-8000-0000000000f1',
   'f8000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d8000000-0000-4000-8000-0000000000a3', 'e8000000-0000-4000-8000-0000000000f1',
   'f8000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d8000000-0000-4000-8000-0000000000a4', 'e8000000-0000-4000-8000-0000000000f1',
   'f8000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-0000000000f2',
   'f8000000-0000-4000-8000-0000000000b1', 'owner');

insert into public.gold_rate (id, household_id, purity, rate_per_gram_minor, currency, as_at, created_by) values
  ('a8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', '22k', 1090000, 'INR', date '2026-09-01',
   'd8000000-0000-4000-8000-0000000000a1'),
  ('a8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f2', '22k', 1000000, 'INR', date '2026-09-01',
   'd8000000-0000-4000-8000-0000000000b1');

-- ============================================================== the owner (7)

set local role authenticated;
set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_rate),
  1,
  'the owner reads their household''s rate, and not another household''s'
);

select lives_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 1155000, date '2026-11-05') $q$,
  'the owner types a rate'
);

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f2', '22k', 1155000, date '2026-11-05') $q$,
  '42501'::char(5),
  null::text,
  'but not into another household'
);

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at, created_by)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 1155000, date '2026-11-05', 'd8000000-0000-4000-8000-0000000000a2') $q$,
  '42501'::char(5),
  null::text,
  'nor under somebody else''s name'
);

select throws_ok(
  $q$ update public.gold_rate set rate_per_gram_minor = 1 where id = 'a8000000-0000-4000-8000-000000000001' $q$,
  '42501'::char(5),
  null::text,
  'GD-I12 — the owner cannot change a rate: there is no update'
);

select throws_ok(
  $q$ delete from public.gold_rate where id = 'a8000000-0000-4000-8000-000000000001' $q$,
  '42501'::char(5),
  null::text,
  'GD-I12 — or remove one: there is no delete'
);

-- A correction is a later row, and a value uses the latest on or before its date.
select lives_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 1170000, date '2026-11-07') $q$,
  'a corrected rate is a new row, dated'
);

-- ============================================================ the partner (4)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_rate),
  3,
  'the partner reads every rate the household has typed, the earlier ones too'
);

select lives_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '24k', 1260000, date '2026-11-05') $q$,
  'and types a rate of their own'
);

select throws_ok(
  $q$ update public.gold_rate set rate_per_gram_minor = 1 where household_id = 'e8000000-0000-4000-8000-0000000000f1' $q$,
  '42501'::char(5),
  null::text,
  'but changes none'
);

select throws_ok(
  $q$ delete from public.gold_rate where household_id = 'e8000000-0000-4000-8000-0000000000f1' $q$,
  '42501'::char(5),
  null::text,
  'and removes none'
);

-- ======================================================== the contributor (4)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_rate),
  4,
  'a contributor reads the household''s rates: it is what their gold is valued at'
);

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 1155000, date '2026-11-05') $q$,
  '42501'::char(5),
  null::text,
  'but types none'
);

select throws_ok(
  $q$ update public.gold_rate set rate_per_gram_minor = 1 where household_id = 'e8000000-0000-4000-8000-0000000000f1' $q$,
  '42501'::char(5),
  null::text,
  'changes none'
);

select throws_ok(
  $q$ delete from public.gold_rate where household_id = 'e8000000-0000-4000-8000-0000000000f1' $q$,
  '42501'::char(5),
  null::text,
  'and removes none'
);

-- ============================================================== the viewer (4)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_rate),
  4,
  'a viewer reads the household''s rates'
);

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 1155000, date '2026-11-05') $q$,
  '42501'::char(5),
  null::text,
  'but types none'
);

select throws_ok(
  $q$ update public.gold_rate set rate_per_gram_minor = 1 where household_id = 'e8000000-0000-4000-8000-0000000000f1' $q$,
  '42501'::char(5),
  null::text,
  'changes none'
);

select throws_ok(
  $q$ delete from public.gold_rate where household_id = 'e8000000-0000-4000-8000-0000000000f1' $q$,
  '42501'::char(5),
  null::text,
  'and removes none'
);

-- ============================================================ the stranger (5)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.gold_rate),
  1,
  'an owner elsewhere reads their own household''s rate only'
);

select is(
  (select count(*)::int from public.gold_rate where household_id = 'e8000000-0000-4000-8000-0000000000f1'),
  0,
  'and none of the first household''s'
);

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 1, date '2026-11-05') $q$,
  '42501'::char(5),
  null::text,
  'types none into it'
);

select throws_ok(
  $q$ update public.gold_rate set rate_per_gram_minor = 1 where household_id = 'e8000000-0000-4000-8000-0000000000f1' $q$,
  '42501'::char(5),
  null::text,
  'changes none of it'
);

select throws_ok(
  $q$ delete from public.gold_rate where household_id = 'e8000000-0000-4000-8000-0000000000f1' $q$,
  '42501'::char(5),
  null::text,
  'and removes none of it'
);

-- ================================================================= no second factor (2)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is(
  (select count(*)::int from public.gold_rate),
  0,
  'a session with only a password reads no rate'
);

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 1155000, date '2026-11-05') $q$,
  '42501'::char(5),
  null::text,
  'and types none'
);

-- ================================================================= the rate, as a value reads it (2)

set local request.jwt.claims to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select rate_per_gram_minor from public.gold_rate
    where household_id = 'e8000000-0000-4000-8000-0000000000f1' and purity = '22k' and as_at <= date '2026-11-06'
    order by as_at desc, created_at desc limit 1),
  1155000::bigint,
  'GD-I12 — on 6 November the latest 22K rate on or before that day is the one dated 5 November'
);

select is(
  (select rate_per_gram_minor from public.gold_rate
    where household_id = 'e8000000-0000-4000-8000-0000000000f1' and purity = '22k' and as_at <= date '2026-11-08'
    order by as_at desc, created_at desc limit 1),
  1170000::bigint,
  'and on 8 November it is the later one, with the earlier still there'
);

-- ================================================================= the shape of a rate (3)

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '20k', 1155000, date '2026-11-05') $q$,
  '23514'::char(5),
  null::text,
  'a purity is 24K, 22K or 18K'
);

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 0, date '2026-11-05') $q$,
  '23514'::char(5),
  null::text,
  'a rate is above nothing'
);

select throws_ok(
  $q$ insert into public.gold_rate (household_id, purity, rate_per_gram_minor, currency, as_at)
      values ('e8000000-0000-4000-8000-0000000000f1', '22k', 1155000, 'inr', date '2026-11-05') $q$,
  '23514'::char(5),
  null::text,
  'and carries a currency code'
);

-- ================================================================= the shape of a gold instrument (7)

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, currency, exposure_currency, is_foreign_asset)
      values ('e8000000-0000-4000-8000-0000000000f1', 'No form', 'gold', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'GD-I1 — a gold instrument has a form'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset)
      values ('e8000000-0000-4000-8000-0000000000f1', 'A fund with a form', 'mutual_fund', 'fund', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'GD-I1 — and nothing else has one'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset)
      values ('e8000000-0000-4000-8000-0000000000f1', 'A scheme', 'gold', 'jeweller_scheme', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'GD-I1 — a jeweller''s scheme is no longer a form of gold'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset)
      values ('e8000000-0000-4000-8000-0000000000f1', 'Bars, no purity', 'gold', 'physical', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'GD-I3 — physical gold names a purity, since it is valued at a rate for one'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, gold_form, gold_purity, currency, exposure_currency, is_foreign_asset)
      values ('e8000000-0000-4000-8000-0000000000f1', 'An ETF with a purity', 'gold', 'etf', '24k', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'and a fund, which holds whatever it holds, names none'
);

select lives_ok(
  $q$ insert into public.instrument (household_id, name, kind, gold_form, gold_purity, currency, exposure_currency, is_foreign_asset)
      values ('e8000000-0000-4000-8000-0000000000f1', 'A necklace', 'gold', 'physical', '22k', 'INR', 'INR', false) $q$,
  'physical gold with its purity is made'
);

select lives_ok(
  $q$ insert into public.instrument (household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset)
      values ('e8000000-0000-4000-8000-0000000000f1', 'A gold ETF', 'gold', 'etf', 'INR', 'INR', false) $q$,
  'and so is a gold ETF, with a form and no purity'
);

select * from finish();

rollback;
