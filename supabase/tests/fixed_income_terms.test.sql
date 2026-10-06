-- Family Finance Buddy — the terms of a deposit or a bond: who reads them, who
-- writes them, and what shape a row may have.
--
-- The terms hang off a holding the way a purchase does, so they are as private as
-- the holding: an owner does not read a partner's personal deposit, a contributor
-- reads only their own, a viewer reads none. That is not a rule in these tables'
-- policies but the holding's own, which they ask. The first block is the proof
-- that the question is being asked.
--
-- The second is the shape. A deposit that carries a coupon or a bond that
-- compounds would compute nothing sensible, a maturity on or before the start
-- would give a negative term, and two renewals starting on one day would be two
-- answers to one question: all refused by the table, whoever writes.
--
-- Rates and amounts are not asserted: they are data, and belong to the bank.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(23);

-- ============================================================== the fixture
--
--   owner        a shared deposit (h1), with one recorded renewal
--   partner      a personal bond (h2)
--   contributor  a shared deposit of their own (h3)
--   viewer       nothing
--   stranger     another household's deposit

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@fixed.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@fixed.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@fixed.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@fixed.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd3000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c3000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd3000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c3000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd3000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c3000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd3000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c3000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd3000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c3000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e3000000-0000-4000-8000-0000000000f1', 'Household F', 'demo'),
  ('e3000000-0000-4000-8000-0000000000f2', 'Household G', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f3000000-0000-4000-8000-0000000000a1', 'e3000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f3000000-0000-4000-8000-0000000000a2', 'e3000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f3000000-0000-4000-8000-0000000000a3', 'e3000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f3000000-0000-4000-8000-0000000000a4', 'e3000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f3000000-0000-4000-8000-0000000000b1', 'e3000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d3000000-0000-4000-8000-0000000000a1', 'e3000000-0000-4000-8000-0000000000f1',
   'f3000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d3000000-0000-4000-8000-0000000000a2', 'e3000000-0000-4000-8000-0000000000f1',
   'f3000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d3000000-0000-4000-8000-0000000000a3', 'e3000000-0000-4000-8000-0000000000f1',
   'f3000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d3000000-0000-4000-8000-0000000000a4', 'e3000000-0000-4000-8000-0000000000f1',
   'f3000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d3000000-0000-4000-8000-0000000000b1', 'e3000000-0000-4000-8000-0000000000f2',
   'f3000000-0000-4000-8000-0000000000b1', 'owner');

insert into public.instrument
  (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset) values
  ('a3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-0000000000f1', 'FD one',   'deposit', 'INR', 'INR', false),
  ('a3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-0000000000f1', 'A bond',   'bond',    'INR', 'INR', false),
  ('a3000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-0000000000f1', 'FD three', 'deposit', 'INR', 'INR', false),
  ('a3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-0000000000f2', 'FD four',  'deposit', 'INR', 'INR', false);

insert into public.holding
  (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-0000000000f1',
   'f3000000-0000-4000-8000-0000000000a1', 'a3000000-0000-4000-8000-000000000001', 1, 'household'),
  ('b3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-0000000000f1',
   'f3000000-0000-4000-8000-0000000000a2', 'a3000000-0000-4000-8000-000000000002', 1, 'personal'),
  ('b3000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-0000000000f1',
   'f3000000-0000-4000-8000-0000000000a3', 'a3000000-0000-4000-8000-000000000003', 1, 'household'),
  ('b3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-0000000000f2',
   'f3000000-0000-4000-8000-0000000000b1', 'a3000000-0000-4000-8000-000000000004', 1, 'household'),
  -- Holds no terms yet: the target for the malformed inserts below.
  ('b3000000-0000-4000-8000-000000000009', 'e3000000-0000-4000-8000-0000000000f1',
   'f3000000-0000-4000-8000-0000000000a1', 'a3000000-0000-4000-8000-000000000002', 1, 'household');

insert into public.fixed_income_terms
  (holding_id, household_id, kind, principal_minor, currency, rate_pct, start_date, maturity_date,
   compounding, coupon_frequency, auto_renew, created_by) values
  ('b3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-0000000000f1', 'deposit',
   10000000, 'INR', 7.000, date '2026-01-01', date '2027-01-01', 'yearly', null, true,
   'd3000000-0000-4000-8000-0000000000a1'),
  ('b3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-0000000000f1', 'bond',
   55500000, 'INR', 10.750, date '2026-04-01', date '2029-04-01', null, 'yearly', false,
   'd3000000-0000-4000-8000-0000000000a2'),
  ('b3000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-0000000000f1', 'deposit',
   22200000, 'INR', 6.500, date '2026-02-01', date '2027-02-01', 'quarterly', null, false,
   'd3000000-0000-4000-8000-0000000000a3'),
  ('b3000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-0000000000f2', 'deposit',
   33300000, 'INR', 7.250, date '2026-03-01', date '2027-03-01', 'yearly', null, false,
   'd3000000-0000-4000-8000-0000000000b1');

insert into public.deposit_renewal
  (id, household_id, holding_id, start_date, maturity_date, principal_minor, currency, rate_pct,
   compounding, created_by) values
  ('c3a00000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-0000000000f1',
   'b3000000-0000-4000-8000-000000000001', date '2027-01-01', date '2028-01-01',
   10700000, 'INR', 6.500, 'yearly', 'd3000000-0000-4000-8000-0000000000a1');

-- ==================================================== the owner: the shared ones (4)

set local role authenticated;
set local request.jwt.claim.sub to 'c3000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.fixed_income_terms),
  2,
  'the owner reads the terms of the two shared deposits, and not the partner''s personal bond'
);

select is_empty(
  $q$ select holding_id from public.fixed_income_terms
      where holding_id = 'b3000000-0000-4000-8000-000000000002' $q$,
  'a personal holding''s terms are not the owner''s to read, the rule the holding states'
);

select is(
  (select count(*)::int from public.deposit_renewal),
  1,
  'and the owner reads a renewal of their own shared deposit'
);

select is_empty(
  $q$ select holding_id from public.fixed_income_terms
      where holding_id = 'b3000000-0000-4000-8000-000000000004' $q$,
  'and nothing of another household''s'
);

-- ============================================================ the partner (2)

set local request.jwt.claim.sub to 'c3000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c3000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.fixed_income_terms),
  3,
  'the partner reads the two shared deposits and their own personal bond'
);

select is(
  (select kind from public.fixed_income_terms
    where holding_id = 'b3000000-0000-4000-8000-000000000002'),
  'bond',
  'and it is the bond'
);

-- =================================================== the contributor: their own (3)

set local request.jwt.claim.sub to 'c3000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c3000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.fixed_income_terms),
  1,
  'a contributor reads only the terms of their own deposit'
);

select is_empty(
  $q$ select id from public.deposit_renewal $q$,
  'and no renewal of anybody else''s'
);

select lives_ok(
  $q$ insert into public.deposit_renewal
        (household_id, holding_id, start_date, maturity_date, principal_minor, currency, rate_pct, compounding)
      values ('e3000000-0000-4000-8000-0000000000f1', 'b3000000-0000-4000-8000-000000000003',
              date '2027-02-01', date '2028-02-01', 23600000, 'INR', 6.250, 'quarterly') $q$,
  'a contributor records a renewal of their own deposit'
);

-- ========================================== the contributor may not write elsewhere (2)

select throws_ok(
  $q$ insert into public.deposit_renewal
        (household_id, holding_id, start_date, maturity_date, principal_minor, currency, rate_pct, compounding)
      values ('e3000000-0000-4000-8000-0000000000f1', 'b3000000-0000-4000-8000-000000000001',
              date '2028-01-01', date '2029-01-01', 11400000, 'INR', 6.500, 'yearly') $q$,
  '42501'::char(5),
  null::text,
  'but not a renewal of the owner''s deposit, which they cannot read'
);

with attempted as (
  update public.fixed_income_terms set rate_pct = 1
   where holding_id = 'b3000000-0000-4000-8000-000000000001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'nor rewrite its rate, which would move a value without touching a deposit'
);

-- ======================================================= the viewer reads none (3)

set local request.jwt.claim.sub to 'c3000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c3000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select holding_id::text from public.fixed_income_terms
     union all select id::text from public.deposit_renewal $q$,
  'a viewer reads no terms and no renewals: a summary is the whole of what they are given'
);

select throws_ok(
  $q$ insert into public.fixed_income_terms
        (holding_id, household_id, kind, principal_minor, currency, rate_pct, start_date, maturity_date, compounding)
      values ('b3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-0000000000f1',
              'deposit', 100, 'INR', 1, date '2026-01-01', date '2027-01-01', 'yearly') $q$,
  '42501'::char(5),
  null::text,
  'and cannot record terms'
);

select throws_ok(
  $q$ delete from public.fixed_income_terms $q$,
  '42501'::char(5),
  null::text,
  'nobody can delete terms: a wrong figure is corrected in place, and the audit log keeps the version it replaced'
);

-- ======================================================= a password alone (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c3000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select holding_id from public.fixed_income_terms $q$,
  'a session with a password but no second factor reads no terms'
);

-- ============================================= the audit rows are as private (2)
--
-- They carry the principal and the rate in full. Covered by the rule that an audit
-- row naming a holding_id is readable only by whoever can read the holding, which
-- is why this migration has to come after 20260927120000.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c3000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'fixed_income_terms'
        and after ->> 'holding_id' = 'b3000000-0000-4000-8000-000000000002' $q$,
  'the owner does not read the audit row for the partner''s personal bond, principal and coupon inside it'
);

select isnt_empty(
  $q$ select id from public.audit_log
      where entity = 'fixed_income_terms'
        and after ->> 'holding_id' = 'b3000000-0000-4000-8000-000000000001' $q$,
  'while the audit row for a shared deposit is readable: the log is not switched off'
);

-- ========================================= malformed rows are refused by the table (6)
--
-- As the owner of the tables, which is how a migration would write one. A check
-- constraint applies to everybody, so this is the refusal a client would meet.

reset role;

select throws_ok(
  $q$ insert into public.fixed_income_terms
        (holding_id, household_id, kind, principal_minor, currency, rate_pct, start_date, maturity_date,
         compounding, coupon_frequency, created_by)
      values ('b3000000-0000-4000-8000-000000000009', 'e3000000-0000-4000-8000-0000000000f1',
              'deposit', 100, 'INR', 7, date '2026-01-01', date '2027-01-01', 'yearly', 'yearly',
              'd3000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5),
  null::text,
  'a deposit that carries a coupon is refused'
);

select throws_ok(
  $q$ insert into public.fixed_income_terms
        (holding_id, household_id, kind, principal_minor, currency, rate_pct, start_date, maturity_date,
         compounding, coupon_frequency, created_by)
      values ('b3000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-0000000000f1',
              'bond', 100, 'INR', 7, date '2026-01-01', date '2027-01-01', null, 'yearly',
              'd3000000-0000-4000-8000-0000000000a2') $q$,
  '23505'::char(5),
  null::text,
  'terms are one per holding: a second set is refused before anything else is asked'
);

select throws_ok(
  $q$ update public.fixed_income_terms set compounding = null
       where holding_id = 'b3000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5),
  null::text,
  'a deposit with no compounding is refused: it would compute nothing'
);

select throws_ok(
  $q$ update public.fixed_income_terms set maturity_date = start_date
       where holding_id = 'b3000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5),
  null::text,
  'a maturity on the start date is refused'
);

select throws_ok(
  $q$ update public.fixed_income_terms set auto_renew = true
       where holding_id = 'b3000000-0000-4000-8000-000000000002' $q$,
  '23514'::char(5),
  null::text,
  'a bond cannot auto-renew'
);

select throws_ok(
  $q$ insert into public.deposit_renewal
        (household_id, holding_id, start_date, maturity_date, principal_minor, currency, rate_pct, compounding)
      values ('e3000000-0000-4000-8000-0000000000f1', 'b3000000-0000-4000-8000-000000000001',
              date '2027-01-01', date '2028-06-01', 10700000, 'INR', 6.5, 'yearly') $q$,
  '23505'::char(5),
  null::text,
  'two renewals starting on the same day are refused: two answers to one question'
);

select * from finish();

rollback;
