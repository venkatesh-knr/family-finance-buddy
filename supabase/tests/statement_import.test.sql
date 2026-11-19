-- Family Finance Buddy — statement import (spending-capture.md sections 4 and 7; SC-I5, SC-I8).
--
-- FOR REVIEW with the migration beside it (20261119120000_statement_import.sql). Not run locally: Docker is blocked on the maintainer's machine, so CI's policy suite is the
-- first run.
--
-- SC-I5 — a payment is one entry: one live entry for a UPI reference in a household, one entry for an imported line, one witness for a line hash.
-- SC-I8 — a UPI reference is its last four and a hash, as a pair; nothing else of it is stored.
-- Access — a witness is read by whoever can read the entry it witnesses, and so is its audit row; an owner or a partner add one to an entry they can read, a contributor only to
-- their own; a viewer and another household write nothing; and nobody updates or deletes one.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(41);

-- ============================================================== the fixture
--
--   owner        household R (demo)
--   partner      household R
--   contributor  household R
--   viewer       household R
--   stranger     owner of household S

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@sim.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'd6000000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'c6000000-0000-4000-8000-0000000000a1';
update public.user_account set id = 'd6000000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'c6000000-0000-4000-8000-0000000000a2';
update public.user_account set id = 'd6000000-0000-4000-8000-0000000000a3'
  where auth_user_id = 'c6000000-0000-4000-8000-0000000000a3';
update public.user_account set id = 'd6000000-0000-4000-8000-0000000000a4'
  where auth_user_id = 'c6000000-0000-4000-8000-0000000000a4';
update public.user_account set id = 'd6000000-0000-4000-8000-0000000000b1'
  where auth_user_id = 'c6000000-0000-4000-8000-0000000000b1';

insert into public.household (id, name, kind) values
  ('e6000000-0000-4000-8000-0000000000f1', 'Household R', 'demo'),
  ('e6000000-0000-4000-8000-0000000000f2', 'Household S', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('f6000000-0000-4000-8000-0000000000a1', 'e6000000-0000-4000-8000-0000000000f1', 'Owner',       'c1'),
  ('f6000000-0000-4000-8000-0000000000a2', 'e6000000-0000-4000-8000-0000000000f1', 'Partner',     'c2'),
  ('f6000000-0000-4000-8000-0000000000a3', 'e6000000-0000-4000-8000-0000000000f1', 'Contributor', 'c3'),
  ('f6000000-0000-4000-8000-0000000000a4', 'e6000000-0000-4000-8000-0000000000f1', 'Viewer',      'c4'),
  ('f6000000-0000-4000-8000-0000000000b1', 'e6000000-0000-4000-8000-0000000000f2', 'Stranger',    'c5');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d6000000-0000-4000-8000-0000000000a1', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d6000000-0000-4000-8000-0000000000a2', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d6000000-0000-4000-8000-0000000000a3', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d6000000-0000-4000-8000-0000000000a4', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d6000000-0000-4000-8000-0000000000b1', 'e6000000-0000-4000-8000-0000000000f2', 'f6000000-0000-4000-8000-0000000000b1', 'owner');

-- Accounts: R has a rupee account and a dollar account; S has a rupee account.
insert into public.account (id, household_id, member_id, name, type, currency, visibility, created_by) values
  ('a6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1',
   'R savings', 'savings', 'INR', 'household', 'd6000000-0000-4000-8000-0000000000a1'),
  ('a6000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1',
   'R dollars', 'savings', 'USD', 'household', 'd6000000-0000-4000-8000-0000000000a1'),
  ('a6000000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-0000000000f2', 'f6000000-0000-4000-8000-0000000000b1',
   'S savings', 'savings', 'INR', 'household', 'd6000000-0000-4000-8000-0000000000b1');

-- A statement batch for each household.
insert into public.import_batch (id, household_id, kind, label, row_count, account_id, created_by) values
  ('b6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-0000000000f1', 'hdfc_text', 'R statement', 3,
   'a6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-0000000000a1'),
  ('b6000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-0000000000f2', 'hdfc_text', 'S statement', 1,
   'a6000000-0000-4000-8000-000000000003', 'd6000000-0000-4000-8000-0000000000b1');

-- Entries. E1 is the owner's and shared, with a UPI reference. E2 is the owner's and private. E3 is the contributor's. E4 is the partner's. ES is household S's.
insert into public.expense_txn
  (id, household_id, member_id, txn_date, amount_minor, currency, payee, visibility, upi_ref_last4, upi_ref_hash, created_by) values
  ('e6100000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1',
   '2020-01-05', 22400, 'INR', 'Shop', 'household', '0002', repeat('1', 64), 'd6000000-0000-4000-8000-0000000000a1'),
  ('e6100000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1',
   '2020-01-06', 10000, 'INR', 'Private shop', 'personal', null, null, 'd6000000-0000-4000-8000-0000000000a1'),
  ('e6100000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a3',
   '2020-01-07', 5000, 'INR', 'Contributor shop', 'household', null, null, 'd6000000-0000-4000-8000-0000000000a3'),
  ('e6100000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a2',
   '2020-01-08', 7000, 'INR', 'Partner shop', 'household', null, null, 'd6000000-0000-4000-8000-0000000000a2'),
  ('e6100000-0000-4000-8000-0000000000f2', 'e6000000-0000-4000-8000-0000000000f2', 'f6000000-0000-4000-8000-0000000000b1',
   '2020-01-09', 9000, 'INR', 'S shop', 'household', null, null, 'd6000000-0000-4000-8000-0000000000b1');

-- ============================================== the batch: its formats and its account, as the database owner

select lives_ok(
  $q$ insert into public.import_batch (household_id, kind, label, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'gpay_pdf', 'Google Pay', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  'a Google Pay statement is a kind of batch, and is of no account'
);

select lives_ok(
  $q$ insert into public.import_batch (household_id, kind, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'ecas_cams', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  'the kinds that were there stay'
);

select throws_ok(
  $q$ insert into public.import_batch (household_id, kind, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'a_format_nobody_parses', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'a kind that is not named is refused'
);

select throws_ok(
  $q$ insert into public.import_batch (household_id, kind, account_id, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'hdfc_text', 'a6000000-0000-4000-8000-000000000003', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'a statement is of an account of this household, and not another''s'
);

-- ============================================== an entry knows where it came from, as the database owner

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, upi_ref_last4, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-01', 100, 'INR', '1234', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I8 — a last four with no hash to match by is refused: the two are one fact'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, upi_ref_last4, upi_ref_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-01', 100, 'INR', '1234', 'not-a-hash', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I8 — a hash is 64 hex digits and nothing else'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, upi_ref_last4, upi_ref_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-01', 100, 'INR', '123456789012', repeat('2', 64), 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I8 — only four digits of a reference are kept, never the reference'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, source_batch_id, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-01', 100, 'INR', 'b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'an entry from a batch says which line: a batch with no line hash is refused'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, captured_via, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-01', 100, 'INR', 'import', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'an entry captured by import names its batch'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, captured_via, source_batch_id, source_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-01', 100, 'INR', 'typed',
              'b6000000-0000-4000-8000-000000000001', repeat('3', 64), 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'and an entry with a batch is captured by import, not typed'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, account_id, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-01', 100, 'INR', 'a6000000-0000-4000-8000-000000000003', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'an entry is paid from an account of its own household'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, account_id, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-01', 100, 'INR', 'a6000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'and in its own currency: a rupee entry is not paid from a dollar account'
);

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, upi_ref_last4, upi_ref_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a2', '2020-02-01', 100, 'INR', '0002', repeat('1', 64), 'd6000000-0000-4000-8000-0000000000a2') $q$,
  '23505'::char(5), null::text,
  'SC-I5 — one live entry for a UPI reference in a household'
);

select lives_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, upi_ref_last4, upi_ref_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f2', 'f6000000-0000-4000-8000-0000000000b1', '2020-02-01', 100, 'INR', '0002', repeat('1', 64), 'd6000000-0000-4000-8000-0000000000b1') $q$,
  'SC-I5 — the same reference in another household is its own payment'
);

insert into public.expense_txn (id, household_id, member_id, txn_date, amount_minor, currency, upi_ref_last4, upi_ref_hash, created_by) values
  ('e6100000-0000-4000-8000-000000000005', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1',
   '2020-02-02', 300, 'INR', '0005', repeat('5', 64), 'd6000000-0000-4000-8000-0000000000a1');
update public.expense_txn set voided_at = now(), voided_by = 'd6000000-0000-4000-8000-0000000000a1'
 where id = 'e6100000-0000-4000-8000-000000000005';

select lives_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, upi_ref_last4, upi_ref_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-02', 300, 'INR', '0005', repeat('5', 64), 'd6000000-0000-4000-8000-0000000000a1') $q$,
  'SC-I5 — a voided entry does not hold its reference, so a payment voided by mistake can be imported again'
);

-- An imported entry: R's, from batch 1, with the hash of its line.
insert into public.expense_txn
  (id, household_id, member_id, txn_date, amount_minor, currency, captured_via, source_batch_id, source_hash, account_id, created_by) values
  ('e6100000-0000-4000-8000-000000000007', 'e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1',
   '2020-02-03', 400, 'INR', 'import', 'b6000000-0000-4000-8000-000000000001', repeat('7', 64),
   'a6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-0000000000a1');

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, captured_via, source_batch_id, source_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-03', 400, 'INR', 'import',
              'b6000000-0000-4000-8000-000000000001', repeat('7', 64), 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23505'::char(5), null::text,
  'SC-I5 — a statement imported again makes no second entry for a line'
);

update public.expense_txn set voided_at = now(), voided_by = 'd6000000-0000-4000-8000-0000000000a1'
 where id = 'e6100000-0000-4000-8000-000000000007';

select throws_ok(
  $q$ insert into public.expense_txn (household_id, member_id, txn_date, amount_minor, currency, captured_via, source_batch_id, source_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1', '2020-02-03', 400, 'INR', 'import',
              'b6000000-0000-4000-8000-000000000001', repeat('7', 64), 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23505'::char(5), null::text,
  'SC-I5 — and voiding the entry does not let the same line make it again behind the person''s back'
);

select throws_ok(
  $q$ update public.expense_txn set source_hash = repeat('8', 64) where id = 'e6100000-0000-4000-8000-000000000007' $q$,
  '23514'::char(5), null::text,
  'where an imported entry came from is not changed: its line'
);

select throws_ok(
  $q$ update public.expense_txn set upi_ref_hash = repeat('9', 64) where id = 'e6100000-0000-4000-8000-000000000001' $q$,
  '23514'::char(5), null::text,
  'nor a reference once it is set'
);

select lives_ok(
  $q$ update public.expense_txn set upi_ref_last4 = '0003', upi_ref_hash = repeat('4', 64) where id = 'e6100000-0000-4000-8000-000000000002' $q$,
  'but an entry with no reference can be given one: a typed entry matched to a statement line takes its reference'
);

-- ============================================== a witness, as the database owner

select throws_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-0000000000a1',
              'b6000000-0000-4000-8000-000000000001', 'not-a-hash', 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23514'::char(5), null::text,
  'SC-I5 — a witness is the hash of a line, 64 hex digits, and never the line'
);

select throws_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-0000000000a2',
              'b6000000-0000-4000-8000-000000000001', repeat('a', 64), 'd6000000-0000-4000-8000-0000000000a1') $q$,
  '23503'::char(5), null::text,
  'a witness carries the member of the entry it saw, and a different member is refused'
);

insert into public.expense_witness (id, household_id, expense_id, member_id, batch_id, line_hash, created_by) values
  ('a6200000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000001',
   'f6000000-0000-4000-8000-0000000000a1', 'b6000000-0000-4000-8000-000000000001', repeat('a', 64), 'd6000000-0000-4000-8000-0000000000a1'),
  ('a6200000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000002',
   'f6000000-0000-4000-8000-0000000000a1', 'b6000000-0000-4000-8000-000000000001', repeat('b', 64), 'd6000000-0000-4000-8000-0000000000a1'),
  ('a6200000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000003',
   'f6000000-0000-4000-8000-0000000000a3', 'b6000000-0000-4000-8000-000000000001', repeat('c', 64), 'd6000000-0000-4000-8000-0000000000a3'),
  ('a6200000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000004',
   'f6000000-0000-4000-8000-0000000000a2', 'b6000000-0000-4000-8000-000000000001', repeat('d', 64), 'd6000000-0000-4000-8000-0000000000a2');

select throws_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000004', 'f6000000-0000-4000-8000-0000000000a2',
              'b6000000-0000-4000-8000-000000000001', repeat('a', 64), 'd6000000-0000-4000-8000-0000000000a2') $q$,
  '23505'::char(5), null::text,
  'SC-I5 — one witness for a line hash in a household: a line is recognised when its statement is imported again'
);

select lives_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash, created_by)
      values ('e6000000-0000-4000-8000-0000000000f2', 'e6100000-0000-4000-8000-0000000000f2', 'f6000000-0000-4000-8000-0000000000b1',
              'b6000000-0000-4000-8000-000000000002', repeat('a', 64), 'd6000000-0000-4000-8000-0000000000b1') $q$,
  'SC-I5 — the same line hash in another household is its own line'
);

-- ============================================== the owner, with a second factor

set local role authenticated;
set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.expense_witness),
  4,
  'the owner reads the witnesses of the household''s entries and of their own private one, and none of household S''s'
);

select lives_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-0000000000a1',
              'b6000000-0000-4000-8000-000000000001', repeat('e', 64)) $q$,
  'the owner adds a second witness to an entry: another statement saw the same payment'
);

select throws_ok(
  $q$ update public.expense_witness set line_hash = repeat('f', 64) where id = 'a6200000-0000-4000-8000-000000000001' $q$,
  '42501'::char(5), null::text,
  'nobody changes a witness'
);

select throws_ok(
  $q$ delete from public.expense_witness $q$,
  '42501'::char(5), null::text,
  'and nobody deletes one'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'expense_witness'),
  5,
  'the audit log has each witness the owner can read, the private entry''s included'
);

-- ============================================== the partner

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.expense_witness),
  4,
  'the partner reads the witnesses of the household''s entries, and not the witness of the owner''s private one'
);

select is(
  (select count(*)::int from public.audit_log where entity = 'expense_witness'),
  4,
  'and the audit rows of those, and not the audit row of the private entry''s witness'
);

select throws_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-0000000000a1',
              'b6000000-0000-4000-8000-000000000001', repeat('1', 63) || '0') $q$,
  '42501'::char(5), null::text,
  'the partner adds no witness to an entry they cannot read'
);

-- ============================================== a contributor, a viewer and a stranger

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.expense_witness),
  1,
  'a contributor reads the witness of their own entry and no other'
);

select lives_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000003', 'f6000000-0000-4000-8000-0000000000a3',
              'b6000000-0000-4000-8000-000000000001', repeat('1', 63) || '1') $q$,
  'and adds one to their own entry'
);

select throws_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000004', 'f6000000-0000-4000-8000-0000000000a3',
              'b6000000-0000-4000-8000-000000000001', repeat('1', 63) || '2') $q$,
  '42501'::char(5), null::text,
  'but not to another member''s entry'
);

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*)::int from public.expense_witness),
  0,
  'a viewer reads no witness'
);

select throws_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-0000000000a1',
              'b6000000-0000-4000-8000-000000000001', repeat('1', 63) || '3') $q$,
  '42501'::char(5), null::text,
  'and writes none'
);

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ insert into public.expense_witness (household_id, expense_id, member_id, batch_id, line_hash)
      values ('e6000000-0000-4000-8000-0000000000f1', 'e6100000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-0000000000a1',
              'b6000000-0000-4000-8000-000000000001', repeat('1', 63) || '4') $q$,
  '42501'::char(5), null::text,
  'another household witnesses nothing of this one'
);

-- ============================================== a password alone reads nothing

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select is(
  (select count(*)::int from public.expense_witness),
  0,
  'a session with no second factor reads no witness'
);

-- ============================================== the demo reset clears them

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ select public.reset_demo_household('e6000000-0000-4000-8000-0000000000f1') $q$,
  'the owner resets the demo household, which holds witnesses, imported entries and a batch of statements'
);

select is(
  (select count(*)::int from public.expense_witness where household_id = 'e6000000-0000-4000-8000-0000000000f1'),
  0,
  'the reset cleared its witnesses'
);

select * from finish();

rollback;
