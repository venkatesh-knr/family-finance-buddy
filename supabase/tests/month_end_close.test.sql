-- Family Finance Buddy — closing a month.
--
-- The job carries a reading that was taken to the month end, and values
-- nothing it was not told. Both halves need proving: that it carries, and
-- above all that it does NOT invent a figure for a holding nobody read, since
-- a fabricated reading is indistinguishable from a real one once written and
-- would corrupt the disclosure figure §606 exists to protect.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(11);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaa1111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'closer@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'bbbb2222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'viewer@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'cccc0000-0000-4000-8000-00000000ac01'
  where auth_user_id = 'aaaa1111-1111-4111-8111-111111111111';
update public.user_account set id = 'cccc0000-0000-4000-8000-00000000ac02'
  where auth_user_id = 'bbbb2222-2222-4222-8222-222222222222';

insert into public.household (id, name, kind) values
  ('dddd0000-0000-4000-8000-00000000d001', 'Closing house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('eeee0000-0000-4000-8000-00000000e001', 'dddd0000-0000-4000-8000-00000000d001', 'Owner', 'c1'),
  ('eeee0000-0000-4000-8000-00000000e002', 'dddd0000-0000-4000-8000-00000000d001', 'Looker', 'c2');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('cccc0000-0000-4000-8000-00000000ac01', 'dddd0000-0000-4000-8000-00000000d001',
   'eeee0000-0000-4000-8000-00000000e001', 'owner'),
  ('cccc0000-0000-4000-8000-00000000ac02', 'dddd0000-0000-4000-8000-00000000d001',
   'eeee0000-0000-4000-8000-00000000e002', 'viewer');

insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('ffff0000-0000-4000-8000-00000000f001', 'dddd0000-0000-4000-8000-00000000d001',
   'Read fund', 'mutual_fund', 'INR', 'INR'),
  ('ffff0000-0000-4000-8000-00000000f002', 'dddd0000-0000-4000-8000-00000000d001',
   'Unread fund', 'mutual_fund', 'INR', 'INR'),
  ('ffff0000-0000-4000-8000-00000000f003', 'dddd0000-0000-4000-8000-00000000d001',
   'Already read at month end', 'mutual_fund', 'INR', 'INR');

insert into public.holding (id, household_id, member_id, instrument_id, quantity) values
  ('a0a00000-0000-4000-8000-00000000b001', 'dddd0000-0000-4000-8000-00000000d001',
   'eeee0000-0000-4000-8000-00000000e001', 'ffff0000-0000-4000-8000-00000000f001', 10),
  ('a0a00000-0000-4000-8000-00000000b002', 'dddd0000-0000-4000-8000-00000000d001',
   'eeee0000-0000-4000-8000-00000000e001', 'ffff0000-0000-4000-8000-00000000f002', 20),
  ('a0a00000-0000-4000-8000-00000000b003', 'dddd0000-0000-4000-8000-00000000d001',
   'eeee0000-0000-4000-8000-00000000e001', 'ffff0000-0000-4000-8000-00000000f003', 30);

-- Read fund: two readings inside June, none at month end. The later one wins.
insert into public.valuation_snapshot
  (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by) values
  ('dddd0000-0000-4000-8000-00000000d001', 'a0a00000-0000-4000-8000-00000000b001',
   date '2026-06-08', 10, 100000, 'INR', 'manual', 'cccc0000-0000-4000-8000-00000000ac01'),
  ('dddd0000-0000-4000-8000-00000000d001', 'a0a00000-0000-4000-8000-00000000b001',
   date '2026-06-20', 10, 123400, 'INR', 'manual', 'cccc0000-0000-4000-8000-00000000ac01'),
  -- Already read on the last day. The job must leave it alone.
  ('dddd0000-0000-4000-8000-00000000d001', 'a0a00000-0000-4000-8000-00000000b003',
   date '2026-06-30', 30, 999900, 'INR', 'manual', 'cccc0000-0000-4000-8000-00000000ac01');
-- Unread fund gets nothing, on purpose.

-- ============================================== only the right roles (2)

set local role authenticated;
set local request.jwt.claim.sub to 'bbbb2222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select * from public.close_month('dddd0000-0000-4000-8000-00000000d001', date '2026-06-30') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot close a month'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'aaaa1111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

-- A month end is the last day of a month, not any day somebody fancies.
-- Closing "June" on the 17th would write a row dated the 17th and call it a
-- month-end figure, which is a wrong number wearing the right label.
select throws_ok(
  $q$ select * from public.close_month('dddd0000-0000-4000-8000-00000000d001', date '2026-06-17') $q$,
  '22023'::char(5),
  null::text,
  'a date that is not a month end is refused'
);

-- ==================================================== what it carries (5)

select is(
  (select carried from public.close_month('dddd0000-0000-4000-8000-00000000d001', date '2026-06-30')),
  1,
  'one reading is carried to the month end: the fund read mid-June'
);

select is(
  (select value_minor from public.valuation_snapshot
    where holding_id = 'a0a00000-0000-4000-8000-00000000b001' and as_of_date = date '2026-06-30'),
  123400::bigint,
  'and it is the LATEST in-month reading, not the first'
);

select is(
  (select source from public.valuation_snapshot
    where holding_id = 'a0a00000-0000-4000-8000-00000000b001' and as_of_date = date '2026-06-30'),
  'backfill',
  'marked backfill — a defensible approximation, visibly weaker than a reading taken on the day'
);

-- The one that matters most. A holding nobody read gets no row at all: the gap
-- is the truth, and a peak computed over it is honestly a lower bound.
select is_empty(
  $q$ select id from public.valuation_snapshot
       where holding_id = 'a0a00000-0000-4000-8000-00000000b002' $q$,
  'a holding nobody read is left unread — the job values nothing it was not told'
);

select is(
  (select unread from public.close_month('dddd0000-0000-4000-8000-00000000d001', date '2026-06-30')),
  1,
  'and it reports that one holding went unread, which is the number worth acting on'
);

-- ================================================== what it must not do (2)

select is(
  (select value_minor from public.valuation_snapshot
    where holding_id = 'a0a00000-0000-4000-8000-00000000b003' and as_of_date = date '2026-06-30'),
  999900::bigint,
  'a reading actually taken on the last day is not overwritten by a carried one'
);

select is(
  (select count(*)::int from public.valuation_snapshot
    where holding_id = 'a0a00000-0000-4000-8000-00000000b001' and as_of_date = date '2026-06-30'),
  1,
  'running the close twice adds nothing the second time'
);

-- ============================================== attribution is honest (2)

select is(
  (select created_by from public.valuation_snapshot
    where holding_id = 'a0a00000-0000-4000-8000-00000000b001' and as_of_date = date '2026-06-30'),
  'cccc0000-0000-4000-8000-00000000ac01'::uuid,
  'a person who closes the month is recorded as the author of what it wrote'
);

-- The system path writes no author at all, and the policy that lets it through
-- is the only way an unattributed row can be created. A signed-in caller
-- always has auth.uid(), so this policy can never be their route in.
reset role;
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename = 'valuation_snapshot'
      and policyname = 'valuation_snapshot_insert_by_the_close_job'
      and qual is null
      and with_check like '%auth.uid() IS NULL%'),
  1,
  'the system insert path exists and is gated on there being no session at all'
);

select * from finish();

rollback;
