-- Family Finance Buddy — the upload template: who may upload, what an upload can and cannot reach, that it is all or none, that a
-- reference makes a re-upload safe, and that an upload can be reversed as a unit by the person who made it and by nobody else.
--
-- The upload runs as the caller (SECURITY INVOKER), so row-level security decides every row, and the first blocks are the proof:
-- a contributor, a viewer, a stranger and a session with no second factor are all refused, and a row of another household is
-- neither written nor changed. The ledger of an upload holds the images of rows that may be private, so it is read by the person
-- who made the upload and nobody else, and has no audit trigger (an audit row is the household's to read). The reversal is the one
-- SECURITY DEFINER function and is held to its narrowness: only the maker's own batch, only rows that are untouched since and that
-- nothing refers to, and all or none.
--
-- Run: supabase test db

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(64);

-- ============================================================== the fixture
--
--   owner        household R (demo)
--   partner      household R
--   contributor  household R
--   viewer       household R
--   stranger     owner of household S
--
--   C0  a category of R's, to be updated      S0  a category of S's, not R's to touch

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'owner@up.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000a2',
   'authenticated', 'authenticated', 'partner@up.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000a3',
   'authenticated', 'authenticated', 'contributor@up.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000a4',
   'authenticated', 'authenticated', 'viewer@up.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'c6000000-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'stranger@elsewhere.test', 'not-a-real-hash',
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
  ('d6000000-0000-4000-8000-0000000000a1', 'e6000000-0000-4000-8000-0000000000f1',
   'f6000000-0000-4000-8000-0000000000a1', 'owner'),
  ('d6000000-0000-4000-8000-0000000000a2', 'e6000000-0000-4000-8000-0000000000f1',
   'f6000000-0000-4000-8000-0000000000a2', 'partner'),
  ('d6000000-0000-4000-8000-0000000000a3', 'e6000000-0000-4000-8000-0000000000f1',
   'f6000000-0000-4000-8000-0000000000a3', 'contributor'),
  ('d6000000-0000-4000-8000-0000000000a4', 'e6000000-0000-4000-8000-0000000000f1',
   'f6000000-0000-4000-8000-0000000000a4', 'viewer'),
  ('d6000000-0000-4000-8000-0000000000b1', 'e6000000-0000-4000-8000-0000000000f2',
   'f6000000-0000-4000-8000-0000000000b1', 'owner');

insert into public.expense_category (id, household_id, name, nature) values
  ('aa600000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-0000000000f1', 'Old name',  'variable'),
  ('aa600000-0000-4000-8000-0000000000b1', 'e6000000-0000-4000-8000-0000000000f2', 'Not yours', 'variable');

-- Runs a statement and says how it ended, so an assertion can read the detail that names the row. A helper of this transaction only.
create function public.zz_how_it_ended(q text) returns text
language plpgsql
as $fn$
declare
  v_detail text;
begin
  execute q;
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || '|' || coalesce(v_detail, '');
end;
$fn$;
grant execute on function public.zz_how_it_ended(text) to authenticated;

-- ============================================================ the owner (aal2)

set local role authenticated;
set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  (public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'first', $j$
    {
      "expense_category": [
        {"sheet_row": 2, "ref": "CAT-1", "values":
          {"id": "aa600000-0000-4000-8000-000000000002", "name": "Car insurance", "nature": "fixed",
           "is_essential": true, "sort_order": 3, "status": "active"}}
      ],
      "expense_txn": [
        {"sheet_row": 2, "ref": null, "values":
          {"id": "ee600000-0000-4000-8000-000000000001", "member_id": "f6000000-0000-4000-8000-0000000000a1",
           "category_id": "aa600000-0000-4000-8000-000000000002", "txn_date": "2026-10-30",
           "amount_minor": 123456, "currency": "INR", "payee": "LIC", "method": "upi", "visibility": "household"}}
      ]
    }
  $j$::jsonb) ->> 'inserted')::int,
  2,
  'the owner uploads a new category and an expense under it in one call, and it says two rows were created'
);

select is(
  (select name from public.expense_category where id = 'aa600000-0000-4000-8000-000000000002'),
  'Car insurance',
  'the new category is there, written as the owner'
);

select is(
  (select count(*)::int from public.expense_txn where id = 'ee600000-0000-4000-8000-000000000001'
     and household_id = 'e6000000-0000-4000-8000-0000000000f1'),
  1,
  'and the expense under it, in the owner''s household'
);

select is(
  (select kind || ':' || row_count::text from public.import_batch where label = 'first'),
  'template:2',
  'the upload is a batch of kind template that counts its rows'
);

select is(
  (select count(*)::int from public.import_batch_row r join public.import_batch b on b.id = r.batch_id
    where b.label = 'first' and r.action = 'insert' and r.before is null),
  2,
  'the ledger records both rows as created, with nothing before them'
);

select is(
  (select row_id::text from public.import_ref where entity = 'expense_category' and ref = 'CAT-1'),
  'aa600000-0000-4000-8000-000000000002',
  'the category''s reference is remembered, against the row it made'
);

-- a re-upload of the corrected file: the reference leads the browser to the same id, so the row is updated, not copied
select is(
  (public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'renewal', $j$
    {"expense_category": [
      {"sheet_row": 2, "ref": "CAT-1", "values":
        {"id": "aa600000-0000-4000-8000-000000000002", "name": "Car insurance (renewal)", "nature": "fixed",
         "is_essential": true, "sort_order": 3, "status": "active"}}
    ]}
  $j$::jsonb) ->> 'updated')::int,
  1,
  'uploading the corrected row again updates it'
);

select is(
  (select count(*)::int from public.expense_category where name like 'Car insurance%')
  || ':' || (select count(*)::int from public.import_ref where entity = 'expense_category' and ref = 'CAT-1')::text,
  '1:1',
  'and there is still one category and one reference: nothing was duplicated'
);

select is(
  (select r.before ->> 'name' from public.import_batch_row r join public.import_batch b on b.id = r.batch_id
    where b.label = 'renewal'),
  'Car insurance',
  'the ledger kept what the row was before the second upload'
);

select is(
  left(public.zz_how_it_ended($q$
    select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'copy', $j$
      {"expense_category": [
        {"sheet_row": 5, "ref": "CAT-1", "values":
          {"id": "aa600000-0000-4000-8000-000000000003", "name": "A second copy", "nature": "fixed"}}
      ]}
    $j$::jsonb)
  $q$), 5),
  '23505',
  'a reference that already belongs to another row is refused'
);

select is_empty(
  $q$ select id from public.expense_category where id = 'aa600000-0000-4000-8000-000000000003' $q$,
  'and the row that carried it was not written'
);

select is(
  (public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'rename c0', $j$
    {"expense_category": [
      {"sheet_row": 3, "values":
        {"id": "aa600000-0000-4000-8000-000000000001", "name": "Groceries", "nature": "variable"}}
    ]}
  $j$::jsonb) ->> 'updated')::int,
  1,
  'an existing category of the household is updated by its id'
);

select is(
  (select (r.before ->> 'name') || '>' || (r.after ->> 'name') from public.import_batch_row r
     join public.import_batch b on b.id = r.batch_id where b.label = 'rename c0'),
  'Old name>Groceries',
  'with its image before and after in the ledger'
);

-- ======================================================== all or none, and what it names

select is(
  public.zz_how_it_ended($q$
    select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'half', $j$
      {"expense_category": [
        {"sheet_row": 2, "values": {"id": "aa600000-0000-4000-8000-000000000004", "name": "Fine", "nature": "fixed"}},
        {"sheet_row": 3, "values": {"id": "aa600000-0000-4000-8000-000000000005", "name": "Bad", "nature": "bogus"}}
      ]}
    $j$::jsonb)
  $q$),
  '23514|entity=expense_category;row=3',
  'a row the database refuses stops the whole upload, and the error names its sheet and its row'
);

select is(
  (select count(*)::int from public.expense_category where id = 'aa600000-0000-4000-8000-000000000004')
  || ':' || (select count(*)::int from public.import_batch where label = 'half')::text,
  '0:0',
  'and the row before it was not kept, and no batch was left behind'
);

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'x', '{"audit_log": [{"values": {}}]}'::jsonb) $q$,
  '22023'::char(5),
  null::text,
  'a sheet the upload does not take is refused, the audit log and the members among them'
);

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'x', '{"member": [{"values": {}}]}'::jsonb) $q$,
  '22023'::char(5),
  null::text,
  'members are not uploaded: people join by invitation'
);

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'x', '{"expense_category": []}'::jsonb) $q$,
  '22023'::char(5),
  null::text,
  'an upload of nothing is refused'
);

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'x', '{"expense_category": [{"values": {"name": "No id", "nature": "fixed"}}]}'::jsonb) $q$,
  '22023'::char(5),
  null::text,
  'and a row with no id is refused: the browser gives every new row one before it is sent'
);

-- ======================================================== what an upload cannot reach

select is(
  (public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'sheet five', $j$
    {"expense_category": [
      {"sheet_row": 2, "values":
        {"id": "aa600000-0000-4000-8000-000000000006", "household_id": "e6000000-0000-4000-8000-0000000000f2",
         "name": "Says it is S", "nature": "fixed"}}
    ]}
  $j$::jsonb) ->> 'inserted')::int,
  1,
  'a row that names another household is written, and as the caller''s household'
);

select is(
  (select household_id::text from public.expense_category where id = 'aa600000-0000-4000-8000-000000000006'),
  'e6000000-0000-4000-8000-0000000000f1',
  'because the household is the call''s and never the row''s'
);

select is(
  left(public.zz_how_it_ended($q$
    select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'theirs', $j$
      {"expense_category": [
        {"sheet_row": 2, "values":
          {"id": "aa600000-0000-4000-8000-0000000000b1", "name": "Taken over", "nature": "fixed"}}
      ]}
    $j$::jsonb)
  $q$), 5),
  '42501',
  'a row that exists in another household cannot be written to by id'
);

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f2', 'x', '{"expense_category": [{"values": {"id": "aa600000-0000-4000-8000-0000000000c1", "name": "x", "nature": "fixed"}}]}'::jsonb) $q$,
  '42501'::char(5),
  null::text,
  'nor can the owner of one household upload into another'
);

-- a session with only a password
set local request.jwt.claims to '{"sub":"c6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}';

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'x', '{"expense_category": [{"values": {"id": "aa600000-0000-4000-8000-0000000000c2", "name": "x", "nature": "fixed"}}]}'::jsonb) $q$,
  '42501'::char(5),
  null::text,
  'an upload needs the second factor, and a password alone is refused'
);

select throws_ok(
  $q$ select public.reverse_template_batch((select id from public.import_batch where label = 'rename c0')) $q$,
  '42501'::char(5),
  null::text,
  'as is a reversal'
);

set local request.jwt.claims to '{"sub":"c6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

-- ======================================================================== the partner

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}';

select is(
  (public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'partner', $j$
    {"expense_category": [
      {"sheet_row": 2, "values": {"id": "aa600000-0000-4000-8000-000000000007", "name": "Partner's", "nature": "variable"}}
    ]}
  $j$::jsonb) ->> 'inserted')::int,
  1,
  'a partner can upload'
);

select is(
  (select count(*)::int from public.import_batch_row),
  1,
  'and reads the ledger of their own upload only, not the owner''s'
);

select is(
  (select count(*)::int from public.import_ref),
  1,
  'but reads the household''s references, the owner''s included'
);

select throws_ok(
  $q$ insert into public.import_batch_row (batch_id, household_id, entity, row_id, action, before, after)
      select b.id, b.household_id, 'expense_category', 'aa600000-0000-4000-8000-0000000000d1', 'insert', null, '{}'::jsonb
        from public.import_batch b where b.label = 'first' $q$,
  '42501'::char(5),
  null::text,
  'a ledger row cannot be written into somebody else''s batch'
);

select throws_ok(
  $q$ select public.reverse_template_batch((select id from public.import_batch where label = 'first')) $q$,
  '42501'::char(5),
  null::text,
  'and an upload can be reversed only by the person who made it, whatever their role'
);

select throws_ok(
  $q$ delete from public.import_ref $q$,
  '42501'::char(5),
  null::text,
  'nobody deletes a reference'
);

select throws_ok(
  $q$ update public.import_batch_row set action = 'insert' $q$,
  '42501'::char(5),
  null::text,
  'and nobody rewrites the ledger'
);

-- ======================================================= the ledger is the upload's alone

select throws_ok(
  $q$ insert into public.import_batch_row (batch_id, household_id, entity, row_id, action, before, after)
      select b.id, b.household_id, 'expense_txn', e.id, 'insert', null, to_jsonb(e.*)
        from public.import_batch b, public.expense_txn e
       where b.label = 'partner' and e.id = 'ee600000-0000-4000-8000-000000000001' $q$,
  '42501'::char(5),
  null::text,
  'a ledger row cannot be written by hand at all, not even into one''s own batch: the reversal trusts the ledger'
);

select throws_ok(
  $q$ insert into public.import_ref (household_id, entity, ref, row_id, batch_id)
      select b.household_id, 'expense_category', 'FORGED', 'aa600000-0000-4000-8000-0000000000d4', b.id
        from public.import_batch b where b.label = 'partner' $q$,
  '42501'::char(5),
  null::text,
  'nor a reference'
);

select throws_ok(
  $q$ select app.record_template_row((select id from public.import_batch where label = 'first'),
        'e6000000-0000-4000-8000-0000000000f1', 'expense_category', 'aa600000-0000-4000-8000-000000000002', 'insert', null, '{}'::jsonb, null) $q$,
  '42501'::char(5),
  null::text,
  'and the helper that does write it refuses a batch somebody else made'
);

select lives_ok(
  $q$ insert into public.import_batch (household_id, kind, label, row_count)
      values ('e6000000-0000-4000-8000-0000000000f1', 'template', 'forged', 0) $q$,
  'a partner can still make a batch of kind template by hand, as the batch policy has always allowed'
);

select is(
  (public.reverse_template_batch((select id from public.import_batch where label = 'forged')) ->> 'removed')::int
  || ':' || (select count(*)::int from public.expense_txn where id = 'ee600000-0000-4000-8000-000000000001')::text,
  '0:1',
  'but it has no ledger, so reversing it removes nothing, and the owner''s expense is still there'
);

-- ================================================================ the contributor

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'x', '{"expense_category": [{"values": {"id": "aa600000-0000-4000-8000-0000000000c3", "name": "x", "nature": "fixed"}}]}'::jsonb) $q$,
  '42501'::char(5),
  null::text,
  'a contributor does not upload: they keep entering their own records by the forms'
);

select is(
  (select count(*)::int from public.import_ref) + (select count(*)::int from public.import_batch_row),
  0,
  'and reads neither the references nor any ledger'
);

select throws_ok(
  $q$ insert into public.import_ref (household_id, entity, ref, row_id, batch_id)
      values ('e6000000-0000-4000-8000-0000000000f1', 'expense_category', 'MINE',
              'aa600000-0000-4000-8000-0000000000d2', 'bb600000-0000-4000-8000-0000000000d3') $q$,
  '42501'::char(5),
  null::text,
  'nor writes a reference'
);

-- ===================================================================== the viewer

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a4","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'x', '{"expense_category": [{"values": {"id": "aa600000-0000-4000-8000-0000000000c4", "name": "x", "nature": "fixed"}}]}'::jsonb) $q$,
  '42501'::char(5),
  null::text,
  'a viewer does not upload'
);

select throws_ok(
  $q$ select public.reverse_template_batch((select id from public.import_batch where label = 'first')) $q$,
  '42501'::char(5),
  null::text,
  'nor reverse'
);

-- =================================================================== the stranger

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}';

select throws_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'x', '{"expense_category": [{"values": {"id": "aa600000-0000-4000-8000-0000000000c5", "name": "x", "nature": "fixed"}}]}'::jsonb) $q$,
  '42501'::char(5),
  null::text,
  'somebody who is in no part of the household cannot upload to it'
);

select is(
  (select count(*)::int from public.import_ref) + (select count(*)::int from public.import_batch_row)
  + (select count(*)::int from public.import_batch where household_id = 'e6000000-0000-4000-8000-0000000000f1'),
  0,
  'and reads nothing of its batches, references or ledger'
);

select is(
  (select name from public.expense_category where id = 'aa600000-0000-4000-8000-0000000000b1'),
  'Not yours',
  'and the stranger''s own category was untouched by the owner''s attempt to take it over'
);

-- ======================================================== reversing, as the owner

set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select is(
  left(public.zz_how_it_ended($q$ select public.reverse_template_batch((select id from public.import_batch where label = 'first')) $q$), 5),
  '40001',
  'the first upload cannot be reversed while a later one has changed a row it made'
);

select is(
  (select count(*)::int from public.expense_category where id = 'aa600000-0000-4000-8000-000000000002')
  || ':' || (select count(*)::int from public.expense_txn where id = 'ee600000-0000-4000-8000-000000000001')::text,
  '1:1',
  'and nothing at all was undone by the refusal'
);

select is(
  (public.reverse_template_batch((select id from public.import_batch where label = 'renewal')) ->> 'restored')::int,
  1,
  'the later upload is reversed first, and its row goes back to what it was'
);

select is(
  (select name from public.expense_category where id = 'aa600000-0000-4000-8000-000000000002'),
  'Car insurance',
  'the name is the one before the renewal'
);

select is(
  (public.reverse_template_batch((select id from public.import_batch where label = 'rename c0')) ->> 'restored')::int,
  1,
  'an upload that changed an existing row restores it'
);

select is(
  (select name from public.expense_category where id = 'aa600000-0000-4000-8000-000000000001'),
  'Old name',
  'to the name it had'
);

select is(
  (public.reverse_template_batch((select id from public.import_batch where label = 'first')) ->> 'removed')::int,
  2,
  'then the first upload is reversed, and the two rows it created are removed'
);

select is(
  (select count(*)::int from public.expense_category where id = 'aa600000-0000-4000-8000-000000000002')
  || ':' || (select count(*)::int from public.expense_txn where id = 'ee600000-0000-4000-8000-000000000001')::text
  || ':' || (select count(*)::int from public.import_ref where ref = 'CAT-1')::text,
  '0:0:0',
  'the rows and their reference are gone, so the reference can be used again'
);

select is(
  (select (reversed_at is not null)::text || ':' || (reversed_by = 'd6000000-0000-4000-8000-0000000000a1')::text
     from public.import_batch where label = 'first'),
  'true:true',
  'the batch says when it was reversed and by whom'
);

select is(
  left(public.zz_how_it_ended($q$ select public.reverse_template_batch((select id from public.import_batch where label = 'first')) $q$), 5),
  '22023',
  'and an upload is reversed once'
);

select is(
  left(public.zz_how_it_ended($q$ select public.reverse_template_batch((select id from public.import_batch where label = 'partner')) $q$), 5),
  '42501',
  'the owner cannot reverse the partner''s upload: it is the maker''s alone'
);

-- something added since refers to a row an upload made: the reversal stops, and nothing is undone
select lives_ok(
  $q$ select public.apply_template('e6000000-0000-4000-8000-0000000000f1', 'fk', '{"expense_category": [{"values": {"id": "aa600000-0000-4000-8000-000000000008", "name": "Referred to", "nature": "fixed"}}]}'::jsonb) $q$,
  'an upload makes a category'
);

select lives_ok(
  $q$ insert into public.expense_txn (household_id, member_id, category_id, txn_date, amount_minor, currency)
      values ('e6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000a1',
              'aa600000-0000-4000-8000-000000000008', date '2026-10-31', 50000, 'INR') $q$,
  'and an expense is then entered under it by hand'
);

select is(
  left(public.zz_how_it_ended($q$ select public.reverse_template_batch((select id from public.import_batch where label = 'fk')) $q$), 5),
  '23503',
  'the upload cannot be reversed while something refers to what it made'
);

select is(
  (select count(*)::int from public.expense_category where id = 'aa600000-0000-4000-8000-000000000008'),
  1,
  'and the category it made is still there'
);

-- ================================================================ the log and the reset

reset role;

select is(
  (select count(*)::int from public.audit_log where entity = 'import_batch_row'),
  0,
  'the ledger is not in the audit log: an audit row is the household''s to read, and the ledger''s images are not'
);

select is(
  (select count(*)::int from public.audit_log
    where entity = 'expense_category' and entity_id = 'aa600000-0000-4000-8000-000000000002' and action in ('insert', 'update', 'delete')),
  4,
  'but what the upload and its reversal did to a category is: created, renewed, restored, and removed'
);

set local role authenticated;
set local request.jwt.claim.sub to 'c6000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims   to '{"sub":"c6000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}';

select lives_ok(
  $q$ select public.reset_demo_household('e6000000-0000-4000-8000-0000000000f1') $q$,
  'resetting a demo household that has uploads clears their ledger and references too, instead of rolling back'
);

reset role;

select is(
  (select count(*)::int from public.import_batch_row where household_id = 'e6000000-0000-4000-8000-0000000000f1')
  + (select count(*)::int from public.import_ref where household_id = 'e6000000-0000-4000-8000-0000000000f1')
  + (select count(*)::int from public.import_batch where household_id = 'e6000000-0000-4000-8000-0000000000f1'),
  0,
  'and nothing of it is left'
);

select * from finish();

rollback;
