-- Family Finance Buddy — what a broker says a position cost on average (docs/build-plan.md step 7c).
--
-- FOR REVIEW with the migration beside it (20261128120000_holding_stated_average_price.sql). Not run locally: Docker is blocked on the maintainer's machine, so CI's policy suite is the first run.
--
-- The migration adds no policy: the price rides on the holding row, so the holding's own policies decide who reads and writes it. The assertions are the shape it must have and the one that would
-- break silently if the policies stopped covering it: another member's personal holding does not give up its average price.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(9);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'f1e11111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'owner@avgprice.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'f2e22222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'looker@avgprice.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'f3e33333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'filer@avgprice.test', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'fc000000-0000-4000-8000-0000000000a1' where auth_user_id = 'f1e11111-1111-4111-8111-111111111111';
update public.user_account set id = 'fc000000-0000-4000-8000-0000000000a2' where auth_user_id = 'f2e22222-2222-4222-8222-222222222222';
update public.user_account set id = 'fc000000-0000-4000-8000-0000000000a3' where auth_user_id = 'f3e33333-3333-4333-8333-333333333333';

insert into public.household (id, name, kind) values
  ('f1000000-0000-4000-8000-0000000000e1', 'Averaging house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('fa000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-0000000000e1', 'Owner',  'c1'),
  ('fa000000-0000-4000-8000-0000000000a2', 'f1000000-0000-4000-8000-0000000000e1', 'Looker', 'c2'),
  ('fa000000-0000-4000-8000-0000000000a3', 'f1000000-0000-4000-8000-0000000000e1', 'Filer',  'c3');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('fc000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-0000000000e1', 'fa000000-0000-4000-8000-0000000000a1', 'owner'),
  ('fc000000-0000-4000-8000-0000000000a2', 'f1000000-0000-4000-8000-0000000000e1', 'fa000000-0000-4000-8000-0000000000a2', 'viewer'),
  ('fc000000-0000-4000-8000-0000000000a3', 'f1000000-0000-4000-8000-0000000000e1', 'fa000000-0000-4000-8000-0000000000a3', 'contributor');

insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('ff000000-0000-4000-8000-0000000000f1', 'f1000000-0000-4000-8000-0000000000e1', 'A stock',         'equity', 'INR', 'INR'),
  ('ff000000-0000-4000-8000-0000000000f2', 'f1000000-0000-4000-8000-0000000000e1', 'A US stock',      'equity', 'USD', 'USD'),
  ('ff000000-0000-4000-8000-0000000000f3', 'f1000000-0000-4000-8000-0000000000e1', 'A private stock', 'equity', 'INR', 'INR');

-- b1: the household's, held by the owner, with no balance stated. b2: another, held by the owner. b3: the filer's, personal, with a quantity and an average price already stated.
insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('fb000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-0000000000e1', 'fa000000-0000-4000-8000-0000000000a1', 'ff000000-0000-4000-8000-0000000000f1', 0, 'household'),
  ('fb000000-0000-4000-8000-0000000000b2', 'f1000000-0000-4000-8000-0000000000e1', 'fa000000-0000-4000-8000-0000000000a1', 'ff000000-0000-4000-8000-0000000000f2', 0, 'household'),
  ('fb000000-0000-4000-8000-0000000000b3', 'f1000000-0000-4000-8000-0000000000e1', 'fa000000-0000-4000-8000-0000000000a3', 'ff000000-0000-4000-8000-0000000000f3', 0, 'personal');

update public.holding
   set stated_quantity = 50, stated_as_at = date '2026-09-30', stated_average_price = 812.35, stated_average_price_currency = 'INR'
 where id = 'fb000000-0000-4000-8000-0000000000b3';

-- ═══════════════════════════════════════ a price can be recorded, exactly (2)

set local role authenticated;
set local request.jwt.claim.sub to 'f1e11111-1111-4111-8111-111111111111';
set local request.jwt.claims   to '{"sub":"f1e11111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ update public.holding
         set stated_quantity = 12.5, stated_as_at = date '2026-09-30', stated_average_price = 132.5143, stated_average_price_currency = 'USD'
       where id = 'fb000000-0000-4000-8000-0000000000b2' $q$,
  'the owner can record the average price a broker states, in its currency, beside the quantity it states'
);

select is(
  (select stated_average_price from public.holding where id = 'fb000000-0000-4000-8000-0000000000b2'),
  132.5143::numeric,
  'and it is stored to four places, which minor units would have rounded'
);

-- ═══════════════════════════════════════ the shape it must have (4)

reset role;

select throws_ok(
  $q$ update public.holding set stated_average_price = 10 where id = 'fb000000-0000-4000-8000-0000000000b1' $q$,
  '23514'::char(5), null::text,
  'a price with no currency is refused'
);

select throws_ok(
  $q$ update public.holding set stated_quantity = 1, stated_as_at = date '2026-09-30', stated_average_price = -1, stated_average_price_currency = 'INR' where id = 'fb000000-0000-4000-8000-0000000000b1' $q$,
  '23514'::char(5), null::text,
  'and a price below zero'
);

select throws_ok(
  $q$ update public.holding set stated_quantity = 1, stated_as_at = date '2026-09-30', stated_average_price = 10, stated_average_price_currency = 'rupees' where id = 'fb000000-0000-4000-8000-0000000000b1' $q$,
  '23514'::char(5), null::text,
  'and a currency that is not a three-letter code'
);

select throws_ok(
  $q$ update public.holding set stated_average_price = 10, stated_average_price_currency = 'INR' where id = 'fb000000-0000-4000-8000-0000000000b1' $q$,
  '23514'::char(5), null::text,
  'and a price with no quantity stated beside it, since it would have no date'
);

-- ═══════════════════════════════════════ who sees it, who changes it (3)

set local role authenticated;
set local request.jwt.claim.sub to 'f2e22222-2222-4222-8222-222222222222';
set local request.jwt.claims   to '{"sub":"f2e22222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.holding where id = 'fb000000-0000-4000-8000-0000000000b3'),
  0,
  'another member does not read the filer''s personal holding, so not its average price either'
);

with attempted as (
  update public.holding set stated_quantity = 1, stated_as_at = date '2026-09-30', stated_average_price = 1, stated_average_price_currency = 'INR'
   where id = 'fb000000-0000-4000-8000-0000000000b1'
  returning 1
)
select is((select count(*)::int from attempted), 0, 'a viewer cannot record one');

reset role;
select is(
  (select stated_average_price from public.holding where id = 'fb000000-0000-4000-8000-0000000000b1'),
  null::numeric,
  'and the viewer''s attempt changed nothing'
);

select * from finish();

rollback;
