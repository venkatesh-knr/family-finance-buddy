-- Family Finance Buddy — the half of §20 that was promised and never written.
--
-- `20260905120200_investment_policies.sql` says, in a comment on the holding
-- select policy:
--
--   'A personal holding is returned to its member and to nobody else.
--    Household totals still include it, through a function that returns sums.'
--
-- The first sentence was true. The second described a function that did not
-- exist. `personal_expense_totals` was written for spending three migrations
-- later and holdings were never given the same treatment, so every asset total
-- in the app has been quietly short by whatever the other members hold
-- privately — while a comment in the schema said otherwise.
--
-- It surfaced building a household net-worth view, which is exactly the
-- feature that cannot ship on a total like that: two members looking at "what
-- we are worth" and seeing different figures is the disagreement §20 exists to
-- prevent, and a figure that is short without saying so is worse than one that
-- admits it.
--
-- Same shape as the expense version, for the same reasons:
--
--   Only the part the client cannot see. Household-visible holdings and the
--   caller's own personal ones are summed in `src/domain`, where the invariant
--   puts calculation. This returns other members' personal holdings and
--   nothing else, so the arithmetic stays in the tested pure layer.
--
--   One line per member, never per holding and never per asset class. "If a
--   total is visible and only one entry is private, the private amount can be
--   recovered by subtraction." A breakdown by kind would hand back the
--   subtraction; there is no argument that produces one.
--
--   Valued, not booked. A holding with no reading contributes nothing rather
--   than its cost, matching how every other total in the app treats an unread
--   holding — and the count comes back too, so a screen can say the figure is
--   short rather than implying completeness.

/**
 * Other members' personal holdings, one line each.
 *
 * Excludes the caller's own, which they read as rows and would otherwise
 * count twice.
 *
 * Definer, and it must be: the point is to read past the policy. What it does
 * with that power is bounded by what it returns — a member, a sum, a currency
 * and a count of holdings it could not value. No holding, no instrument, no
 * kind, no date.
 */
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
  -- Checked here rather than trusted: a definer function has already stepped
  -- outside the policy that would have checked it.
  if app.household_role(target_household_id) is null then
    raise exception 'Not a member of that household.' using errcode = '42501';
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
    -- The latest reading per holding. Not the highest, and not the closing
    -- value of a period: the same figure the screen shows for a holding it can
    -- see, so the two halves of a total are the same kind of number.
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
  'One sum per member, never per holding or asset class — a breakdown would let the amount be recovered by subtraction. Unvalued holdings are counted, not guessed at.';

revoke all on function public.personal_holding_totals(uuid) from public;
grant execute on function public.personal_holding_totals(uuid) to authenticated;
