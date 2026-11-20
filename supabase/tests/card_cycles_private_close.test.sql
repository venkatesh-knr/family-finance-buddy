-- Family Finance Buddy — household_private_close counts a statement-date card by its window (docs/design/card-cycles.md section 6; CY-I12).
--
-- FOR REVIEW with the migration beside it (20261120130000_private_close_by_window.sql). Not run locally: Docker is blocked on the maintainer's machine, so CI's policy suite is the first run.
--
-- CY-I12 — what the caller cannot read, paid into a card that closes on its statement date, is counted in the card's window: a partner's private refund dated 20 October on the owner's card
--          billed on the 17th is in November's close and not October's, one dated 10 October is in October's, and the result still has no account, no member and no date.
-- Also: a card's first cycle (one statement, nothing before it) counts the month up to the statement; a month with no statement dated in it counts nothing and the next month counts it; a
-- typed due and a statement for one cycle are one cycle; and every other account is counted over the calendar month as it always was.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(9);

-- ============================================================== the fixture
--
--   owner, partner, contributor   household R (demo)
--   stranger                      owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a1' where auth_user_id = 'c8000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a2' where auth_user_id = 'c8000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a3' where auth_user_id = 'c8000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000b1' where auth_user_id = 'c8000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e8000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e8000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f8000000-0000-4000-8000-0000000000a2', 'e8000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f8000000-0000-4000-8000-0000000000a3', 'e8000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d8000000-0000-4000-8000-0000000000a2', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d8000000-0000-4000-8000-0000000000a3', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-0000000000f2', 'f8000000-0000-4000-8000-0000000000b1', 'owner');

-- R's accounts: four cards that close on their statement date (1 billed on the 17th; 2 with a single statement; 3 which skips February; 4 with a typed due beside its statement),
-- a savings account, and a card that closes at month end.
insert into public.account (id, household_id, member_id, name, type, currency, visibility, cycle_ends, created_by) values
  ('a8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1', 'Card billed on the 17th', 'card',    'INR', 'household', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('a8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1', 'Card with one statement', 'card',  'INR', 'household', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('a8000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1', 'Card that skips February', 'card', 'INR', 'household', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('a8000000-0000-4000-8000-000000000004', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1', 'Card with a typed due', 'card',    'INR', 'household', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('a8000000-0000-4000-8000-000000000005', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1', 'Savings',                'savings', 'INR', 'household', 'month_end', 'd8000000-0000-4000-8000-0000000000a1'),
  ('a8000000-0000-4000-8000-000000000006', 'e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1', 'Card at month end',      'card',    'INR', 'household', 'month_end', 'd8000000-0000-4000-8000-0000000000a1');

insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency, source, created_by) values
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000001', '2026-09-17', 2020000, 'INR', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000001', '2026-10-17', 2864000, 'INR', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000001', '2026-11-17', 2240000, 'INR', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000002', '2026-10-17', 1000000, 'INR', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000003', '2026-01-31', 1000000, 'INR', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000003', '2026-03-01', 1600000, 'INR', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000004', '2026-09-17', 2020000, 'INR', 'statement', 'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000004', '2026-10-17', 2900000, 'INR', 'typed',     'd8000000-0000-4000-8000-0000000000a1'),
  ('e8000000-0000-4000-8000-0000000000f1', 'a8000000-0000-4000-8000-000000000004', '2026-10-18', 2864000, 'INR', 'statement', 'd8000000-0000-4000-8000-0000000000a1');

-- The partner's private credits: refunds on the cards, and a salary into the savings account. All personal, so the owner cannot read them.
insert into public.credit_entry
  (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility, created_by) values
  ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'a8000000-0000-4000-8000-000000000001', 'refund',   129900, 'INR', '2026-10-10', 'personal', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'a8000000-0000-4000-8000-000000000001', 'refund',    70000, 'INR', '2026-10-20', 'personal', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'a8000000-0000-4000-8000-000000000002', 'refund',    10000, 'INR', '2026-10-03', 'personal', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'a8000000-0000-4000-8000-000000000002', 'refund',    20000, 'INR', '2026-10-20', 'personal', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'a8000000-0000-4000-8000-000000000003', 'refund',    30000, 'INR', '2026-02-10', 'personal', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'a8000000-0000-4000-8000-000000000004', 'refund',    40000, 'INR', '2026-10-18', 'personal', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'a8000000-0000-4000-8000-000000000005', 'salary',  5000000, 'INR', '2026-10-20', 'personal', 'd8000000-0000-4000-8000-0000000000a2'),
  ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a2', 'a8000000-0000-4000-8000-000000000006', 'refund',     6000, 'INR', '2026-10-20', 'personal', 'd8000000-0000-4000-8000-0000000000a2');

-- ============================================================== the owner, with a second factor

set local role authenticated;
set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

-- October: card 1's window is 18 September to 17 October, so its 10 October refund (₹1,299) is in and its 20 October refund is not; card 2's first cycle is 1 to 17 October, so its 3 October
-- refund (₹100) is in and its 20 October one is not; card 4's cycle ends on its statement of 18 October, the typed 17 October due being read for nothing, so its 18 October refund (₹400) is
-- in; the savings account and the month-end card are counted over the calendar month, so the 20 October salary and the ₹60 refund are in. Left is every credit, refunds the refunds.
select results_eq(
  $q$ select currency, left_minor, outside_minor, refunds_minor, came_in_minor, into_holdings_minor, out_of_holdings_minor
        from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  $q$ values ('INR'::text, 5185900::bigint, 0::bigint, 185900::bigint, 5000000::bigint, 0::bigint, 0::bigint) $q$,
  'CY-I12 — October counts each statement-date card over its window and every other account over the month: the 10 October refund is in, the 20 October one is not'
);

-- November: card 1's window is 18 October to 17 November, so the 20 October refund (₹700) is in November's; the other cards have no statement dated in November and nothing later,
-- so they wait, and count nothing.
select results_eq(
  $q$ select currency, left_minor, refunds_minor
        from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-11-01', '2026-11-30') $q$,
  $q$ values ('INR'::text, 70000::bigint, 70000::bigint) $q$,
  'CY-I12 — a partner''s private refund dated 20 October on the owner''s card billed on the 17th is in November''s close, not October''s'
);

-- February: card 3 has a statement on 31 January and one on 1 March, none dated in February, so February counts nothing of it; its 10 February refund is in March's window, 1 February to 1 March.
select is(
  (select count(*)::int from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-02-01', '2026-02-28')),
  0,
  'a month with no statement dated in it counts nothing of that card'
);

select results_eq(
  $q$ select currency, left_minor, refunds_minor
        from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-03-01', '2026-03-31') $q$,
  $q$ values ('INR'::text, 30000::bigint, 30000::bigint) $q$,
  'and the next month counts it, its window covering the whole of the skipped month'
);

select is(
  (select proargnames from pg_proc where proname = 'household_private_close'),
  array['target_household_id', 'month_first', 'month_last', 'currency', 'left_minor', 'outside_minor', 'refunds_minor',
        'came_in_minor', 'into_holdings_minor', 'out_of_holdings_minor']::text[],
  'its result is as it was: a currency and six sums, and no account, no member, no balance and no date'
);

select throws_ok(
  $q$ select * from public.household_private_close('e8000000-0000-4000-8000-0000000000f2', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'it raises for another household'
);

-- ============================================================== a contributor, and a password alone

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select * from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'a contributor reads no household close'
);

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select throws_ok(
  $q$ select * from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  '42501'::char(5), null::text,
  'and a password alone reads none'
);

-- ============================================================== the partner reads their own credits, so nothing of them is hidden from the partner

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.household_private_close('e8000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31')),
  0,
  'the partner''s own private credits are not hidden from the partner, so none are added to their close'
);

select * from finish();

rollback;
