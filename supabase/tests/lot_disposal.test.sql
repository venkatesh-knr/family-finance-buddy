-- Family Finance Buddy — who may record a purchase or a sale, and who may not.
--
-- "No policy without a test that proves it denies." Both tables inherit their
-- privacy from the holding rather than carrying a visibility of their own, so
-- the assertion that matters most is the one about somebody else's personal
-- holding: a lot names what a position cost and a disposal names what it
-- fetched, and either of those leaking would say more about a private holding
-- than the holding row itself does.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(16);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'ba110000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'lot-owner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'ba110000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'lot-partner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'ba110000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'lot-viewer@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'ba110000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'lot-outsider@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'bb220000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'ba110000-0000-4000-8000-000000000001';
update public.user_account set id = 'bb220000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'ba110000-0000-4000-8000-000000000002';
update public.user_account set id = 'bb220000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'ba110000-0000-4000-8000-000000000003';
update public.user_account set id = 'bb220000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'ba110000-0000-4000-8000-000000000004';

insert into public.household (id, name, kind) values
  ('bc330000-0000-4000-8000-00000000e001', 'Lot house', 'demo'),
  ('bc330000-0000-4000-8000-00000000e002', 'Other house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('bd440000-0000-4000-8000-00000000c001', 'bc330000-0000-4000-8000-00000000e001', 'Owner', 'c1'),
  ('bd440000-0000-4000-8000-00000000c002', 'bc330000-0000-4000-8000-00000000e001', 'Recorder', 'c2'),
  ('bd440000-0000-4000-8000-00000000c003', 'bc330000-0000-4000-8000-00000000e001', 'Looker', 'c3'),
  ('bd440000-0000-4000-8000-00000000c004', 'bc330000-0000-4000-8000-00000000e002', 'Stranger', 'c4');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('bb220000-0000-4000-8000-0000000000a1', 'bc330000-0000-4000-8000-00000000e001',
   'bd440000-0000-4000-8000-00000000c001', 'owner'),
  ('bb220000-0000-4000-8000-0000000000a2', 'bc330000-0000-4000-8000-00000000e001',
   'bd440000-0000-4000-8000-00000000c002', 'contributor'),
  ('bb220000-0000-4000-8000-0000000000a3', 'bc330000-0000-4000-8000-00000000e001',
   'bd440000-0000-4000-8000-00000000c003', 'viewer'),
  ('bb220000-0000-4000-8000-0000000000a4', 'bc330000-0000-4000-8000-00000000e002',
   'bd440000-0000-4000-8000-00000000c004', 'owner');

insert into public.instrument (id, household_id, name, kind, currency, exposure_currency) values
  ('be550000-0000-4000-8000-00000000f001', 'bc330000-0000-4000-8000-00000000e001',
   'Shared fund', 'mutual_fund', 'INR', 'INR'),
  ('be550000-0000-4000-8000-00000000f002', 'bc330000-0000-4000-8000-00000000e001',
   'Quiet fund', 'mutual_fund', 'INR', 'INR');

-- One household holding, and one the partner has marked personal. The second
-- is the interesting one: the owner administers this household and still must
-- not see what that position cost.
insert into public.holding (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('bf660000-0000-4000-8000-00000000b001', 'bc330000-0000-4000-8000-00000000e001',
   'bd440000-0000-4000-8000-00000000c001', 'be550000-0000-4000-8000-00000000f001', 100, 'household'),
  ('bf660000-0000-4000-8000-00000000b002', 'bc330000-0000-4000-8000-00000000e001',
   'bd440000-0000-4000-8000-00000000c002', 'be550000-0000-4000-8000-00000000f002', 50, 'personal');

insert into public.lot
  (id, household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by) values
  ('c0770000-0000-4000-8000-00000000a001', 'bc330000-0000-4000-8000-00000000e001',
   'bf660000-0000-4000-8000-00000000b001', date '2024-01-10', 100, 1000000, 'INR',
   'bb220000-0000-4000-8000-0000000000a1'),
  ('c0770000-0000-4000-8000-00000000a002', 'bc330000-0000-4000-8000-00000000e001',
   'bf660000-0000-4000-8000-00000000b002', date '2024-02-10', 50, 5000000, 'INR',
   'bb220000-0000-4000-8000-0000000000a2');

insert into public.disposal
  (id, household_id, holding_id, disposed_on, quantity, proceeds_minor, currency, created_by) values
  ('c0880000-0000-4000-8000-00000000a001', 'bc330000-0000-4000-8000-00000000e001',
   'bf660000-0000-4000-8000-00000000b001', date '2025-06-10', 40, 600000, 'INR',
   'bb220000-0000-4000-8000-0000000000a1'),
  ('c0880000-0000-4000-8000-00000000a002', 'bc330000-0000-4000-8000-00000000e001',
   'bf660000-0000-4000-8000-00000000b002', date '2025-06-10', 10, 1500000, 'INR',
   'bb220000-0000-4000-8000-0000000000a2');

-- ══════════════════════════════════ nothing may be deleted, by anyone (2)
--
-- Not a policy question but a grant one, and the stronger guarantee for it.
-- A deleted lot silently re-matches every sale after it, because FIFO is
-- positional — the gain on a sale from 2023 would change and nothing would
-- say why.

reset role;

select ok(
  not has_table_privilege('authenticated', 'public.lot', 'delete'),
  'no member of any household can delete a purchase, because FIFO is positional'
);

select ok(
  not has_table_privilege('authenticated', 'public.disposal', 'delete'),
  'nor a sale'
);

-- ═══════════════════════════════════════ the owner sees their own (2)

set local role authenticated;
set local request.jwt.claim.sub to 'ba110000-0000-4000-8000-000000000001';
set local request.jwt.claims   to '{"sub":"ba110000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.lot),
  1,
  'the owner sees the household holding''s purchase'
);

select is(
  (select count(*)::int from public.disposal),
  1,
  'and its sale'
);

-- ══════════════════════ and not what a personal holding cost (2)
--
-- The owner administers this household. §20 still applies: "the line-item
-- detail is returned to nobody else, the owner included." A lot IS the line
-- item — it names the cost — so this is the assertion the whole design of
-- these two tables rests on.

select is_empty(
  $q$ select id from public.lot where holding_id = 'bf660000-0000-4000-8000-00000000b002' $q$,
  'the owner cannot see what another member''s personal holding cost'
);

select is_empty(
  $q$ select id from public.disposal where holding_id = 'bf660000-0000-4000-8000-00000000b002' $q$,
  'nor what it sold for, which would give away the gain either way'
);

-- ═════════════════════════════════ the member it belongs to does (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'ba110000-0000-4000-8000-000000000002';
set local request.jwt.claims   to '{"sub":"ba110000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.lot),
  2,
  'the member it belongs to sees both: the household purchase and their own personal one'
);

-- ══════════════════════════════════ a contributor may record (2)

select lives_ok(
  $q$ insert into public.lot
        (household_id, holding_id, acquired_on, quantity, cost_minor, currency)
      values ('bc330000-0000-4000-8000-00000000e001', 'bf660000-0000-4000-8000-00000000b001',
              date '2025-01-10', 10, 150000, 'INR') $q$,
  'a contributor records a purchase, which is the role''s whole point'
);

select lives_ok(
  $q$ insert into public.disposal
        (household_id, holding_id, disposed_on, quantity, proceeds_minor, currency)
      values ('bc330000-0000-4000-8000-00000000e001', 'bf660000-0000-4000-8000-00000000b001',
              date '2025-07-10', 5, 90000, 'INR') $q$,
  'and a sale'
);

-- ═══════════════════════════════════════ a viewer may not (2)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'ba110000-0000-4000-8000-000000000003';
set local request.jwt.claims   to '{"sub":"ba110000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.lot
        (household_id, holding_id, acquired_on, quantity, cost_minor, currency)
      values ('bc330000-0000-4000-8000-00000000e001', 'bf660000-0000-4000-8000-00000000b001',
              date '2025-01-10', 10, 150000, 'INR') $q$,
  '42501'::char(5),
  null::text,
  'a viewer cannot record a purchase'
);

with attempted as (
  update public.lot set cost_minor = 1
   where id = 'c0770000-0000-4000-8000-00000000a001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'nor rewrite the cost of one, which would move a gain without touching a sale'
);

-- ═════════════════════════════ another household sees none of it (2)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'ba110000-0000-4000-8000-000000000004';
set local request.jwt.claims   to '{"sub":"ba110000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.lot $q$,
  'an owner of another household sees no purchases at all'
);

select throws_ok(
  $q$ insert into public.lot
        (household_id, holding_id, acquired_on, quantity, cost_minor, currency)
      values ('bc330000-0000-4000-8000-00000000e001', 'bf660000-0000-4000-8000-00000000b001',
              date '2025-01-10', 10, 150000, 'INR') $q$,
  '42501'::char(5),
  null::text,
  'and cannot plant one in a household they do not belong to'
);

-- ══════════════════════ a password alone is not enough (1)
--
-- The publishable key ships in the bundle by design, so aal1 must not reach
-- household data. Restrictive policy, narrowing rather than adding.

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'ba110000-0000-4000-8000-000000000001';
set local request.jwt.claims   to '{"sub":"ba110000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select id from public.lot $q$,
  'a session with a password but no second factor sees no purchases'
);

-- ══════════════════════════ the cost is honest about its source (2)

reset role;

select is(
  public.holding_cost_source('bf660000-0000-4000-8000-00000000b001'),
  'lots',
  'a holding with recorded purchases derives its cost from them'
);

insert into public.holding (id, household_id, member_id, instrument_id, quantity, cost_minor)
values ('bf660000-0000-4000-8000-00000000b003', 'bc330000-0000-4000-8000-00000000e001',
        'bd440000-0000-4000-8000-00000000c001', 'be550000-0000-4000-8000-00000000f001', 7, 70000);

select is(
  public.holding_cost_source('bf660000-0000-4000-8000-00000000b003'),
  'holding',
  'and one entered before lots existed still shows the figure the sheet knew'
);

reset role;

select * from finish();

rollback;
