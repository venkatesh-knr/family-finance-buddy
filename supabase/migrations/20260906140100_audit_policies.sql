-- Family Finance Buddy — who may read the audit log.
--
-- Last of the policy migrations, and it has to be. The log shadows every table
-- in the schema, and one of its rules resolves through valuation_snapshot — so
-- it cannot be written until every table it speaks about exists. That is the
-- only reason this is not in the policies migration with everything else.
--
-- There is no insert, update or delete policy here, and there never will be.
-- Append-only is enforced one level down, by the absence of the privilege: see
-- the revoke in the migration that creates the table. A policy would be a
-- weaker statement than a missing grant, because a policy can be replaced.

-- ---------------------------------------------------------------- audit_log

/**
 * The log is readable by the household it describes, under the same visibility
 * rule as the rows it shadows.
 *
 * Section 20 wants members to see it — "if a spouse can see that her salary
 * entry was viewed, the conversation stops being 'please trust me' and becomes
 * 'check for yourself'" — and that only works if reading it is ordinary.
 *
 * The visibility clause is what stops it becoming the hole in private entries.
 * Without it the before and after of a personal expense would sit here in
 * plain sight, and the owner would read in the log exactly what the policy
 * stopped them reading in the table.
 */
create policy audit_log_select_same_household
  on public.audit_log
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    -- Privacy that is inherited rather than stated. A valuation_snapshot has
    -- no visibility column: it is as private as the holding it values, which
    -- is why its own policy resolves through that holding. The audit row is
    -- resolved the same way and by the same one rule — the subquery runs as
    -- the caller, so valuation_snapshot's policy, and through it holding's,
    -- decide. Without this the log would report the value of a personal
    -- holding that the table itself refuses to show.
    and (
      entity <> 'valuation_snapshot'
      or exists (
        select 1 from public.valuation_snapshot v where v.id = audit_log.entity_id
      )
    )
  );

comment on policy audit_log_select_same_household on public.audit_log is
  'Same visibility test as the row it describes. There is no insert, update or delete policy, and no grant for them either — append-only is a privilege, not a promise.';

grant select on table public.audit_log to authenticated;
