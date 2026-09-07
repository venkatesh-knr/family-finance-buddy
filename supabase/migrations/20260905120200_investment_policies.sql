-- Family Finance Buddy — policies for instruments, holdings and valuations.
--
-- Same shape as the expense policies: resolve through membership, scope to
-- `authenticated`, decide access and nothing else. No delete policy anywhere,
-- because deletes are soft.
--
-- One deliberate difference from expenses. A holding is filed under a member,
-- but an instrument is not — an ETF is the same ETF whoever owns it — so the
-- contributor restriction applies to holdings and snapshots, not to the
-- instrument itself. A contributor who could not add the instrument could not
-- record their own holding in it.

-- ------------------------------------------------------------- instrument

create policy instrument_select_same_household
  on public.instrument
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

create policy instrument_insert_own_household
  on public.instrument
  for insert
  to authenticated
  with check (app.household_role(household_id) in ('owner', 'partner', 'contributor'));

create policy instrument_update_own_household
  on public.instrument
  for update
  to authenticated
  using (app.household_role(household_id) in ('owner', 'partner', 'contributor'))
  with check (app.household_role(household_id) in ('owner', 'partner', 'contributor'));

comment on policy instrument_insert_own_household on public.instrument is
  'Shared by the household, so not restricted per member — otherwise a contributor could not record their own holding.';

-- ---------------------------------------------------------------- holding

create policy holding_select_same_household
  on public.holding
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  );

comment on policy holding_select_same_household on public.holding is
  'A personal holding is returned to its member and to nobody else. Household totals still include it, through a function that returns sums.';

create policy holding_insert_own_household
  on public.holding
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  );

create policy holding_update_own_household
  on public.holding
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  );

comment on policy holding_insert_own_household on public.holding is
  'A viewer writes nothing. A contributor records only their own positions.';

-- ----------------------------------------------------- valuation_snapshot

/**
 * A valuation is as private as the holding it values.
 *
 * valuation_snapshot carries no member_id and no visibility of its own — it
 * hangs off a holding, and that is where the question belongs. Leaving this
 * policy on household_id alone would have published the month-by-month value
 * of a personal holding while hiding the holding itself, which is the more
 * revealing half of the pair.
 *
 * The subquery is read as the caller, so the holding's own policy decides what
 * it can see. That is deliberate: one rule, written once, rather than a second
 * copy here to drift out of step with it.
 */
create policy valuation_snapshot_select_same_household
  on public.valuation_snapshot
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (
      select 1 from public.holding h where h.id = valuation_snapshot.holding_id
    )
  );

create policy valuation_snapshot_insert_own_household
  on public.valuation_snapshot
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
  );

-- Updatable on purpose, unlike a transaction. A snapshot is a reading, and a
-- misread figure should be corrected in place rather than leave two rows that
-- disagree about what a holding was worth on one date. Attribution stays fixed:
-- created_by is not in the with-check, so it cannot be rewritten to someone else.
create policy valuation_snapshot_update_own_household
  on public.valuation_snapshot
  for update
  to authenticated
  using (app.household_role(household_id) in ('owner', 'partner', 'contributor'))
  with check (app.household_role(household_id) in ('owner', 'partner', 'contributor'));

comment on policy valuation_snapshot_update_own_household on public.valuation_snapshot is
  'A reading may be corrected in place. Attribution cannot be moved.';

-- ------------------------------------- the second factor, on these too

-- Restrictive, so it narrows the policies above rather than adding a way past
-- them. Same reasoning as 20260904120400: the publishable key ships in the
-- bundle, so a password alone must not reach household data.

create policy require_second_factor
  on public.instrument
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.holding
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.valuation_snapshot
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());
