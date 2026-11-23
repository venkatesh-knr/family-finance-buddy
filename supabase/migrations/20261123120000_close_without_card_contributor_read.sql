-- Family Finance Buddy — a contributor reads the choices to close a month without their own card (docs/design/card-cycles.md 2.4; the owner, 23 November 2026).
--
-- FOR REVIEW. Not applied. `close_without_card` (migration 20261120120000) was readable by an owner and a partner only, so a month an owner closed without a contributor's own card
-- still read as *waiting* to that contributor. The owner decided on 23 November 2026 that a contributor reads the rows for accounts they can read (their own cards), so the month stops
-- saying waiting. Insert and update stay owner and partner only; rows for other members' cards stay unreadable to a contributor, as those accounts already are.
--
-- What changes: the select policy only. Writes, grants, the second-factor policy and the audit trigger are as they were; the audit row of a choice is read by an owner or a partner as before.
--
-- Decision made here, for the reviewer: the contributor's read follows the account policy through an `exists` on `public.account`, which a contributor reads only for their own accounts
-- (account_select_by_role), so no second rule about whose card it is can drift from the first.

drop policy close_without_card_select on public.close_without_card;

create policy close_without_card_select
  on public.close_without_card
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (
      app.household_role(household_id) in ('owner', 'partner')
      or (
        app.household_role(household_id) = 'contributor'
        and exists (select 1 from public.account a where a.id = close_without_card.account_id)
      )
    )
  );

comment on policy close_without_card_select on public.close_without_card is
  'An owner or a partner reads every choice; a contributor reads the choices for accounts they can read (their own cards). Written only by an owner or a partner.';
