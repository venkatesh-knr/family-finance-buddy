-- Family Finance Buddy — the spending summary names its categories.
--
-- `household_expense_totals` (20260925120000) returns a category id. A viewer
-- cannot read `expense_category`, and a contributor reads it but should not have
-- to join across to be shown a summary, so a summary that says "category
-- 3f9c… spent ₹4,000" is no summary at all.
--
-- The function is a definer and already reads past the policy, so it can return
-- the name itself. A name is not an amount, and it is the label the household
-- chose for a heading rather than anybody's record; it is bounded to that.
-- Archived categories keep their name: their history is still in the totals.
--
-- Changing a function's result columns needs a drop, not a replace. Nothing in
-- the database depends on it; the grant is restated below.

drop function if exists public.household_expense_totals(uuid, date, date);

create function public.household_expense_totals(
  target_household_id uuid,
  from_date date,
  to_date date
)
returns table (category_id uuid, category_name text, total_minor bigint, currency text)
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
    select e.category_id,
           c.name,
           sum(e.amount_minor)::bigint,
           e.currency
      from public.expense_txn e
      left join public.expense_category c
        on c.household_id = e.household_id and c.id = e.category_id
     where e.household_id = target_household_id
       and e.visibility = 'household'
       and e.voided_at is null
       and e.txn_date between from_date and to_date
     group by e.category_id, c.name, e.currency;
end;
$fn$;

comment on function public.household_expense_totals(uuid, date, date) is
  'The household''s shared spending by category and currency, for whoever cannot read the rows. The category''s name comes with it; null name and null id together are uncategorised. Excludes private entries, which arrive as one figure per member from personal_expense_totals.';

revoke all on function public.household_expense_totals(uuid, date, date) from public;
grant execute on function public.household_expense_totals(uuid, date, date) to authenticated;
