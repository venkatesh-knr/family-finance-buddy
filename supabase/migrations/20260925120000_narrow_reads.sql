-- Family Finance Buddy — what a contributor and a viewer can read.
--
-- docs/blueprint.md §11:
--
--   Contributor   Own records + household expense totals      Own expenses and assets only
--   Viewer        Household summary only, no account identifiers   Nothing
--
-- The writes have been right from the start: a viewer writes nothing, a
-- contributor writes only under their own name. The reads were not. Every role
-- read every household row, and the expense policy said so in its own comment:
-- "Narrowing contributor and viewer reads is a later slice". Harmless while a
-- household has one member; not harmless the day a viewer login is handed to an
-- advisor, who would then see every payee, loan and policy.
--
-- What this does, and only this:
--
--   owner, partner   read exactly what they read before. Nothing changes.
--   contributor      reads the rows that are theirs — their expenses, their
--                    holdings and everything hanging off them, their loans and
--                    policies, their audit trail, the imports they ran — plus the
--                    plan (categories and budgets), which they need to file an
--                    expense and to see how the household is doing against it.
--   viewer           reads no data table at all. What a viewer sees is a summary,
--                    returned by the functions at the bottom of this file, which
--                    hand back sums and never a row.
--
-- The household, its members and the memberships stay readable by every role:
-- a name on a screen and who else is in the household are not what this is
-- about, and no role can do without them.
--
-- Rows that hang off a holding — its valuations, its lots, its disposals and
-- their audit rows — already read through `exists (select 1 from holding ...)`,
-- and that subquery runs under the caller's own policy. Narrowing `holding`
-- narrows all of them, and so they get no policy change here, only tests.
--
-- Policies do access and nothing else: no calculation, no tax rule.
--
-- ── two things this deliberately leaves alone ─────────────────────────────────
--
-- `instrument` stays readable by every role but a viewer. It is the household's
-- catalogue of what exists (a name, a kind, a currency), and a contributor adding
-- their own holding inserts the instrument and reads its id back in the same
-- statement; narrowing it to "instruments I hold" would refuse their own insert.
-- It carries no quantity and no amount. A member's private holding still shows as
-- an instrument, as it did before; the holding, its value and its history do not.
--
-- `household_expense_totals` includes only the shared entries. A member's
-- private spending reaches everyone else as one figure per member, from
-- `personal_expense_totals`, which already exists and already does that.

-- ═══════════════════════════════════════════════════════ a helper, not a rule
--
-- "May this caller read every row of the household, or only their own?" — asked
-- by six policies below, so answered once. Owner and partner read everything.

create or replace function app.reads_whole_household(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(app.household_role(target_household_id) in ('owner', 'partner'), false)
$fn$;

comment on function app.reads_whole_household(uuid) is
  'True for an owner or a partner of the household; false for a contributor, a viewer, or a stranger.';

revoke all on function app.reads_whole_household(uuid) from public;
grant execute on function app.reads_whole_household(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════ expense_txn

drop policy if exists expense_txn_select_same_household on public.expense_txn;

create policy expense_txn_select_by_role
  on public.expense_txn
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

comment on policy expense_txn_select_by_role on public.expense_txn is
  'Owner and partner: the shared entries and their own private ones. Contributor: their own entries, shared or private. Viewer: none — a summary comes from household_expense_totals.';

-- ═════════════════════════════════════════════════════════════════ holding

drop policy if exists holding_select_same_household on public.holding;

create policy holding_select_by_role
  on public.holding
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

comment on policy holding_select_by_role on public.holding is
  'Owner and partner: the shared holdings and their own private ones. Contributor: their own. Viewer: none. Valuations, lots and disposals follow, because they read through this table.';

-- ═════════════════════════════════════════ liability, insurance_policy
--
-- A loan or a policy with no member is the household's — a mortgage, a family
-- floater — and is read by owner and partner only. A contributor reads the ones
-- filed under them.

drop policy if exists liability_select_same_household on public.liability;

create policy liability_select_by_role
  on public.liability
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

comment on policy liability_select_by_role on public.liability is
  'Owner and partner: all. Contributor: only the loans filed under them; a household loan (no member) is not theirs to read. Viewer: none.';

drop policy if exists insurance_policy_select_same_household on public.insurance_policy;

create policy insurance_policy_select_by_role
  on public.insurance_policy
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

comment on policy insurance_policy_select_by_role on public.insurance_policy is
  'Owner and partner: all. Contributor: only the policies filed under them. Viewer: none.';

-- ═════════════════════════════════════════════════════════════ audit_log
--
-- The log carries `before` and `after` in full, so it has to hold the same line
-- as the table it shadows. It already withheld a personal row from everybody but
-- its member; now it also withholds other people's rows from a contributor.

drop policy if exists audit_log_select_same_household on public.audit_log;

create policy audit_log_select_by_role
  on public.audit_log
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (
      entity <> 'valuation_snapshot'
      or exists (
        select 1 from public.valuation_snapshot v where v.id = audit_log.entity_id
      )
    )
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

comment on policy audit_log_select_by_role on public.audit_log is
  'Owner and partner: the household''s log, minus other members'' private rows. Contributor: entries about their own rows only. Viewer: none.';

-- ═════════════════════════════════════════════════════════ import_batch

drop policy if exists import_batch_select_same_household on public.import_batch;

create policy import_batch_select_by_role
  on public.import_batch
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and created_by = (select app.current_account_id())
      )
    )
  );

comment on policy import_batch_select_by_role on public.import_batch is
  'Owner and partner: all. Contributor: the imports they ran. Viewer: none.';

-- ═════════════════════════════════════════════════════════════════ invite
--
-- An invite carries an email address. Who has been asked to join is the
-- household's administrators'.

drop policy if exists invite_select_same_household on public.invite;

create policy invite_select_administrators
  on public.invite
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and app.reads_whole_household(household_id)
  );

comment on policy invite_select_administrators on public.invite is
  'Owner and partner see the pending invitations. Nobody else does: they carry email addresses.';

-- ══════════════════════ what is not sensitive, but is not a viewer's either
--
-- The plan, the catalogue and the rates: a contributor reads them, because they
-- cannot file an expense without a category or add a holding without an
-- instrument; a viewer reads a summary instead.

drop policy if exists expense_category_select_same_household on public.expense_category;

create policy expense_category_select_not_viewer
  on public.expense_category
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and app.household_role(household_id) in ('owner', 'partner', 'contributor')
  );

drop policy if exists budget_select_same_household on public.budget;

create policy budget_select_not_viewer
  on public.budget
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and app.household_role(household_id) in ('owner', 'partner', 'contributor')
  );

drop policy if exists instrument_select_same_household on public.instrument;

create policy instrument_select_not_viewer
  on public.instrument
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and app.household_role(household_id) in ('owner', 'partner', 'contributor')
  );

drop policy if exists fx_rate_select_same_household on public.fx_rate;

create policy fx_rate_select_not_viewer
  on public.fx_rate
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and app.household_role(household_id) in ('owner', 'partner', 'contributor')
  );

comment on policy expense_category_select_not_viewer on public.expense_category is
  'Everyone who can file an expense reads the categories. A viewer reads a summary.';
comment on policy budget_select_not_viewer on public.budget is
  'A contributor reads the household plan, to see how the household is doing against it; the actuals come from household_expense_totals. A viewer reads a summary.';
comment on policy instrument_select_not_viewer on public.instrument is
  'The catalogue of what exists, with no quantity and no amount. Not narrowed per member: a contributor''s own insert reads its id back. A viewer reads a summary.';
comment on policy fx_rate_select_not_viewer on public.fx_rate is
  'Rates are the household''s and not sensitive; a viewer has no use for them because a summary is not converted.';

-- ══════════════════════════════════════════════════════ what replaces a row
--
-- Definer, and it has to be: the point is to read past the policy. What each does
-- with that power is bounded by what it returns — a sum, a category or a kind, a
-- currency, a count. Never a payee, a date, a holding or a member.

-- Spending by category in a period: the household's, from the shared entries.
create or replace function public.household_expense_totals(
  target_household_id uuid,
  from_date date,
  to_date date
)
returns table (category_id uuid, total_minor bigint, currency text)
language plpgsql
security definer
stable
set search_path = ''
as $fn$
begin
  if app.household_role(target_household_id) is null then
    raise exception 'Not a member of that household.' using errcode = '42501';
  end if;

  return query
    select e.category_id, sum(e.amount_minor)::bigint, e.currency
      from public.expense_txn e
     where e.household_id = target_household_id
       and e.visibility = 'household'
       and e.voided_at is null
       and e.txn_date between from_date and to_date
     group by e.category_id, e.currency;
end;
$fn$;

comment on function public.household_expense_totals(uuid, date, date) is
  'The household''s shared spending by category and currency, for whoever cannot read the rows. Excludes private entries, which arrive as one figure per member from personal_expense_totals.';

revoke all on function public.household_expense_totals(uuid, date, date) from public;
grant execute on function public.household_expense_totals(uuid, date, date) to authenticated;

-- What the household holds, by kind and currency: the latest reading of each
-- shared holding. Never a holding, an instrument's name or a date.
create or replace function public.household_asset_totals(target_household_id uuid)
returns table (kind text, currency text, total_minor bigint, valued integer, unvalued integer)
language plpgsql
security definer
stable
set search_path = ''
as $fn$
begin
  if app.household_role(target_household_id) is null then
    raise exception 'Not a member of that household.' using errcode = '42501';
  end if;

  return query
    with shared as (
      select h.id, i.kind, i.currency
        from public.holding h
        join public.instrument i on i.id = h.instrument_id
       where h.household_id = target_household_id
         and h.visibility = 'household'
         and h.status = 'active'
    ),
    latest as (
      select distinct on (v.holding_id)
             v.holding_id, v.value_minor
        from public.valuation_snapshot v
        join shared on shared.id = v.holding_id
       order by v.holding_id, v.as_of_date desc, v.created_at desc
    )
    select shared.kind,
           shared.currency,
           coalesce(sum(latest.value_minor), 0)::bigint,
           count(latest.value_minor)::integer,
           count(*) filter (where latest.value_minor is null)::integer
      from shared
      left join latest on latest.holding_id = shared.id
     group by shared.kind, shared.currency;
end;
$fn$;

comment on function public.household_asset_totals(uuid) is
  'The shared holdings by kind and currency, at their latest reading, with a count of those never valued. Excludes private holdings, which are not itemised by kind for anybody: a kind with one private holding would give it away.';

revoke all on function public.household_asset_totals(uuid) from public;
grant execute on function public.household_asset_totals(uuid) to authenticated;

-- ═════════════════════════════ other members' private assets: not for everyone
--
-- One sum per member of their private holdings. Right for an owner or a partner,
-- who read the whole household. Not for a contributor, whose remit is their own
-- records: another member's asset total is not a household expense total.

create or replace function public.personal_holding_totals(target_household_id uuid)
returns table (member_id uuid, total_minor bigint, currency text, unvalued integer)
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_member uuid;
begin
  if not app.reads_whole_household(target_household_id) then
    raise exception 'Only an owner or a partner may read those totals.' using errcode = '42501';
  end if;

  v_member := app.current_member_id(target_household_id);

  return query
    with mine as (
      select h.id, h.member_id, i.currency
        from public.holding h
        join public.instrument i on i.id = h.instrument_id
       where h.household_id = target_household_id
         and h.visibility = 'personal'
         and h.member_id is distinct from v_member
         and h.status = 'active'
    ),
    latest as (
      select distinct on (v.holding_id)
             v.holding_id, v.value_minor
        from public.valuation_snapshot v
        join mine on mine.id = v.holding_id
       order by v.holding_id, v.as_of_date desc, v.created_at desc
    )
    select mine.member_id,
           coalesce(sum(latest.value_minor), 0)::bigint,
           mine.currency,
           count(*) filter (where latest.value_minor is null)::integer
      from mine
      left join latest on latest.holding_id = mine.id
     group by mine.member_id, mine.currency;
end;
$fn$;

comment on function public.personal_holding_totals(uuid) is
  'One sum per member, never per holding or asset class — a breakdown would let the amount be recovered by subtraction. Unvalued holdings are counted, not guessed at. Owner and partner only.';

revoke all on function public.personal_holding_totals(uuid) from public;
grant execute on function public.personal_holding_totals(uuid) to authenticated;
