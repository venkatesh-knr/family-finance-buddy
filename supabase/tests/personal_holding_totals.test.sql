-- Family Finance Buddy — the sum arrives, the rows do not.
--
-- This function exists so a household total is complete. It is also the most
-- dangerous shape in the schema: a definer function reading past the policy
-- that protects §20. So the assertions come in pairs — the figure is right,
-- and the detail behind it is still unreachable.
--
-- The subtraction attack is the one to keep in mind. If a member can get a
-- per-holding or per-class breakdown, a household with one private holding
-- gives its value away by arithmetic. There is no argument that produces one,
-- and the test says so.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(11);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'da110000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'nw-owner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'da110000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'nw-partner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'da110000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'nw-outsider@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'db220000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'da110000-0000-4000-8000-000000000001';
update public.user_account set id = 'db220000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'da110000-0000-4000-8000-000000000002';
update public.user_account set id = 'db220000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'da110000-0000-4000-8000-000000000003';

insert into public.household (id, name, kind) values
  ('dc330000-0000-4000-8000-00000000e001', 'Net worth house', 'demo'),
  ('dc330000-0000-4000-8000-00000000e002', 'Elsewhere', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('dd440000-0000-4000-8000-00000000c001', 'dc330000-0000-4000-8000-00000000e001', 'Owner', 'c1'),
  ('dd440000-0000-4000-8000-00000000c002', 'dc330000-0000-4000-8000-00000000e001', 'Partner', 'c2'),
  ('dd440000-0000-4000-8000-00000000c003', 'dc330000-0000-4000-8000-00000000e002', 'Stranger', 'c3');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('db220000-0000-4000-8000-0000000000a1', 'dc330000-0000-4000-8000-00000000e001',
   'dd440000-0000-4000-8000-00000000c001', 'owner'),
  ('db220000-0000-4000-8000-0000000000a2', 'dc330000-0000-4000-8000-00000000e001',
   'dd440000-0000-4000-8000-00000000c002', 'partner'),
  ('db220000-0000-4000-8000-0000000000a3', 'dc330000-0000-4000-8000-00000000e002',
   'dd440000-0000-4000-8000-00000000c003', 'owner');

insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('de550000-0000-4000-8000-00000000f001', 'dc330000-0000-4000-8000-00000000e001',
   'Quiet fund', 'mutual_fund', 'INR', 'INR'),
  ('de550000-0000-4000-8000-00000000f002', 'dc330000-0000-4000-8000-00000000e001',
   'Quiet bond', 'bond', 'INR', 'INR'),
  ('de550000-0000-4000-8000-00000000f003', 'dc330000-0000-4000-8000-00000000e001',
   'Shared fund', 'mutual_fund', 'INR', 'INR'),
  ('de550000-0000-4000-8000-00000000f004', 'dc330000-0000-4000-8000-00000000e001',
   'Never read', 'mutual_fund', 'INR', 'INR');

-- The partner holds two private positions, one shared, and one private that
-- has never been valued. The owner holds one private of their own, which must
-- NOT come back when the owner asks — they can read it as a row already.
insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('df660000-0000-4000-8000-00000000b001', 'dc330000-0000-4000-8000-00000000e001',
   'dd440000-0000-4000-8000-00000000c002', 'de550000-0000-4000-8000-00000000f001', 10, 'personal'),
  ('df660000-0000-4000-8000-00000000b002', 'dc330000-0000-4000-8000-00000000e001',
   'dd440000-0000-4000-8000-00000000c002', 'de550000-0000-4000-8000-00000000f002', 20, 'personal'),
  ('df660000-0000-4000-8000-00000000b003', 'dc330000-0000-4000-8000-00000000e001',
   'dd440000-0000-4000-8000-00000000c002', 'de550000-0000-4000-8000-00000000f003', 30, 'household'),
  ('df660000-0000-4000-8000-00000000b004', 'dc330000-0000-4000-8000-00000000e001',
   'dd440000-0000-4000-8000-00000000c002', 'de550000-0000-4000-8000-00000000f004', 40, 'personal'),
  ('df660000-0000-4000-8000-00000000b005', 'dc330000-0000-4000-8000-00000000e001',
   'dd440000-0000-4000-8000-00000000c001', 'de550000-0000-4000-8000-00000000f001', 5, 'personal');

-- Two readings on the first, so "latest" has something to be wrong about.
insert into public.valuation_snapshot
  (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by) values
  ('dc330000-0000-4000-8000-00000000e001', 'df660000-0000-4000-8000-00000000b001',
   date '2026-05-31', 10, 100000, 'INR', 'manual', 'db220000-0000-4000-8000-0000000000a2'),
  ('dc330000-0000-4000-8000-00000000e001', 'df660000-0000-4000-8000-00000000b001',
   date '2026-06-30', 10, 250000, 'INR', 'manual', 'db220000-0000-4000-8000-0000000000a2'),
  ('dc330000-0000-4000-8000-00000000e001', 'df660000-0000-4000-8000-00000000b002',
   date '2026-06-30', 20, 750000, 'INR', 'manual', 'db220000-0000-4000-8000-0000000000a2'),
  ('dc330000-0000-4000-8000-00000000e001', 'df660000-0000-4000-8000-00000000b003',
   date '2026-06-30', 30, 999900, 'INR', 'manual', 'db220000-0000-4000-8000-0000000000a2'),
  ('dc330000-0000-4000-8000-00000000e001', 'df660000-0000-4000-8000-00000000b005',
   date '2026-06-30',  5,  40000, 'INR', 'manual', 'db220000-0000-4000-8000-0000000000a1');
-- b004 gets nothing, on purpose.

-- ═══════════════════════════ the rows stay invisible, as before (2)

set local role authenticated;
set local request.jwt.claim.sub to 'da110000-0000-4000-8000-000000000001';
set local request.jwt.claims   to '{"sub":"da110000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.holding
    where member_id = 'dd440000-0000-4000-8000-00000000c002'),
  1,
  'the owner reads only the partner''s shared holding as a row'
);

select is_empty(
  $q$ select v.id from public.valuation_snapshot v
       where v.holding_id = 'df660000-0000-4000-8000-00000000b001' $q$,
  'and none of the readings behind a personal one, which would give its value away'
);

-- ══════════════════════════════════ but the total includes them (3)

select is(
  (select total_minor from public.personal_holding_totals('dc330000-0000-4000-8000-00000000e001')
    where member_id = 'dd440000-0000-4000-8000-00000000c002'),
  1000000::bigint,
  'the household total includes what the owner cannot see: 2,500 + 7,500'
);

select is(
  (select unvalued from public.personal_holding_totals('dc330000-0000-4000-8000-00000000e001')
    where member_id = 'dd440000-0000-4000-8000-00000000c002'),
  1,
  'and says one is unvalued rather than implying the figure is complete'
);

select is(
  (select count(*)::int from public.personal_holding_totals('dc330000-0000-4000-8000-00000000e001')),
  1,
  'the owner''s own personal holding is absent — they read it as a row and would count it twice'
);

-- ══════════════════ one line per member, and no way to a breakdown (2)
--
-- The subtraction attack. A per-holding or per-class total would hand back
-- exactly what the single line is blunting.

select is(
  (select count(*)::int
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'personal_holding_totals'
      and p.pronargs > 1),
  0,
  'there is no argument that asks for a breakdown, because there is no second argument'
);

select bag_has(
  $q$ select member_id, currency from public.personal_holding_totals('dc330000-0000-4000-8000-00000000e001') $q$,
  $q$ values ('dd440000-0000-4000-8000-00000000c002'::uuid, 'INR') $q$,
  'one line per member and currency, never per holding'
);

-- ═══════════════════════════════ the latest reading, not the first (1)

select is(
  (select total_minor from public.personal_holding_totals('dc330000-0000-4000-8000-00000000e001')
    where member_id = 'dd440000-0000-4000-8000-00000000c002')
    - 750000::bigint,
  250000::bigint,
  'a holding read twice contributes its latest value, not its first'
);

-- ════════════════════════════ and nobody outside gets a figure (2)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'da110000-0000-4000-8000-000000000003';
set local request.jwt.claims   to '{"sub":"da110000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select * from public.personal_holding_totals('dc330000-0000-4000-8000-00000000e001') $q$,
  '42501'::char(5),
  null::text,
  'a member of another household is refused, not given an empty result'
);

select throws_ok(
  $q$ select * from public.personal_holding_totals('00000000-0000-4000-8000-00000000dead') $q$,
  '42501'::char(5),
  null::text,
  'and so is a household that does not exist, which would otherwise probe for one'
);

-- ══════════════════════════ the caller's own household still works (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'da110000-0000-4000-8000-000000000002';
set local request.jwt.claims   to '{"sub":"da110000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';

select is(
  (select total_minor from public.personal_holding_totals('dc330000-0000-4000-8000-00000000e001')
    where member_id = 'dd440000-0000-4000-8000-00000000c001'),
  40000::bigint,
  'the partner sees the owner''s private total as one line, and no more of it than that'
);

reset role;

select * from finish();

rollback;
