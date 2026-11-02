-- Family Finance Buddy — the upload template: one transaction, a ledger it can be undone from, and a reference that survives a re-upload.
--
-- docs/blueprint.md section 17 ("the other route: fill in a sheet and upload it"), docs/build-plan.md step 5. The export is built
-- (src/domain/export); this is the database half of taking a corrected workbook back in. The decisions (docs/decisions.md, Upload):
--
--   1  One transaction. PostgREST has no multi-statement transaction, so a whole workbook is one call to `apply_template`, and it
--      is all of it or none of it. The preview in the browser is the courtesy; this is the guarantee.
--   2  It runs as the caller (SECURITY INVOKER). Row-level security and the grants decide every row, so an upload can never do
--      more than the same person could by hand: no row of another household, no private row of another member, no column nobody
--      may write. The entity and column lists inside it are fixed here, so a crafted file cannot name another table.
--   3  Owner and partner only, with the second factor. A contributor keeps entering their own records by the forms.
--   4  An upload never deletes. A row missing from the sheet is ignored; to retire a record, set its status.
--   5  A re-upload does not duplicate. A row is found again by its id; a new row can carry a `ref` of the person's own, remembered
--      in `import_ref`, so uploading the corrected file again updates it.
--   6  An upload can be reversed as a unit by the person who made it: rows it changed go back to what they were, rows it created
--      are removed, and nothing is reversed if anything has changed since or anything refers to a created row. This is the schema's
--      second hard delete (the first is `reset_demo_household`) and it is allowed to be one thing only: a row that this upload
--      itself created, untouched since, listed in this upload's own ledger. Every delete is in the audit log.
--
-- The ledger (`import_batch_row`) holds the image of every row an upload changed, so it is as private as the rows: only the person
-- who made the upload reads it. It has no audit trigger, on purpose: an audit row is readable by the household, and the ledger's
-- images include rows that are not the household's to read. What it records is already audited at the tables it names.
--
-- Must be applied after 20261027120000_retirement.sql, whose reset function this replaces.

-- ───────────────────────────────────────────── what an upload may write

-- The entities the template takes and, for each, the key that finds a row again and the columns that may be written. Not the
-- household (set from the call), not who or when (the app's), and not the read-only records (members, bond ratings, the log). A
-- test (src/domain/export/templateEntities.test.ts) holds this list to the export's entity list, column by column.
create function app.template_entities()
returns table (ord int, entity text, key_col text, cols text[])
language sql
immutable
set search_path = ''
as $fn$
  select * from (values
    (1,  'expense_category',     'id',         array['name','parent_id','nature','is_essential','sort_order','status','archived_at']),
    (2,  'budget',               'id',         array['category_id','fy','cadence','period','planned_minor','currency','member_id']),
    (3,  'instrument',           'id',         array['name','kind','symbol','isin','currency','exposure_currency','is_foreign_asset','tax_asset_class','price_source','price_external_id','scheme','retirement_type']),
    (4,  'holding',              'id',         array['member_id','instrument_id','quantity','cost_minor','visibility','opened_on','folio_last4','stated_quantity','stated_as_at','stated_source_batch_id','earmark','status','archived_at']),
    (5,  'valuation_snapshot',   'id',         array['holding_id','as_of_date','quantity','value_minor','currency','source','note']),
    (6,  'lot',                  'id',         array['holding_id','acquired_on','quantity','cost_minor','currency','kind','note','source_batch_id','source_hash']),
    (7,  'disposal',             'id',         array['holding_id','disposed_on','quantity','proceeds_minor','currency','kind','note','source_batch_id','source_hash']),
    (8,  'fixed_income_terms',   'holding_id', array['kind','principal_minor','currency','rate_pct','start_date','maturity_date','compounding','coupon_frequency','rating','auto_renew','renewal_rate_pct','institution','account_last4','repay_mode','note']),
    (9,  'deposit_renewal',      'id',         array['holding_id','start_date','maturity_date','principal_minor','currency','rate_pct','compounding','note']),
    (10, 'ppf_account',          'holding_id', array['institution','account_last4','opening_date','opening_balance_minor','currency','note']),
    (11, 'ppf_entry',            'id',         array['holding_id','entry_date','amount_minor','currency','note','voided_at']),
    (12, 'liability',            'id',         array['name','kind','instalment_minor','currency','cadence','member_id','outstanding_minor','outstanding_as_of','status','closed_at','note']),
    (13, 'property',             'id',         array['member_id','kind','label','currency','purchase_date','purchase_cost_minor','stamp_duty_minor','registration_minor','co_owner_share_pct','is_self_occupied','linked_liability_id','visibility','status','archived_at','note']),
    (14, 'property_improvement', 'id',         array['property_id','currency','work_date','description','amount_minor','is_capital','voided_at']),
    (15, 'property_valuation',   'id',         array['property_id','currency','as_of_date','value_minor','basis','note']),
    (16, 'insurance_policy',     'id',         array['name','kind','insurer','policy_last4','premium_minor','currency','cadence','cover_minor','started_on','renewal_on','premiums_end_on','linked_holding_id','member_id','status','lapsed_at','note']),
    (17, 'expense_txn',          'id',         array['member_id','category_id','txn_date','amount_minor','currency','payee','method','note','visibility','voided_at'])
  ) as t(ord, entity, key_col, cols)
$fn$;

comment on function app.template_entities() is
  'The entities an upload may write, the key that finds a row again, and the columns it may set, in the order they are written (parents before the rows that point at them). Fixed here so a file cannot name another table.';

revoke all on function app.template_entities() from public;
grant execute on function app.template_entities() to authenticated;

-- ───────────────────────────────────────────── an upload is a batch that can be reversed

alter table public.import_batch
  add column reversed_at timestamptz,
  add column reversed_by uuid references public.user_account (id) on delete restrict,
  add constraint import_batch_reversal_is_whole
    check ((reversed_at is null) = (reversed_by is null));

comment on column public.import_batch.reversed_at is
  'When an upload from a template was reversed as a unit, and by whom. Set by public.reverse_template_batch and by nothing else.';

-- ───────────────────────────────────────────── a reference of the person's own

create table public.import_ref (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,
  entity        text        not null check (length(entity) between 1 and 40),
  -- Typed by the person in the template's ref column: BB-17, "kitchen loan". Free text, so it can mean something to them.
  ref           text        not null check (length(btrim(ref)) between 1 and 60),
  row_id        uuid        not null,
  batch_id      uuid        not null references public.import_batch (id) on delete restrict,
  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),

  -- The one place a re-upload is made safe: the same reference is the same row, and one row has one reference.
  constraint import_ref_one_row_per_ref unique (household_id, entity, ref),
  constraint import_ref_one_ref_per_row unique (household_id, entity, row_id)
);

comment on table public.import_ref is
  'A row''s reference in the upload template, so uploading the corrected file again updates the row it created instead of creating a second copy.';

create index import_ref_batch_idx on public.import_ref (batch_id);

create trigger import_ref_audit
  after insert or update or delete on public.import_ref
  for each row execute function app.write_audit();

-- ───────────────────────────────────────────── the ledger an upload is reversed from

create table public.import_batch_row (
  id            bigint      generated always as identity primary key,
  batch_id      uuid        not null references public.import_batch (id) on delete restrict,
  household_id  uuid        not null references public.household (id) on delete restrict,
  entity        text        not null check (length(entity) between 1 and 40),
  row_id        uuid        not null,
  action        text        not null check (action in ('insert', 'update')),
  -- What the row was before (null for a row the upload created), and what it was once the upload had written it: the second is how
  -- a reversal knows nothing has touched the row since.
  before        jsonb,
  after         jsonb       not null,
  created_at    timestamptz not null default now(),

  constraint import_batch_row_before_matches_action check ((action = 'insert') = (before is null)),
  constraint import_batch_row_once_per_batch unique (batch_id, entity, row_id)
);

comment on table public.import_batch_row is
  'Every row an upload from a template created or changed, with its image before and after. Read only by the person who made the upload, because the images include rows that are not the household''s to read. Append-only. No audit trigger, on purpose: an audit row is readable by the household.';

create index import_batch_row_batch_idx on public.import_batch_row (batch_id, id);

-- ───────────────────────────────────────────── access

alter table public.import_ref        enable row level security;
alter table public.import_ref        force row level security;
alter table public.import_batch_row  enable row level security;
alter table public.import_batch_row  force row level security;

revoke all on public.import_ref       from public, anon, authenticated;
revoke all on public.import_batch_row from public, anon, authenticated;
grant select, insert on public.import_ref       to authenticated;
grant select, insert on public.import_batch_row to authenticated;
grant usage, select on sequence public.import_batch_row_id_seq to authenticated;

-- A reference is the household's, and its owner and partner see and make them. A contributor and a viewer neither.
create policy import_ref_select
  on public.import_ref
  for select
  to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'));

create policy import_ref_insert
  on public.import_ref
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and created_by = (select app.current_account_id())
    and exists (
      select 1 from public.import_batch b
       where b.id = import_ref.batch_id
         and b.household_id = import_ref.household_id
         and b.created_by = (select app.current_account_id())
    )
  );

-- The ledger is read and written by the person who made the batch, and by nobody else, whatever their role.
create policy import_batch_row_select
  on public.import_batch_row
  for select
  to authenticated
  using (
    exists (
      select 1 from public.import_batch b
       where b.id = import_batch_row.batch_id
         and b.household_id = import_batch_row.household_id
         and b.created_by = (select app.current_account_id())
    )
  );

create policy import_batch_row_insert
  on public.import_batch_row
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and exists (
      select 1 from public.import_batch b
       where b.id = import_batch_row.batch_id
         and b.household_id = import_batch_row.household_id
         and b.kind = 'template'
         and b.created_by = (select app.current_account_id())
    )
  );

comment on policy import_batch_row_select on public.import_batch_row is
  'Only the person who made the upload. The images hold rows that may be private to them.';

-- A password alone is not enough: the publishable key ships in the bundle.
create policy require_second_factor
  on public.import_ref
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.import_batch_row
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ───────────────────────────────────────────── applying a workbook

-- p_rows: { "<entity>": [ { "sheet_row": 5, "ref": "BB-1" | null, "values": { "id": "…", … } }, … ], … }
--
-- Only the rows that are new or changed are sent (the browser compares with what the household holds and shows the person the
-- difference first). Each is written by its key: a row that exists is updated and one that does not is created, and the ledger
-- records which. A row that fails stops the whole call, and the error names the sheet's entity and row so it can be put right.
create function public.apply_template(p_household uuid, p_label text, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_batch    uuid := gen_random_uuid();
  v_total    int  := 0;
  v_inserted int  := 0;
  v_updated  int  := 0;
  v_known    text[];
  e          record;
  r          jsonb;
  v_idx      int;
  v_values   jsonb;
  v_id       uuid;
  v_before   jsonb;
  v_after    jsonb;
  v_ref      text;
  v_cols     text;
  v_src      text;
  v_set      text;
begin
  if not app.has_second_factor() then
    raise exception 'An upload needs an authenticator code in this session, not only a password.' using errcode = '42501';
  end if;

  -- One message whether the household is somebody else's, does not exist, or the caller's role may not upload.
  if coalesce(app.household_role(p_household), '') not in ('owner', 'partner') then
    raise exception 'Only an owner or a partner can upload a workbook to this household.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'object' then
    raise exception 'The rows to write must be an object of sheets.' using errcode = '22023';
  end if;

  select array_agg(t.entity) into v_known from app.template_entities() t;
  if exists (select 1 from jsonb_object_keys(p_rows) k where k <> all (v_known)) then
    raise exception 'That workbook names a sheet the upload does not take.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_rows) j where jsonb_typeof(j.value) is distinct from 'array') then
    raise exception 'Each sheet must be a list of rows.' using errcode = '22023';
  end if;

  select coalesce(sum(jsonb_array_length(j.value)), 0) into v_total from jsonb_each(p_rows) j;
  if v_total = 0 then
    raise exception 'There is nothing to write.' using errcode = '22023';
  end if;
  if v_total > 20000 then
    raise exception 'An upload takes at most 20,000 rows at a time.' using errcode = '22023';
  end if;

  insert into public.import_batch (id, household_id, kind, label, row_count)
  values (v_batch, p_household, 'template', nullif(btrim(coalesce(p_label, '')), ''), v_total);

  for e in select * from app.template_entities() order by ord loop
    continue when not (p_rows ? e.entity);

    v_idx := 0;
    for r in select j.value from jsonb_array_elements(p_rows -> e.entity) j loop
      v_idx := v_idx + 1;
      begin
        v_values := r -> 'values';
        if jsonb_typeof(v_values) is distinct from 'object' then
          raise exception 'A row to write has no values.' using errcode = '22023';
        end if;
        v_id := nullif(v_values ->> e.key_col, '')::uuid;
        if v_id is null then
          raise exception 'A row to write has no %.', e.key_col using errcode = '22023';
        end if;

        -- The columns the row names. One it leaves out is left alone when the row exists and takes its default when it does not; one
        -- it names as null is set to null. The browser sends every column of a sheet, so a blank cell is a null.
        v_cols := (select string_agg(format('%I', c), ', ')                   from unnest(e.cols) c where v_values ? c);
        v_src  := (select string_agg(format('r.%I', c), ', ')                 from unnest(e.cols) c where v_values ? c);
        v_set  := (select string_agg(format('%1$I = excluded.%1$I', c), ', ') from unnest(e.cols) c where v_values ? c);
        if v_cols is null then
          raise exception 'A row to write names none of the columns that may be written.' using errcode = '22023';
        end if;

        -- An expense is voided by somebody, and the table holds both halves together or neither. A sheet says only when; who is the
        -- caller, and who stays who voided it when the row is written again.
        if e.entity = 'expense_txn' and v_values ? 'voided_at' then
          v_cols := v_cols || ', voided_by';
          v_src  := v_src  || ', case when r.voided_at is null then null else app.current_account_id() end';
          v_set  := v_set  || ', voided_by = case when excluded.voided_at is null then null else coalesce(t.voided_by, app.current_account_id()) end';
        end if;

        -- What the row is now, as the caller may see it.
        execute format('select to_jsonb(t.*) from public.%I t where t.%I = $1', e.entity, e.key_col)
           into v_before using v_id;

        -- The household is the call's, whatever the row says; the writer is the caller's. A row that exists in another household
        -- is not updated (the where) and the missing row that comes back says so.
        execute format($q$
          insert into public.%1$I as t (%2$I, household_id, %3$s)
          select r.%2$I, $2, %4$s
            from jsonb_populate_record(null::public.%1$I, $1) as r
          on conflict (%2$I) do update set %5$s
           where t.household_id = $2
          returning to_jsonb(t.*)
        $q$, e.entity, e.key_col, v_cols, v_src, v_set)
           into v_after using v_values, p_household;

        if v_after is null then
          raise exception 'That row belongs to another household.' using errcode = '42501';
        end if;

        insert into public.import_batch_row (batch_id, household_id, entity, row_id, action, before, after)
        values (v_batch, p_household, e.entity, v_id, case when v_before is null then 'insert' else 'update' end, v_before, v_after);

        v_ref := nullif(btrim(coalesce(r ->> 'ref', '')), '');
        if v_ref is not null then
          insert into public.import_ref (household_id, entity, ref, row_id, batch_id)
          values (p_household, e.entity, v_ref, v_id, v_batch)
          on conflict (household_id, entity, ref) do nothing;
          if not exists (
            select 1 from public.import_ref x
             where x.household_id = p_household and x.entity = e.entity and x.ref = v_ref and x.row_id = v_id
          ) then
            raise exception 'The reference "%" already belongs to another row.', v_ref using errcode = '23505';
          end if;
        end if;

        if v_before is null then v_inserted := v_inserted + 1; else v_updated := v_updated + 1; end if;
      exception when others then
        raise exception '%', sqlerrm
          using errcode = sqlstate,
                detail  = format('entity=%s;row=%s', e.entity, coalesce(r ->> 'sheet_row', v_idx::text));
      end;
    end loop;
  end loop;

  return jsonb_build_object('batch_id', v_batch, 'inserted', v_inserted, 'updated', v_updated);
end;
$fn$;

comment on function public.apply_template(uuid, text, jsonb) is
  'Writes the new and changed rows of an uploaded workbook in one transaction, as the caller, so row-level security decides every row. Owner and partner, second factor. All or none: a row that fails stops the call and names its entity and row.';

revoke all on function public.apply_template(uuid, text, jsonb) from public;
grant execute on function public.apply_template(uuid, text, jsonb) to authenticated;

-- ───────────────────────────────────────────── reversing one

-- SECURITY DEFINER, and the narrowest one: it touches only the rows listed in this upload's own ledger, in this upload's own
-- household, and only for the person who made the upload. A row changed since is not put back and a row created is not removed
-- if anything has changed it or refers to it; the whole reversal then stops, and nothing is undone.
create function public.reverse_template_batch(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_batch     record;
  l           record;
  e           record;
  v_current   jsonb;
  v_undone    int := 0;
  v_removed   int := 0;
  v_set       text;
begin
  if not app.has_second_factor() then
    raise exception 'Reversing an upload needs an authenticator code in this session, not only a password.' using errcode = '42501';
  end if;

  select b.* into v_batch from public.import_batch b where b.id = p_batch for update;

  -- One message whether it is not there, is somebody else's, or is not the caller's to reverse.
  if not found
     or v_batch.kind <> 'template'
     or coalesce(app.household_role(v_batch.household_id), '') not in ('owner', 'partner')
     or v_batch.created_by is distinct from app.current_account_id() then
    raise exception 'Only the person who made an upload from a template can reverse it.' using errcode = '42501';
  end if;

  if v_batch.reversed_at is not null then
    raise exception 'That upload has already been reversed.' using errcode = '22023';
  end if;

  -- Last written, first undone, so a row is removed before the rows it points at.
  for l in
    select x.* from public.import_batch_row x
     where x.batch_id = p_batch and x.household_id = v_batch.household_id
     order by x.id desc
  loop
    select t.* into e from app.template_entities() t where t.entity = l.entity;
    if not found then
      raise exception 'The ledger names a sheet the upload does not take.' using errcode = '22023';
    end if;

    execute format('select to_jsonb(t.*) from public.%I t where t.%I = $1 and t.household_id = $2', e.entity, e.key_col)
       into v_current using l.row_id, v_batch.household_id;

    -- Unchanged since the upload wrote it. The time the app last touched a row is not a change somebody made: reversing a later upload
    -- touches it, and must not stop this one being reversed.
    if (v_current - 'updated_at') is distinct from (l.after - 'updated_at') then
      raise exception 'Cannot reverse this upload: a row in % has been changed since (or removed). Nothing was undone.', l.entity
        using errcode = '40001', detail = format('entity=%s;row_id=%s', l.entity, l.row_id);
    end if;

    if l.action = 'update' then
      v_set := (select string_agg(format('%1$I = b.%1$I', c), ', ') from unnest(e.cols) c);
      if l.entity = 'expense_txn' then
        v_set := v_set || ', voided_by = b.voided_by';
      end if;
      execute format($q$
        update public.%1$I t set %2$s
          from jsonb_populate_record(null::public.%1$I, $3) as b
         where t.%3$I = $1 and t.household_id = $2
      $q$, e.entity, v_set, e.key_col)
        using l.row_id, v_batch.household_id, l.before;
      v_undone := v_undone + 1;
    else
      begin
        execute format('delete from public.%I t where t.%I = $1 and t.household_id = $2', e.entity, e.key_col)
          using l.row_id, v_batch.household_id;
      exception when foreign_key_violation then
        raise exception 'Cannot reverse this upload: something added since refers to a row in %. Nothing was undone.', l.entity
          using errcode = '23503', detail = format('entity=%s;row_id=%s', l.entity, l.row_id);
      end;
      delete from public.import_ref x
       where x.household_id = v_batch.household_id and x.entity = l.entity and x.row_id = l.row_id;
      v_removed := v_removed + 1;
    end if;
  end loop;

  update public.import_batch
     set reversed_at = now(), reversed_by = app.current_account_id()
   where id = p_batch;

  return jsonb_build_object('batch_id', p_batch, 'restored', v_undone, 'removed', v_removed);
end;
$fn$;

comment on function public.reverse_template_batch(uuid) is
  'Reverses an upload from a template as a unit, for the person who made it: changed rows go back to what they were and created rows are removed, only if nothing has changed them or refers to them since. All or none. Every delete is in the audit log. The only hard delete a client can reach besides the demo reset, and it can remove only what this upload created.';

revoke all on function public.reverse_template_batch(uuid) from public;
grant execute on function public.reverse_template_batch(uuid) to authenticated;

-- ───────────────────────────────────────────── the demo reset clears them too

-- Replaces the function of 20261027120000_retirement.sql with one that also clears an upload's ledger and references, which
-- are household tables and would otherwise make the reset's own guard roll it back.

create or replace function public.reset_demo_household(target_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kind    text;
  v_account uuid;
  v_table   text;
  v_left    boolean;
begin
  if not app.has_second_factor() then
    raise exception 'Resetting needs an authenticator code in this session, not only a password.'
      using errcode = '42501';
  end if;

  -- One message whether the household is somebody else's or does not exist,
  -- so a probe learns nothing about ids that are not the caller's.
  if app.household_role(target_household_id) is distinct from 'owner' then
    raise exception 'Only an owner can reset a demo household.' using errcode = '42501';
  end if;

  -- Locked, so two resets at once run one after the other rather than
  -- interleaving deletes and inserts into a state neither of them meant.
  select h.kind into v_kind
    from public.household h
   where h.id = target_household_id
     for update;

  if v_kind is distinct from 'demo' then
    raise exception 'This household is not marked demo, and only a demo household can be reset. Nothing was changed.'
      using errcode = '22023';
  end if;

  v_account := app.current_account_id();

  -- ── the wipe, children before parents ─────────────────────────────────
  --
  -- Every foreign key here is `on delete restrict`, deliberately, so the order
  -- is forced and a mistake in it fails loudly rather than cascading.

    -- Deposits and bonds hang off a holding by a restricting foreign key, so they go first. The earlier
  -- definition of this function predates them, which left a demo household that held a deposit or a
  -- bond unable to be reset at all: the delete of its holdings was refused and the whole reset rolled
  -- back. The rating log is append-only for everybody who can sign in; a reset is not one of them, and
  -- the audit trail of those rows stays where it is.
  -- A PPF's account and entries hang off its holding by a restricting foreign key, so they go with the deposits and
  -- bonds, before the holdings. The rate table has no household and is not touched.
  delete from public.ppf_entry           where household_id = target_household_id;
  delete from public.ppf_account         where household_id = target_household_id;
  delete from public.bond_rating_change  where household_id = target_household_id;
  delete from public.deposit_renewal     where household_id = target_household_id;
  delete from public.fixed_income_terms  where household_id = target_household_id;

  -- A property's valuations and improvements hang off it, and it can cite a loan, so all three go before
  -- the liabilities they point at. Nothing cites a property.
  delete from public.property_valuation   where household_id = target_household_id;
  delete from public.property_improvement where household_id = target_household_id;
  delete from public.property             where household_id = target_household_id;

  -- A policy can cite a holding (a ULIP's surrender value) by a restricting foreign key, so the policies
  -- go before the holdings they point at.
  delete from public.insurance_policy   where household_id = target_household_id;

  delete from public.valuation_snapshot where household_id = target_household_id;
  delete from public.lot                where household_id = target_household_id;
  delete from public.disposal           where household_id = target_household_id;
  delete from public.holding            where household_id = target_household_id;
  delete from public.instrument         where household_id = target_household_id;

  delete from public.expense_txn        where household_id = target_household_id;
  delete from public.budget             where household_id = target_household_id;
  delete from public.expense_category   where household_id = target_household_id;

  delete from public.liability          where household_id = target_household_id;
  delete from public.fx_rate            where household_id = target_household_id;

  -- After the rows that cite it. An import is the record of a file somebody
  -- imported into this household, and a sandbox emptied of everything that
  -- file wrote has no use for the record of having written it.
  -- An upload's ledger and its references point at the batch by a restricting foreign key, so they go before it. The ledger holds
  -- the images of rows this wipe has just removed, and has no use after it.
  delete from public.import_batch_row   where household_id = target_household_id;
  delete from public.import_ref         where household_id = target_household_id;
  delete from public.import_batch       where household_id = target_household_id;

  -- Members nobody signs in as — the seed's Meera and Priya, and anyone added
  -- by hand. A member with a membership, live or revoked, is a person with a
  -- login and stays: the membership's own foreign key would refuse otherwise.
  delete from public.member m
   where m.household_id = target_household_id
     and not exists (select 1 from public.membership ms where ms.member_id = m.id);

  update public.household
     set fire_multiplier                = default,
         fire_inflation_pct             = default,
         fire_years_ahead               = default,
         fire_return_pct                = default,
         fire_step_up_pct               = default,
         fire_monthly_contribution_minor = default,
         cover_dependency_years         = default,
         property_valuation_stale_months = default
   where id = target_household_id;

  -- ── the guard against the next table ──────────────────────────────────
  --
  -- The list above is complete today. The day somebody adds a household table
  -- and forgets this function, a reset would quietly leave that table's rows
  -- behind, and "a known state" would stop being true without anything saying
  -- so. So: every table in public carrying a household_id, other than the ones
  -- kept on purpose, must now be empty for this household — or the whole
  -- reset is rolled back and names the table it does not know about.
  --
  -- It has now done that once, for `import_batch`, which is this migration.
  for v_table in
    select c.relname
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c     on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and a.attname = 'household_id'
       and not a.attisdropped
       and c.relname not in ('member', 'membership', 'invite', 'audit_log')
  loop
    execute format('select exists (select 1 from public.%I where household_id = $1)', v_table)
       into v_left
      using target_household_id;

    if v_left then
      raise exception 'Reset does not know how to clear %. Add it to public.reset_demo_household. Nothing was changed.', v_table;
    end if;
  end loop;

  -- ── and the seed again ────────────────────────────────────────────────
  perform app.seed_demo_household(target_household_id, v_account);
end;
$fn$;

comment on function public.reset_demo_household(uuid) is
  'Owner only, second factor required, demo households only. Hard-deletes the household''s data — imports included, never its members with logins, memberships, invites or audit history — and reseeds it.';

revoke all on function public.reset_demo_household(uuid) from public;
grant execute on function public.reset_demo_household(uuid) to authenticated;
