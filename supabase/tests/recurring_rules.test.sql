-- Family Finance Buddy — recurring rules: who reads and writes them, what posts them, and that a rule posts once per due date.
--
-- A rule is the household's. Its owner and partner read and write the shared ones and their own personal ones; a contributor reads the
-- rules under their own name and writes none; a viewer reads none; a stranger reads nothing of it. The poster (public.post_due_recurring)
-- runs as the caller, owner and partner only, with the second factor, and for the household it is given.
--
-- SC-I10 — A recurring rule posts once per due date: running the poster twice posts once, and an entry that was voided is not posted
-- again, because its row still holds the date.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(34);

-- ============================================================== the fixture
--
--   owner        household R (demo): a shared rule that is due, a personal rule of the partner's
--   partner      household R
--   contributor  household R: a rule under their own name
--   viewer       household R
--   stranger     owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@rec.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@rec.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@rec.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@rec.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd8000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c8000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e8000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e8000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f8000000-0000-4000-8000-0000000000a2', 'e8000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f8000000-0000-4000-8000-0000000000a3', 'e8000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f8000000-0000-4000-8000-0000000000a4', 'e8000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d8000000-0000-4000-8000-0000000000a1', 'e8000000-0000-4000-8000-0000000000f1',
   'f8000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d8000000-0000-4000-8000-0000000000a2', 'e8000000-0000-4000-8000-0000000000f1',
   'f8000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d8000000-0000-4000-8000-0000000000a3', 'e8000000-0000-4000-8000-0000000000f1',
   'f8000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d8000000-0000-4000-8000-0000000000a4', 'e8000000-0000-4000-8000-0000000000f1',
   'f8000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d8000000-0000-4000-8000-0000000000b1', 'e8000000-0000-4000-8000-0000000000f2',
   'f8000000-0000-4000-8000-0000000000b1', 'owner');

insert into public.expense_category (id, household_id, name, nature) values
  ('a8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', 'Electricity', 'fixed'),
  ('a8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f2', 'Elsewhere',   'fixed');

-- The tenth of the month two months ago, which is always a real day and always in the past: the rule has two or three due dates to post.
insert into public.recurring_rule
  (id, household_id, name, category_id, member_id, amount_minor, currency, cadence, due_day, next_due, visibility, created_by) values
  ('b8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-0000000000f1', 'Electricity',
   'a8000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-0000000000a1', 250000, 'INR', 'monthly', 10,
   (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date - interval '2 months'))::date + 9, 'household',
   'd8000000-0000-4000-8000-0000000000a1'),
  ('b8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-0000000000f1', 'Partner''s own',
   'a8000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-0000000000a2', 100000, 'INR', 'monthly', 10,
   (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date - interval '2 months'))::date + 9, 'personal',
   'd8000000-0000-4000-8000-0000000000a2'),
  ('b8000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-0000000000f1', 'Contributor''s',
   'a8000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-0000000000a3', 50000, 'INR', 'monthly', 10,
   (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date + interval '1 month'))::date + 9, 'household',
   'd8000000-0000-4000-8000-0000000000a2'),
  ('b8000000-0000-4000-8000-000000000004', 'e8000000-0000-4000-8000-0000000000f2', 'Elsewhere',
   'a8000000-0000-4000-8000-000000000002', 'f8000000-0000-4000-8000-0000000000b1', 90000, 'INR', 'monthly', 10,
   (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date - interval '2 months'))::date + 9, 'household',
   'd8000000-0000-4000-8000-0000000000b1');

-- ======================================================== the owner: reading (4)

set local role authenticated;
set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.recurring_rule),
  2,
  'the owner reads the household''s two shared rules, and not the partner''s personal one'
);

select is_empty(
  $q$ select id from public.recurring_rule where id = 'b8000000-0000-4000-8000-000000000004' $q$,
  'nor another household''s'
);

select throws_ok(
  $q$ delete from public.recurring_rule $q$,
  '42501'::char(5),
  null::text,
  'nobody deletes a rule: it is paused or archived'
);

select lives_ok(
  $q$ insert into public.recurring_rule (household_id, name, category_id, member_id, amount_minor, currency, cadence, due_day, next_due)
      values ('e8000000-0000-4000-8000-0000000000f1', 'DTH', 'a8000000-0000-4000-8000-000000000001',
              'f8000000-0000-4000-8000-0000000000a1', 40000, 'INR', 'monthly', 5,
              (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) + interval '1 month')::date + 4) $q$,
  'the owner makes a rule'
);

-- ===================================================== the poster, as the owner (8)

select is(
  (select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1')) >= 2,
  true,
  'the poster makes an entry for each due date up to today: at least the last two months'
);

select is(
  (select count(*)::int from public.expense_txn
    where recurring_rule_id = 'b8000000-0000-4000-8000-000000000001' and captured_via = 'rule' and category_id = 'a8000000-0000-4000-8000-000000000001'
      and amount_minor = 250000 and payee = 'Electricity' and due_date = txn_date),
  (select count(*)::int from public.expense_txn where recurring_rule_id = 'b8000000-0000-4000-8000-000000000001'),
  'each is the rule''s amount and payee, in the rule''s category, dated its due date, and says it was posted by a rule'
);

select is(
  (select next_due > (now() at time zone 'Asia/Kolkata')::date from public.recurring_rule where id = 'b8000000-0000-4000-8000-000000000001'),
  true,
  'and the rule is advanced past today'
);

select is(
  (select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1')),
  0,
  'SC-I10 — running it again posts nothing'
);

select is(
  (select count(*)::int from public.expense_txn where recurring_rule_id = 'b8000000-0000-4000-8000-000000000003'),
  0,
  'a rule that is not due is not posted'
);

select throws_ok(
  $q$ select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f2') $q$,
  '42501'::char(5),
  null::text,
  'and the owner of one household does not post another''s'
);

-- an entry that was voided still holds its date, so it is not posted again
select lives_ok(
  $q$ update public.expense_txn set voided_at = now(), voided_by = (select app.current_account_id())
       where recurring_rule_id = 'b8000000-0000-4000-8000-000000000001'
         and due_date = (select min(due_date) from public.expense_txn where recurring_rule_id = 'b8000000-0000-4000-8000-000000000001') $q$,
  'a posted entry is voided'
);

select is(
  (select count(*)::int from public.expense_txn
    where recurring_rule_id = 'b8000000-0000-4000-8000-000000000001' and voided_at is not null),
  1,
  'one is voided'
);

-- the rule is wound back, as if a second device had not yet seen it advance
reset role;
update public.recurring_rule
   set next_due = (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date - interval '2 months'))::date + 9
 where id = 'b8000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1')),
  0,
  'SC-I10 — wound back, it posts nothing, and the voided entry is not posted again'
);

-- ================================================================= the paused and the not-self-posting (2)

reset role;
update public.recurring_rule set status = 'paused', next_due = (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date - interval '3 months'))::date + 9
 where id = 'b8000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1')),
  0,
  'a paused rule posts nothing'
);

reset role;
update public.recurring_rule set status = 'active', auto_post = false where id = 'b8000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1')),
  0,
  'nor one that is not set to post itself'
);

-- ============================================================== the partner (3)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.recurring_rule),
  4,
  'the partner reads the shared rules, including the one the owner made, and their own personal one'
);

select lives_ok(
  $q$ update public.recurring_rule set status = 'paused' where id = 'b8000000-0000-4000-8000-000000000002' $q$,
  'and pauses their own'
);

select is(
  (select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1')) >= 0,
  true,
  'a partner posts too'
);

-- ================================================================ the contributor (4)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.recurring_rule),
  1,
  'a contributor reads only the rule under their own name'
);

select throws_ok(
  $q$ insert into public.recurring_rule (household_id, name, category_id, member_id, amount_minor, currency, cadence, due_day, next_due)
      values ('e8000000-0000-4000-8000-0000000000f1', 'Mine', 'a8000000-0000-4000-8000-000000000001',
              'f8000000-0000-4000-8000-0000000000a3', 100, 'INR', 'monthly', 5, date '2027-01-05') $q$,
  '42501'::char(5),
  null::text,
  'and writes none: the household''s rules are its owner''s and partner''s'
);

with attempted as (
  update public.recurring_rule set amount_minor = 1 where id = 'b8000000-0000-4000-8000-000000000003' returning 1
)
select is((select count(*)::int from attempted), 0, 'nor changes it');

select throws_ok(
  $q$ select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1') $q$,
  '42501'::char(5),
  null::text,
  'nor posts: that is an owner''s or a partner''s'
);

-- ===================================================================== the viewer (2)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.recurring_rule),
  0,
  'a viewer reads no rule'
);

select throws_ok(
  $q$ select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1') $q$,
  '42501'::char(5),
  null::text,
  'and posts none'
);

-- ================================================================= no second factor (2)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is(
  (select count(*)::int from public.recurring_rule),
  0,
  'a session with only a password reads no rule'
);

select throws_ok(
  $q$ select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1') $q$,
  '42501'::char(5),
  null::text,
  'and posts none'
);

-- ================================================================= the stranger (2)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.recurring_rule where household_id = 'e8000000-0000-4000-8000-0000000000f1'),
  0,
  'a stranger reads none of the household''s rules'
);

select throws_ok(
  $q$ select public.post_due_recurring('e8000000-0000-4000-8000-0000000000f1') $q$,
  '42501'::char(5),
  null::text,
  'and posts none of its entries'
);

-- ============================================================== the shape (5)

set local request.jwt.claim.sub to 'c8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c8000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.recurring_rule (household_id, name, category_id, member_id, amount_minor, currency, cadence, due_day, next_due)
      values ('e8000000-0000-4000-8000-0000000000f1', 'Wrong day', 'a8000000-0000-4000-8000-000000000001',
              'f8000000-0000-4000-8000-0000000000a1', 100, 'INR', 'monthly', 10, date '2027-01-11') $q$,
  '23514'::char(5),
  null::text,
  'the next due day is on the due day, so a rule is never nudged by a short month'
);

select throws_ok(
  $q$ insert into public.recurring_rule (household_id, name, category_id, member_id, amount_minor, currency, cadence, due_day, next_due)
      values ('e8000000-0000-4000-8000-0000000000f1', 'Nothing', 'a8000000-0000-4000-8000-000000000001',
              'f8000000-0000-4000-8000-0000000000a1', 0, 'INR', 'monthly', 10, date '2027-01-10') $q$,
  '23514'::char(5),
  null::text,
  'a rule of nothing is refused'
);

select throws_ok(
  $q$ insert into public.recurring_rule (household_id, name, category_id, member_id, amount_minor, currency, cadence, due_day, next_due)
      values ('e8000000-0000-4000-8000-0000000000f1', 'Day 31', 'a8000000-0000-4000-8000-000000000001',
              'f8000000-0000-4000-8000-0000000000a1', 100, 'INR', 'monthly', 31, date '2027-01-31') $q$,
  '23514'::char(5),
  null::text,
  'a due day exists in every month: 1 to 28'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, category_id, txn_date, amount_minor, currency, captured_via)
      values ('e8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000a1',
              'a8000000-0000-4000-8000-000000000001', date '2026-11-02', 100, 'INR', 'rule') $q$,
  '23514'::char(5),
  null::text,
  'an entry says it was posted by a rule only if it names the rule'
);

select throws_ok(
  $q$ insert into public.recurring_rule (household_id, name, category_id, member_id, amount_minor, currency, cadence, due_day, next_due)
      values ('e8000000-0000-4000-8000-0000000000f1', 'Elsewhere', 'a8000000-0000-4000-8000-000000000002',
              'f8000000-0000-4000-8000-0000000000a1', 100, 'INR', 'monthly', 10, date '2027-01-10') $q$,
  '23503'::char(5),
  null::text,
  'a rule''s category is the household''s own'
);

-- ============================================================ the log (1)

reset role;

select is(
  (select count(*)::int >= 1 from public.audit_log
    where entity = 'recurring_rule' and entity_id = 'b8000000-0000-4000-8000-000000000001' and action = 'update'
      and household_id = 'e8000000-0000-4000-8000-0000000000f1'),
  true,
  'what changes in a rule, the poster''s advance included, is in the audit log of its household'
);

select * from finish();

rollback;
