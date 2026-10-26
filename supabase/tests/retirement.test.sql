-- Family Finance Buddy — retirement: who reads a PPF, who writes it, what shape a row may have, and that the notified rate
-- is readable and not editable.
--
-- A PPF's account and its entries are as private as the holding: an owner does not read a partner's personal PPF, a
-- contributor reads only their own, a viewer reads none. They do not state that themselves; they ask the holding's own
-- policy, and the first blocks are the proof that they do.
--
-- The rate table is the other shape, as `tax_rule` is: the same for every household and belonging to none, so the
-- assertions are that anybody signed in can read it and that nobody at all can write it.
--
-- The last blocks are the shape: a retirement holding has a type and nothing else has one, a deposit can no longer be a PPF,
-- an account and its entries belong to a PPF holding only, and an entry of nothing is refused.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(35);

-- ============================================================== the fixture
--
--   owner        a shared PPF (h1)
--   partner      a personal PPF (h2)
--   contributor  a shared PPF of their own (h3)
--   viewer       nothing
--   stranger     another household's PPF (h4)

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@ppf.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@ppf.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@ppf.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@ppf.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd5000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd5000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd5000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd5000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd5000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c5000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e5000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e5000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f5000000-0000-4000-8000-0000000000a1', 'e5000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f5000000-0000-4000-8000-0000000000a2', 'e5000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f5000000-0000-4000-8000-0000000000a3', 'e5000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f5000000-0000-4000-8000-0000000000a4', 'e5000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f5000000-0000-4000-8000-0000000000b1', 'e5000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d5000000-0000-4000-8000-0000000000a1', 'e5000000-0000-4000-8000-0000000000f1',
   'f5000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d5000000-0000-4000-8000-0000000000a2', 'e5000000-0000-4000-8000-0000000000f1',
   'f5000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d5000000-0000-4000-8000-0000000000a3', 'e5000000-0000-4000-8000-0000000000f1',
   'f5000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d5000000-0000-4000-8000-0000000000a4', 'e5000000-0000-4000-8000-0000000000f1',
   'f5000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d5000000-0000-4000-8000-0000000000b1', 'e5000000-0000-4000-8000-0000000000f2',
   'f5000000-0000-4000-8000-0000000000b1', 'owner');

insert into public.instrument
  (id, household_id, name, kind, currency, exposure_currency, is_foreign_asset, retirement_type) values
  ('a5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000f1', 'PPF one',   'retirement', 'INR', 'INR', false, 'ppf'),
  ('a5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-0000000000f1', 'PPF two',   'retirement', 'INR', 'INR', false, 'ppf'),
  ('a5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-0000000000f1', 'PPF three', 'retirement', 'INR', 'INR', false, 'ppf'),
  ('a5000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-0000000000f2', 'PPF four',  'retirement', 'INR', 'INR', false, 'ppf'),
  ('a5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-0000000000f1', 'A fund',    'mutual_fund', 'INR', 'INR', false, null);

insert into public.holding
  (id, household_id, member_id, instrument_id, quantity, visibility) values
  ('b5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000f1',
   'f5000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000001', 1, 'household'),
  ('b5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-0000000000f1',
   'f5000000-0000-4000-8000-0000000000a2', 'a5000000-0000-4000-8000-000000000002', 1, 'personal'),
  ('b5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-0000000000f1',
   'f5000000-0000-4000-8000-0000000000a3', 'a5000000-0000-4000-8000-000000000003', 1, 'household'),
  ('b5000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-0000000000f2',
   'f5000000-0000-4000-8000-0000000000b1', 'a5000000-0000-4000-8000-000000000004', 1, 'household'),
  ('b5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-0000000000f1',
   'f5000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000009', 10, 'household');

insert into public.ppf_account
  (holding_id, household_id, institution, account_last4, opening_date, opening_balance_minor, currency, created_by) values
  ('b5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000f1', 'SBI', '1234',
   date '2025-03-31', 10000000, 'INR', 'd5000000-0000-4000-8000-0000000000a1'),
  ('b5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-0000000000f1', 'Post office', '5678',
   date '2025-03-31', 20000000, 'INR', 'd5000000-0000-4000-8000-0000000000a2'),
  ('b5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-0000000000f1', 'HDFC', '9012',
   date '2025-03-31', 5000000, 'INR', 'd5000000-0000-4000-8000-0000000000a3'),
  ('b5000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-0000000000f2', 'SBI', '3456',
   date '2025-03-31', 30000000, 'INR', 'd5000000-0000-4000-8000-0000000000b1');

insert into public.ppf_entry
  (id, household_id, holding_id, entry_date, amount_minor, currency, created_by) values
  ('c5a00000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000f1',
   'b5000000-0000-4000-8000-000000000001', date '2025-04-04', 15000000, 'INR', 'd5000000-0000-4000-8000-0000000000a1'),
  ('c5a00000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-0000000000f1',
   'b5000000-0000-4000-8000-000000000002', date '2025-04-04', 5000000, 'INR', 'd5000000-0000-4000-8000-0000000000a2'),
  ('c5a00000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-0000000000f1',
   'b5000000-0000-4000-8000-000000000003', date '2025-04-04', 2500000, 'INR', 'd5000000-0000-4000-8000-0000000000a3'),
  ('c5a00000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-0000000000f2',
   'b5000000-0000-4000-8000-000000000004', date '2025-04-04', 7500000, 'INR', 'd5000000-0000-4000-8000-0000000000b1');

-- ============================================ the owner: the shared ones (6)

set local role authenticated;
set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.ppf_account),
  2,
  'the owner reads the two shared PPF accounts, and not the partner''s personal one'
);

select is_empty(
  $q$ select holding_id from public.ppf_account where holding_id = 'b5000000-0000-4000-8000-000000000002' $q$,
  'a personal PPF''s account is not the owner''s to read, the rule the holding states'
);

select is_empty(
  $q$ select id from public.ppf_entry where holding_id = 'b5000000-0000-4000-8000-000000000004' $q$,
  'and nothing of another household''s'
);

select is(
  (select count(*)::int from public.ppf_entry),
  2,
  'the owner reads the payments into the two shared accounts and not into the personal one'
);

select lives_ok(
  $q$ insert into public.ppf_entry (household_id, holding_id, entry_date, amount_minor, currency)
      values ('e5000000-0000-4000-8000-0000000000f1', 'b5000000-0000-4000-8000-000000000001',
              date '2025-05-05', 5000000, 'INR') $q$,
  'the owner records a payment into their own shared PPF'
);

select throws_ok(
  $q$ insert into public.ppf_entry (household_id, holding_id, entry_date, amount_minor, currency)
      values ('e5000000-0000-4000-8000-0000000000f1', 'b5000000-0000-4000-8000-000000000002',
              date '2025-05-05', 100, 'INR') $q$,
  '42501'::char(5),
  null::text,
  'but cannot record one into the partner''s personal PPF, which they cannot read'
);

-- ============================================================ the partner (2)

set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.ppf_account),
  3,
  'the partner reads the two shared accounts and their own personal one'
);

select is(
  (select count(*)::int from public.ppf_entry),
  4,
  'and every payment into those three, the one the owner just recorded included'
);

-- ================================================ the contributor: their own (5)

set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.ppf_account),
  1,
  'a contributor reads only their own PPF account'
);

select is(
  (select count(*)::int from public.ppf_entry),
  1,
  'and only the payments into it'
);

select lives_ok(
  $q$ insert into public.ppf_entry (household_id, holding_id, entry_date, amount_minor, currency)
      values ('e5000000-0000-4000-8000-0000000000f1', 'b5000000-0000-4000-8000-000000000003',
              date '2025-06-04', 1000000, 'INR') $q$,
  'a contributor records a payment into their own PPF'
);

select throws_ok(
  $q$ insert into public.ppf_entry (household_id, holding_id, entry_date, amount_minor, currency)
      values ('e5000000-0000-4000-8000-0000000000f1', 'b5000000-0000-4000-8000-000000000001',
              date '2025-06-04', 100, 'INR') $q$,
  '42501'::char(5),
  null::text,
  'but not into the owner''s shared PPF, which they cannot read'
);

with attempted as (
  update public.ppf_account set institution = 'Renamed' where holding_id = 'b5000000-0000-4000-8000-000000000001'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'nor rewrite its account'
);

-- ============================================================ the viewer (3)

set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select holding_id::text from public.ppf_account
      union all select id::text from public.ppf_entry $q$,
  'a viewer reads no PPF account and no payment: a summary is the whole of what they are given'
);

select throws_ok(
  $q$ insert into public.ppf_entry (household_id, holding_id, entry_date, amount_minor, currency)
      values ('e5000000-0000-4000-8000-0000000000f1', 'b5000000-0000-4000-8000-000000000001',
              date '2025-06-04', 100, 'INR') $q$,
  '42501'::char(5),
  null::text,
  'and cannot record one'
);

select throws_ok(
  $q$ delete from public.ppf_account $q$,
  '42501'::char(5),
  null::text,
  'nobody can delete a PPF account: a wrong figure is corrected in place, and the audit log keeps the version it replaced'
);

-- ======================================================= a password alone (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select holding_id from public.ppf_account $q$,
  'a session with a password but no second factor reads no PPF account'
);

-- ============================================= the audit rows are as private (3)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'c5000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c5000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'ppf_entry' and after ->> 'holding_id' = 'b5000000-0000-4000-8000-000000000002' $q$,
  'the owner does not read the audit row for a payment into the partner''s personal PPF, its amount inside it'
);

select is_empty(
  $q$ select id from public.audit_log
      where entity = 'ppf_account' and after ->> 'holding_id' = 'b5000000-0000-4000-8000-000000000002' $q$,
  'nor the audit row for its account, with its opening balance'
);

select isnt_empty(
  $q$ select id from public.audit_log
      where entity = 'ppf_entry' and after ->> 'holding_id' = 'b5000000-0000-4000-8000-000000000001' $q$,
  'while the audit row for a shared PPF''s payment is readable: the log is not switched off'
);

-- ============================================ the rate: readable, not editable (4)

select is(
  (select rate_pct::text from public.scheme_rate where scheme = 'ppf' and effective_from = date '2020-04-01'),
  '7.100',
  'the notified rate is readable by anyone signed in: 7.1% from 1 April 2020'
);

select ok(
  not has_table_privilege('authenticated', 'public.scheme_rate', 'insert'),
  'and no client can add one: a household that could edit the rate could compute the figure it liked'
);

select ok(
  not has_table_privilege('authenticated', 'public.scheme_rate', 'update'),
  'or change one'
);

select ok(
  not has_table_privilege('authenticated', 'public.scheme_rate', 'delete'),
  'or remove one'
);

-- ========================================= malformed rows are refused by the table (11)
--
-- As the owner of the tables, which is how a migration would write one. A check, a key or the integrity trigger applies to
-- everybody, so this is the refusal a client would meet.

reset role;

select lives_ok(
  $q$ insert into public.instrument (household_id, name, kind, currency, exposure_currency, is_foreign_asset, retirement_type)
      values ('e5000000-0000-4000-8000-0000000000f1', 'An NPS', 'retirement', 'INR', 'INR', false, 'nps') $q$,
  'an NPS is a retirement holding with a type'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, currency, exposure_currency, is_foreign_asset)
      values ('e5000000-0000-4000-8000-0000000000f1', 'No type', 'retirement', 'INR', 'INR', false) $q$,
  '23514'::char(5),
  null::text,
  'a retirement holding with no type is refused: it is an EPF, an NPS or a PPF'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, currency, exposure_currency, is_foreign_asset, retirement_type)
      values ('e5000000-0000-4000-8000-0000000000f1', 'A typed fund', 'mutual_fund', 'INR', 'INR', false, 'epf') $q$,
  '23514'::char(5),
  null::text,
  'and a type on anything else is refused'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, currency, exposure_currency, is_foreign_asset, retirement_type)
      values ('e5000000-0000-4000-8000-0000000000f1', 'Not a type', 'retirement', 'INR', 'INR', false, 'nsc') $q$,
  '23514'::char(5),
  null::text,
  'a type that is not one of the three is refused'
);

select throws_ok(
  $q$ insert into public.instrument (household_id, name, kind, currency, exposure_currency, is_foreign_asset, scheme)
      values ('e5000000-0000-4000-8000-0000000000f1', 'A PPF deposit', 'deposit', 'INR', 'INR', false, 'ppf') $q$,
  '23514'::char(5),
  null::text,
  'a deposit can no longer be a PPF: it is a retirement holding now'
);

select throws_ok(
  $q$ insert into public.ppf_account
        (holding_id, household_id, opening_date, opening_balance_minor, currency, created_by)
      values ('b5000000-0000-4000-8000-000000000009', 'e5000000-0000-4000-8000-0000000000f1',
              date '2025-03-31', 100, 'INR', 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5),
  null::text,
  'a PPF account on a fund is refused: an account belongs to a PPF holding'
);

select throws_ok(
  $q$ insert into public.ppf_entry (household_id, holding_id, entry_date, amount_minor, currency, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', 'b5000000-0000-4000-8000-000000000009',
              date '2025-04-04', 100, 'INR', 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5),
  null::text,
  'and so is a payment into a fund'
);

select throws_ok(
  $q$ insert into public.ppf_entry (household_id, holding_id, entry_date, amount_minor, currency, created_by)
      values ('e5000000-0000-4000-8000-0000000000f1', 'b5000000-0000-4000-8000-000000000001',
              date '2025-04-04', 0, 'INR', 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5),
  null::text,
  'a payment of nothing is refused'
);

select throws_ok(
  $q$ update public.ppf_account set opening_balance_minor = -1 where holding_id = 'b5000000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5),
  null::text,
  'an opening balance below nothing is refused'
);

select throws_ok(
  $q$ insert into public.ppf_account
        (holding_id, household_id, opening_date, opening_balance_minor, currency, created_by)
      values ('b5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000f1',
              date '2025-03-31', 100, 'INR', 'd5000000-0000-4000-8000-0000000000a1') $q$,
  '23505'::char(5),
  null::text,
  'one account for a holding: a second is refused'
);

select throws_ok(
  $q$ insert into public.scheme_rate (scheme, effective_from, rate_pct) values ('ppf', date '2020-04-01', 7.200) $q$,
  '23505'::char(5),
  null::text,
  'two rates for one day are refused: a change is a row appended on a later day'
);

select * from finish();

rollback;
