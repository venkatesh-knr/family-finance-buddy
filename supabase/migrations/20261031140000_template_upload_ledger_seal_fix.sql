-- Family Finance Buddy — the upload's ledger writer asks when the batch was made, not by which transaction id.
--
-- 20261031130000_template_upload_ledger_seal.sql checked that the batch was made in the running transaction by comparing the row's
-- xmin with the transaction id. That is the transaction id of whoever inserted it, and a statement run inside a savepoint or a
-- block with an EXCEPTION clause inserts under a sub-transaction id instead, so the check refused a real upload that was called
-- inside one (the policy tests call it that way). What the check is for is that an earlier batch, or one somebody else made, cannot
-- be written to. A batch's `created_at` is `now()` at its insert, and `now()` is the time the transaction began, the same for every
-- statement in it, so `created_at = now()` says the same thing and holds under a sub-transaction.
--
-- Only the helper is replaced; apply_template calls it as before.

create or replace function app.record_template_row(
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

  -- A template batch of this household, made by the caller, in the transaction that is running now: its created_at is the time this
  -- transaction began, which `now()` is for the whole of it. An earlier batch cannot be written to, and neither can one somebody else
  -- made.
  if not exists (
    select 1
      from public.import_batch b
     where b.id = p_batch
       and b.household_id = p_household
       and b.kind = 'template'
       and b.reversed_at is null
       and b.created_by = app.current_account_id()
       and b.created_at = now()
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
