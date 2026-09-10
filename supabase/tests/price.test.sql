-- Family Finance Buddy — a price is readable by all and writable by none.
--
-- The table is reference data, so the assertions are the same shape as
-- tax_rule's: everybody reads, nobody writes. The second half carries more
-- weight here than there, because a price is an input to a figure rather than
-- a rule about one — a household able to write its own NAV could move its own
-- net worth, which is the number the whole app exists to state honestly.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(10);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'fa110000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'price-owner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'fb220000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'fa110000-0000-4000-8000-000000000001';

insert into public.household (id, name, kind) values
  ('fc330000-0000-4000-8000-00000000e001', 'Price house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('fd440000-0000-4000-8000-00000000c001', 'fc330000-0000-4000-8000-00000000e001', 'Owner', 'c1');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('fb220000-0000-4000-8000-0000000000a1', 'fc330000-0000-4000-8000-00000000e001',
   'fd440000-0000-4000-8000-00000000c001', 'owner');

-- An instrument to hang the paired-columns assertions on. Without a row, an
-- update matching nothing raises nothing and the constraint tests would pass
-- while proving absolutely nothing.
insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('fe550000-0000-4000-8000-00000000f001', 'fc330000-0000-4000-8000-00000000e001',
   'A fund with a feed', 'mutual_fund', 'INR', 'INR');

-- Two fetches for one date: a published NAV that was later revised.
insert into public.price (source, external_id, as_of_date, value, currency, fetched_at) values
  ('amfi', 'INF209K01Z15', date '2026-09-08', 123.4567, 'INR', timestamptz '2026-09-09 06:00+05:30'),
  ('amfi', 'INF209K01Z15', date '2026-09-08', 123.9999, 'INR', timestamptz '2026-09-10 06:00+05:30'),
  ('amfi', 'INF209K01Z15', date '2026-09-07', 122.1000, 'INR', timestamptz '2026-09-08 06:00+05:30');

-- ═══════════════════════════════ nobody may write one (3)

reset role;

select ok(
  not has_table_privilege('authenticated', 'public.price', 'insert'),
  'no member can write a price: a household that could would be moving its own net worth'
);

select ok(
  not has_table_privilege('authenticated', 'public.price', 'update'),
  'nor revise one — a revision is a new dated row, so the old figure stays explainable'
);

select ok(
  not has_table_privilege('authenticated', 'public.price', 'delete'),
  'nor delete one, which would make a past valuation unreproducible'
);

-- ══════════════════════════════════ everybody may read them (2)

set local role authenticated;
set local request.jwt.claim.sub to 'fa110000-0000-4000-8000-000000000001';
set local request.jwt.claims   to '{"sub":"fa110000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.price),
  3,
  'a member reads every price, because a published NAV is public knowledge'
);

select is(
  (select value::text from public.price
    where as_of_date = date '2026-09-08'
    order by fetched_at desc limit 1),
  '123.999900',
  'the most recently fetched figure for a date wins, and the earlier one is still there'
);

-- ═══════════════════ precision the money type could not hold (1)

select is(
  (select value::text from public.price where as_of_date = date '2026-09-07'),
  '122.100000',
  'a NAV keeps its decimals: rounded to paise it would carry the rounding into every valuation'
);

-- ══════════════════════ a password alone is not enough (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'fa110000-0000-4000-8000-000000000001';
set local request.jwt.claims   to '{"sub":"fa110000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select id from public.price $q$,
  'a session without a second factor reads nothing, as everywhere else'
);

-- ═══════════════ an instrument names its source, or neither (2)

reset role;

select throws_ok(
  $q$ update public.instrument set price_source = 'amfi'
       where id = 'fe550000-0000-4000-8000-00000000f001' $q$,
  '23514'::char(5),
  null::text,
  'a source with nothing to look up is refused'
);

select throws_ok(
  $q$ update public.instrument set price_external_id = 'INF209K01Z15'
       where id = 'fe550000-0000-4000-8000-00000000f001' $q$,
  '23514'::char(5),
  null::text,
  'and an identifier with no source, which would not say who to ask'
);

select lives_ok(
  $q$ update public.instrument
         set price_source = 'amfi', price_external_id = 'INF209K01Z15'
       where id = 'fe550000-0000-4000-8000-00000000f001' $q$,
  'but both together is exactly what the driver needs, and is allowed'
);

reset role;

select * from finish();

rollback;
