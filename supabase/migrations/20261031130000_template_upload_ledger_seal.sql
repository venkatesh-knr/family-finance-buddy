-- Family Finance Buddy — the upload's ledger can be written only by the upload.
--
-- 20261031120000_template_upload.sql gave a signed-in owner or partner `insert` on `import_batch_row`, and `reverse_template_batch`
-- (SECURITY DEFINER) trusts that ledger: for each row it lists it deletes the row, or writes the image it holds, bypassing
-- row-level security. A person who could write a ledger row of their own could name any row of the household that they can read,
-- and have the reversal remove it, though no table grants a delete. The design review found it. The decision it broke is the one in
-- docs/decisions.md, Upload 1: the reversal removes only rows the upload itself created.
--
-- So the ledger and the references are written by `app.record_template_row`, which checks that the batch is a template batch the
-- caller made in this very transaction (`apply_template` is the only thing that makes and fills one in a single call), and nobody
-- is granted `insert` on either table. `apply_template` is replaced to call it. `reverse_template_batch` is replaced to remove
-- every reference the upload made, a row it only changed included.
--
-- A client can still insert an `import_batch` of kind template by hand, as the batch policy has always allowed. It has no ledger and
-- the helper refuses to give it one, so reversing it undoes nothing.

-- ───────────────────────────────────────────── the narrow writer

create function app.record_template_row(
  p_batch uuid, p_household uuid, p_entity text, p_row_id uuid, p_action text, p_before jsonb, p_after jsonb, p_ref text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if coalesce(app.household_role(p_household), '') not in ('owner', 'partner') then
    raise exception 'Only an owner or a partner can upload a workbook to this household.' using errcode = '42501';
  end if;

  -- A template batch of this household, made by the caller, in the transaction that is running now. An earlier batch cannot be
  -- written to, and neither can one somebody else made.
  if not exists (
    select 1
      from public.import_batch b
     where b.id = p_batch
       and b.household_id = p_household
       and b.kind = 'template'
       and b.reversed_at is null
       and b.created_by = app.current_account_id()
       and b.xmin::text = (txid_current() % 4294967296)::text
  ) then
    raise exception 'That is not an upload in progress.' using errcode = '42501';
  end if;

  if not exists (select 1 from app.template_entities() t where t.entity = p_entity) then
    raise exception 'That is not a sheet the upload takes.' using errcode = '22023';
  end if;

  insert into public.import_batch_row (batch_id, household_id, entity, row_id, action, before, after)
  values (p_batch, p_household, p_entity, p_row_id, p_action, p_before, p_after);

  if p_ref is not null then
    insert into public.import_ref (household_id, entity, ref, row_id, batch_id)
    values (p_household, p_entity, p_ref, p_row_id, p_batch)
    on conflict (household_id, entity, ref) do nothing;
    if not exists (
      select 1 from public.import_ref x
       where x.household_id = p_household and x.entity = p_entity and x.ref = p_ref and x.row_id = p_row_id
    ) then
      raise exception 'The reference "%" already belongs to another row.', p_ref using errcode = '23505';
    end if;
  end if;
end;
$fn$;

comment on function app.record_template_row(uuid, uuid, text, uuid, text, jsonb, jsonb, text) is
  'Writes one row of an upload''s ledger, and the reference the person gave it. Only for a template batch the caller made in this transaction, so the ledger a reversal trusts is written by the upload and by nothing else.';

revoke all on function app.record_template_row(uuid, uuid, text, uuid, text, jsonb, jsonb, text) from public;
grant execute on function app.record_template_row(uuid, uuid, text, uuid, text, jsonb, jsonb, text) to authenticated;

-- ───────────────────────────────────────────── nobody writes either table directly

drop policy import_ref_insert on public.import_ref;
drop policy import_batch_row_insert on public.import_batch_row;

revoke insert on public.import_ref       from authenticated;
revoke insert on public.import_batch_row from authenticated;
revoke usage, select on sequence public.import_batch_row_id_seq from authenticated;

-- ───────────────────────────────────────────── the two functions, as they are now

create or replace function public.apply_template(p_household uuid, p_label text, p_rows jsonb)
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

        -- What this upload did to the row, and the reference the person gave it, are written by a helper that only this call can use:
        -- a client cannot write the ledger a reversal trusts.
        v_ref := nullif(btrim(coalesce(r ->> 'ref', '')), '');
        perform app.record_template_row(v_batch, p_household, e.entity, v_id,
                                        case when v_before is null then 'insert' else 'update' end, v_before, v_after, v_ref);

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

create or replace function public.reverse_template_batch(p_batch uuid)
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
      v_removed := v_removed + 1;
    end if;
  end loop;

  -- Every reference this upload gave a row goes with it, a row it only changed included, so the reversal leaves nothing of it behind.
  delete from public.import_ref x where x.batch_id = p_batch and x.household_id = v_batch.household_id;

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
