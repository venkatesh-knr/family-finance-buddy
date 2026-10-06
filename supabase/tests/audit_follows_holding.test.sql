-- Family Finance Buddy — an audit row about a position is as private as the position.
--
-- Section 20 says the line-item detail of a personal entry is returned to nobody
-- else, the owner included, and the audit log carries `before` and `after` in
-- full. `rls_private_entries.test.sql` proves that for an expense and for a
-- valuation snapshot. This is the same proof for what hangs off a holding the
-- same way and was not covered: a purchase (`lot`) and a sale (`disposal`),
-- whose cost and proceeds give the gain.
--
-- Until 20260927120000 an owner could read both in the log for a partner's
-- personal holding. The first assertions fail on that migration's absence, which
-- is the point of writing them first.
--
-- One household, an owner and a partner. The partner has a personal holding and
-- the owner a shared one, each with a purchase; the partner's also has a sale and
-- a reading. Amounts are distinct so a leaked figure is recognisable.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(10);

-- ============================================================== the fixture

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@audit.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@audit.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd1000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c1000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd1000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c1000000-0000-4000-8000-0000000000a2';

insert into public.household (id, name, kind) values
  ('e1000000-0000-4000-8000-0000000000f1', 'Household A', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f1000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000f1', 'Owner',   'c1'),
  ('f1000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-0000000000f1', 'Partner', 'c2');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d1000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-0000000000f1',
   'f1000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d1000000-0000-4000-8000-0000000000a2', 'e1000000-0000-4000-8000-0000000000f1',
   'f1000000-0000-4000-8000-0000000000a2', 'partner');

insert into public.instrument
  (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset) values
  ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-0000000000f1',
   'A fund', 'mutual_fund', 'INR', 'INR', false);

insert into public.holding
  (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-0000000000f1',
   'f1000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000001', 10, 'household'),
  ('b1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-0000000000f1',
   'f1000000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-000000000001', 20, 'personal');

-- Inserted as the owner of the tables, which is how a migration would, so the
-- audit trigger writes its rows exactly as it does for a client.
insert into public.lot
  (id, household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by) values
  ('c2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-0000000000f1',
   'b1000000-0000-4000-8000-000000000001', date '2025-01-10', 10, 1111100, 'INR',
   'd1000000-0000-4000-8000-0000000000a1'),
  ('c2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-0000000000f1',
   'b1000000-0000-4000-8000-000000000002', date '2025-02-10', 20, 7777700, 'INR',
   'd1000000-0000-4000-8000-0000000000a2');

insert into public.disposal
  (id, household_id, holding_id, disposed_on, quantity, proceeds_minor, currency, created_by) values
  ('d2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-0000000000f1',
   'b1000000-0000-4000-8000-000000000002', date '2025-09-10', 5, 3333300, 'INR',
   'd1000000-0000-4000-8000-0000000000a2');

insert into public.valuation_snapshot
  (id, household_id, holding_id, as_of_date, quantity, value_minor, currency, created_by) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-0000000000f1',
   'b1000000-0000-4000-8000-000000000002', date '2025-09-30', 15, 9999900, 'INR',
   'd1000000-0000-4000-8000-0000000000a2');

-- The rows exist: without this, "the owner reads none of it" would pass on a log
-- that was simply empty.
select is(
  (select count(*)::int from public.audit_log
    where entity in ('lot', 'disposal') and household_id = 'e1000000-0000-4000-8000-0000000000f1'),
  3,
  'the trigger wrote an audit row for each of the two purchases and the sale'
);

-- ===================================== the owner: not for a partner's personal (6)

set local role authenticated;
set local request.jwt.claim.sub to 'c1000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c1000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'lot' and entity_id = 'c2000000-0000-4000-8000-000000000002' $q$,
  'the owner cannot read the audit row for a purchase of a partner personal holding'
);

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'disposal' and entity_id = 'd2000000-0000-4000-8000-000000000001' $q$,
  'nor for its sale'
);

-- Said again against the payload, because that is where the figure is: the cost
-- and the proceeds sit inside `after` in full, and together they are the gain.
select is_empty(
  $q$ select after ->> 'cost_minor' from public.audit_log
      where after ->> 'holding_id' = 'b1000000-0000-4000-8000-000000000002'
        and entity in ('lot', 'disposal', 'valuation_snapshot') $q$,
  'nor does the cost, the proceeds or the value inside it reach the owner by any entity'
);

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'valuation_snapshot' and entity_id = 'e2000000-0000-4000-8000-000000000001' $q$,
  'and the snapshot, which the earlier rule covered, is still covered by this one'
);

select isnt_empty(
  $q$ select id from public.audit_log
      where entity = 'lot' and entity_id = 'c2000000-0000-4000-8000-000000000001' $q$,
  'while the audit row for a purchase of a shared holding is readable: the log is not switched off'
);

select is(
  (select count(*)::int from public.audit_log where entity in ('lot', 'disposal')),
  1,
  'so the owner reads exactly one audit row about purchases and sales: their own shared one'
);

-- ====================================== the partner: their own is theirs to read (3)

set local request.jwt.claim.sub to 'c1000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c1000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

-- The row names no member of its own, so what lets the holder read it is the
-- holding: they can read that, and so they can read what was recorded about it.
select isnt_empty(
  $q$ select id from public.audit_log
      where entity = 'lot' and entity_id = 'c2000000-0000-4000-8000-000000000002' $q$,
  'the partner reads the audit row for their own purchase, because they can read the holding it is about'
);

select isnt_empty(
  $q$ select id from public.holding where id = 'b1000000-0000-4000-8000-000000000002' $q$,
  'while the holder still reads their own holding, so nothing here took their position from them'
);

select isnt_empty(
  $q$ select id from public.lot where id = 'c2000000-0000-4000-8000-000000000002' $q$,
  'and its purchase, by the table and not by the log'
);

select * from finish();

rollback;
