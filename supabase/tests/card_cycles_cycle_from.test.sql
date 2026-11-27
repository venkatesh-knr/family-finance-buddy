-- Family Finance Buddy — a card switched to its statement date keeps the months it was closed at month end (docs/design/card-cycles.md section 6.1; CY-I18).
--
-- FOR REVIEW with the migration beside it (20261127120000_card_cycle_from.sql). Not run locally: Docker is blocked on the maintainer's machine, so CI's policy suite is the first run.
--
-- CY-I18 — switching a card to its statement date starts it from the month after its latest month-end due (and from no month for a card with none), never earlier; switching back is refused once a
--          due is dated in or after that month, and clears it when allowed; it is set by a switch and by nothing else; and what the database counts of a month already closed is counted over the
--          calendar month, as it was, while the month it was switched in opens at the month-end due and not at the statement's previous balance.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(14);

-- ============================================================== the fixture: one household, its owner and a partner

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c9000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a1' where auth_user_id = 'c9000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd9000000-0000-4000-8000-0000000000a2' where auth_user_id = 'c9000000-0000-4000-8000-0000000000a2';

insert into public.household (id, name, kind) values
  ('e9000000-0000-4000-8000-0000000000f1', 'Household R', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f9000000-0000-4000-8000-0000000000a1', 'e9000000-0000-4000-8000-0000000000f1', 'Owner',   'c1'),
  ('f9000000-0000-4000-8000-0000000000a2', 'e9000000-0000-4000-8000-0000000000f1', 'Partner', 'c2');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d9000000-0000-4000-8000-0000000000a1', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d9000000-0000-4000-8000-0000000000a2', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2', 'partner');

-- Four cards that close at month end: A and C and D with dues of 30 September and 31 October (A and C also with the statement of 17 October whose previous balance the import records),
-- and B with none.
insert into public.account (id, household_id, member_id, name, type, currency, visibility, cycle_ends, created_by) values
  ('a9000000-0000-4000-8000-00000000000a', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'Card A', 'card', 'INR', 'household', 'month_end', 'd9000000-0000-4000-8000-0000000000a1'),
  ('a9000000-0000-4000-8000-00000000000b', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'Card B', 'card', 'INR', 'household', 'month_end', 'd9000000-0000-4000-8000-0000000000a1'),
  ('a9000000-0000-4000-8000-00000000000c', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'Card C', 'card', 'INR', 'household', 'month_end', 'd9000000-0000-4000-8000-0000000000a1'),
  ('a9000000-0000-4000-8000-00000000000d', 'e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'Card D', 'card', 'INR', 'household', 'month_end', 'd9000000-0000-4000-8000-0000000000a1');

insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency, source, created_by)
select 'e9000000-0000-4000-8000-0000000000f1', c.id, d.as_at, d.minor, 'INR', d.source, 'd9000000-0000-4000-8000-0000000000a1'
  from (values ('a9000000-0000-4000-8000-00000000000a'::uuid), ('a9000000-0000-4000-8000-00000000000c'::uuid), ('a9000000-0000-4000-8000-00000000000d'::uuid)) as c(id)
 cross join (values (date '2026-09-30', 1500000::bigint, 'typed'), (date '2026-10-31', 2400000::bigint, 'typed')) as d(as_at, minor, source);

insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency, source, created_by)
select 'e9000000-0000-4000-8000-0000000000f1', c.id, date '2026-10-17', 2000000, 'INR', 'statement', 'd9000000-0000-4000-8000-0000000000a1'
  from (values ('a9000000-0000-4000-8000-00000000000a'::uuid), ('a9000000-0000-4000-8000-00000000000c'::uuid)) as c(id);

-- ============================================================== a new card, and a first month on a card at month end

select throws_ok(
  $q$ insert into public.account (household_id, member_id, name, type, currency, visibility, cycle_ends, cycle_from, created_by)
      values ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a1', 'Card N', 'card', 'INR', 'household', 'statement', '2026-11-01', 'd9000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), 'A new card has no month closed before it, so it has no first month on its statement date.',
  'CY-I18 — a new card has no first month: nothing was closed before it'
);

select throws_ok(
  $q$ update public.account set cycle_from = '2026-11-01' where id = 'a9000000-0000-4000-8000-00000000000a' $q$,
  '23514'::char(5), null::text,
  'CY-I18 — a card at month end has no first month on its statement date'
);

-- ============================================================== switching

update public.account set cycle_ends = 'statement' where id = 'a9000000-0000-4000-8000-00000000000b';
select is(
  (select cycle_from from public.account where id = 'a9000000-0000-4000-8000-00000000000b'),
  null::date,
  'CY-I18 — a card with no month-end due switches to its statement date in every month'
);

update public.account set cycle_ends = 'statement' where id = 'a9000000-0000-4000-8000-00000000000a';
select is(
  (select cycle_from from public.account where id = 'a9000000-0000-4000-8000-00000000000a'),
  '2026-11-01'::date,
  'CY-I18 — a card closed at month end through 31 October starts on its statement date in November, not on the 17 October its statement prints as its previous balance'
);

select throws_ok(
  $q$ update public.account set cycle_ends = 'statement', cycle_from = '2026-10-01' where id = 'a9000000-0000-4000-8000-00000000000c' $q$,
  '23514'::char(5), 'The months up to October 2026 were closed at month end and stay as they were, so the statement date can start from November 2026 at the earliest.',
  'CY-I18 — and it cannot be asked to start earlier than that: October was closed'
);

select lives_ok(
  $q$ update public.account set cycle_ends = 'statement', cycle_from = '2026-12-01' where id = 'a9000000-0000-4000-8000-00000000000c' $q$,
  'CY-I18 — it can be asked to start later, leaving November closed at month end too'
);
select is(
  (select cycle_from from public.account where id = 'a9000000-0000-4000-8000-00000000000c'),
  '2026-12-01'::date,
  'and the month asked for is the month kept'
);

select throws_ok(
  $q$ update public.account set cycle_from = '2027-01-01' where id = 'a9000000-0000-4000-8000-00000000000a' $q$,
  '23514'::char(5), 'The first month on the statement date is set when the card is switched and does not change after.',
  'CY-I18 — the first month is set by a switch and by nothing else'
);

-- ============================================================== switching back

insert into public.account_balance (household_id, account_id, as_at, balance_minor, currency, source, created_by) values
  ('e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-00000000000a', '2026-11-17', 2240000, 'INR', 'statement', 'd9000000-0000-4000-8000-0000000000a1');

select throws_ok(
  $q$ update public.account set cycle_ends = 'month_end' where id = 'a9000000-0000-4000-8000-00000000000a' $q$,
  '23514'::char(5), 'This card has dues recorded on its statement date, so it cannot go back to month end: months already closed would change.',
  'CY-I18 — switching back is refused once a statement under the rule is in use'
);

update public.account set cycle_ends = 'statement' where id = 'a9000000-0000-4000-8000-00000000000d';
select lives_ok(
  $q$ update public.account set cycle_ends = 'month_end' where id = 'a9000000-0000-4000-8000-00000000000d' $q$,
  'CY-I18 — and allowed while none is'
);
select is(
  (select cycle_from from public.account where id = 'a9000000-0000-4000-8000-00000000000d'),
  null::date,
  'and it clears the first month'
);

-- ============================================================== a month already closed is not counted by window

select throws_ok(
  $q$ insert into public.close_without_card (household_id, account_id, month, created_by)
      values ('e9000000-0000-4000-8000-0000000000f1', 'a9000000-0000-4000-8000-00000000000a', '2026-10-01', 'd9000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), 'Only a card whose bill closes on its statement date can be left out of a close, and only for a month it closes on it.',
  'CY-I18 — a card is not left out of a month it closed at month end'
);

-- The partner's private refunds on card A: ₹700 on 20 October (in a month closed at month end) and ₹100 on 5 November.
insert into public.credit_entry
  (household_id, member_id, account_id, category, amount_minor, currency, credit_date, visibility, created_by) values
  ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2', 'a9000000-0000-4000-8000-00000000000a', 'refund', 70000, 'INR', '2026-10-20', 'personal', 'd9000000-0000-4000-8000-0000000000a2'),
  ('e9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000a2', 'a9000000-0000-4000-8000-00000000000a', 'refund', 10000, 'INR', '2026-11-05', 'personal', 'd9000000-0000-4000-8000-0000000000a2');

set local role authenticated;
set local request.jwt.claim.sub to 'c9000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c9000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

-- Without the first month, card A's window for November would run from 18 October (the previous balance of the 17 November statement is the 17 October statement's due) and take the 20 October
-- refund into November; with it, October is counted over the calendar month and November's window is 1 to 17 November.
select results_eq(
  $q$ select left_minor, refunds_minor from public.household_private_close('e9000000-0000-4000-8000-0000000000f1', '2026-10-01', '2026-10-31') $q$,
  $q$ values (70000::bigint, 70000::bigint) $q$,
  'CY-I18 — October, closed at month end, counts the 20 October refund over the calendar month, as it did'
);

select results_eq(
  $q$ select left_minor, refunds_minor from public.household_private_close('e9000000-0000-4000-8000-0000000000f1', '2026-11-01', '2026-11-30') $q$,
  $q$ values (10000::bigint, 10000::bigint) $q$,
  'CY-I18 — November opens at the 31 October due: the 5 November refund is in its window of 1 to 17 November and the 20 October one is counted nowhere twice'
);

select * from finish();

rollback;
