-- Family Finance Buddy — an audit row about a position is as private as the position.
--
-- Section 20: "Any member can mark a transaction, an account … as personal. It
-- counts in their own figures and in household aggregates; the line-item detail
-- is returned to nobody else, the owner included."
--
-- The audit log carries `before` and `after` in full, so it has to hold exactly
-- the line the table it shadows holds. The select policy already did that for
-- two things: a row that states its own visibility (an expense, a holding), and
-- a valuation snapshot, whose privacy is inherited from its holding and which
-- the policy resolved by name.
--
-- It did not do it for `lot` or `disposal`. They hang off a holding the same
-- way a snapshot does, carry no visibility or member of their own, and so their
-- audit rows were written as household-visible with no member. An owner or a
-- partner could therefore read, in the log, what a member's *personal* holding
-- cost and what it sold for: precisely the figures the holding row withholds
-- from them, and the sharper leak, since cost and proceeds give the gain.
--
-- ── the fix, and why it is generic ──────────────────────────────────────────
--
-- Not a list of three entity names, which is the shape that let this happen: it
-- is a list somebody has to remember to extend, and two tables were added after
-- it was written. Every table that hangs off a holding names it in `holding_id`,
-- so the rule is stated about the *payload*: an audit row whose row has a
-- holding_id is readable only if the caller can read that holding, resolved as
-- the caller so the holding's own policy decides. Written once, and it covers the
-- next table that hangs off a holding without anybody remembering to.
--
-- It also covers the snapshot, which it replaces: the snapshot's row carries
-- holding_id too, and the answer is the same one.
--
-- Everything else in the policy is as it was in 20260925120000.

drop policy if exists audit_log_select_by_role on public.audit_log;

create policy audit_log_select_by_role
  on public.audit_log
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (
      (coalesce(after, before) ->> 'holding_id') is null
      or exists (
        select 1
          from public.holding h
         where h.id = ((coalesce(after, before)) ->> 'holding_id')::uuid
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
  'Owner and partner: the household''s log, minus other members'' private rows and minus anything about a position they cannot read, whatever table it hangs off (any audit row whose row names a holding_id). Contributor: entries about their own rows only. Viewer: none.';
