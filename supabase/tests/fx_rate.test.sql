-- Family Finance Buddy — rates and balances.
--
-- Two new pieces of household data, so the same questions as every other:
-- another household cannot see them, a viewer cannot write them, and the
-- constraints that keep a figure meaningful actually hold.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(12);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'faaa1111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'fx-owner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'fbbb2222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'fx-viewer@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'fccc3333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'fx-outsider@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'fddd0000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'faaa1111-1111-4111-8111-111111111111';
update public.user_account set id = 'fddd0000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'fbbb2222-2222-4222-8222-222222222222';
update public.user_account set id = 'fddd0000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'fccc3333-3333-4333-8333-333333333333';

insert into public.household (id, name, kind) values
  ('feee0000-0000-4000-8000-00000000e001', 'Rate house', 'demo'),
  ('feee0000-0000-4000-8000-00000000e002', 'Other house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f1110000-0000-4000-8000-00000000c001', 'feee0000-0000-4000-8000-00000000e001', 'Owner', 'c1'),
  ('f1110000-0000-4000-8000-00000000c002', 'feee0000-0000-4000-8000-00000000e001', 'Looker', 'c2'),
  ('f1110000-0000-4000-8000-00000000c003', 'feee0000-0000-4000-8000-00000000e002', 'Stranger', 'c3');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('fddd0000-0000-4000-8000-0000000000a1', 'feee0000-0000-4000-8000-00000000e001',
   'f1110000-0000-4000-8000-00000000c001', 'owner'),
  ('fddd0000-0000-4000-8000-0000000000a2', 'feee0000-0000-4000-8000-00000000e001',
   'f1110000-0000-4000-8000-00000000c002', 'viewer'),
  ('fddd0000-0000-4000-8000-0000000000b1', 'feee0000-0000-4000-8000-00000000e002',
   'f1110000-0000-4000-8000-00000000c003', 'owner');

insert into public.fx_rate (household_id, base_currency, quote_currency, rate, as_of_date, created_by) values
  ('feee0000-0000-4000-8000-00000000e001', 'USD', 'INR', 88.4500000000, date '2026-08-31',
   'fddd0000-0000-4000-8000-0000000000a1');

insert into public.liability (household_id, name, kind, instalment_minor, currency, cadence,
                              outstanding_minor, outstanding_as_of)
values ('feee0000-0000-4000-8000-00000000e001', 'Home loan', 'home_loan', 4500000, 'INR', 'monthly',
        320000000, date '2026-08-31');

-- ================================================= constraints hold (4)

reset role;

-- A rate is a ratio and needs its fractional part. Rounding to two places
-- would put an error of up to half a paise on every converted figure, which
-- compounds across a portfolio.
select is(
  (select rate::text from public.fx_rate where base_currency = 'USD'),
  '88.4500000000',
  'a rate keeps ten decimal places, because it is a ratio and not money'
);

select throws_ok(
  $q$ insert into public.fx_rate (household_id, base_currency, quote_currency, rate, as_of_date, created_by)
      values ('feee0000-0000-4000-8000-00000000e001', 'INR', 'INR', 1, date '2026-08-01',
              'fddd0000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5),
  null::text,
  'a currency cannot have a rate against itself'
);

select throws_ok(
  $q$ insert into public.fx_rate (household_id, base_currency, quote_currency, rate, as_of_date, created_by)
      values ('feee0000-0000-4000-8000-00000000e001', 'USD', 'INR', 88.9, date '2026-08-31',
              'fddd0000-0000-4000-8000-0000000000a1') $q$,
  '23505'::char(5),
  null::text,
  'one rate per pair per day: a second is a correction, not a rival'
);

-- A balance with no date ages silently into a wrong figure, and a date with no
-- balance says nothing. Both or neither.
select throws_ok(
  $q$ update public.liability set outstanding_as_of = null where name = 'Home loan' $q$,
  '23514'::char(5),
  null::text,
  'an outstanding balance cannot lose the date it was true on'
);

-- ============================================ another household sees none (2)

set local role authenticated;
set local request.jwt.claim.sub to 'fccc3333-3333-4333-8333-333333333333';
set local request.jwt.claims   to '{"sub":"fccc3333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.fx_rate $q$,
  'a member of another household reads no rates'
);

select throws_ok(
  $q$ insert into public.fx_rate (household_id, base_currency, quote_currency, rate, as_of_date, created_by)
      values ('feee0000-0000-4000-8000-00000000e001', 'EUR', 'INR', 96, date '2026-08-30',
              'fddd0000-0000-4000-8000-0000000000b1') $q$,
  '42501'::char(5),
  null::text,
  'and cannot write one into a household they do not belong to'
);

-- ================================================= a viewer writes none (3)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'fbbb2222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"fbbb2222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

select isnt_empty(
  $q$ select id from public.fx_rate $q$,
  'a viewer in the household can read the rates — they are part of every figure shown'
);

select throws_ok(
  $q$ insert into public.fx_rate (household_id, base_currency, quote_currency, rate, as_of_date, created_by)
      values ('feee0000-0000-4000-8000-00000000e001', 'GBP', 'INR', 112, date '2026-08-30',
              'fddd0000-0000-4000-8000-0000000000a2') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot set a rate: it changes every converted figure in the household'
);

with attempted as (
  update public.liability set outstanding_minor = 1 where name = 'Home loan' returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'nor restate what is owed'
);

-- ================================================ the owner can (3)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'faaa1111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"faaa1111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ insert into public.fx_rate (household_id, base_currency, quote_currency, rate, as_of_date, created_by)
      values ('feee0000-0000-4000-8000-00000000e001', 'USD', 'INR', 88.9, date '2026-09-30',
              'fddd0000-0000-4000-8000-0000000000a1') $q$,
  'an owner records tomorrow''s rate without disturbing yesterday''s'
);

-- The whole reason rates are dated. Converting August at September's rate
-- would move a figure somebody has already relied on.
select is(
  (select rate::text from public.fx_rate
    where base_currency = 'USD' and as_of_date = date '2026-08-31'),
  '88.4500000000',
  'and the August rate is exactly what it was before September existed'
);

select throws_ok(
  $q$ delete from public.fx_rate where base_currency = 'USD' $q$,
  '42501'::char(5),
  null::text,
  'nobody deletes a rate a figure was converted at'
);

reset role;

select * from finish();

rollback;
