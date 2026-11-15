-- Family Finance Buddy — the cash reserve's archive boundary is IST, and the same rule as the close (docs/design/ledger-income.md section 1a; CLAUDE.md:
-- all period boundaries are IST).
--
-- 20261115120000_cash_reserve.sql kept an account in the reserve when it was in use, or archived after the day the reserve is as at, comparing a
-- timestamp with `(as_of + 1)::timestamptz`. That cast uses the session time zone, which is UTC on Supabase, so the cut-off was 05:30 IST on the 1st:
-- an account archived between 00:00 and 05:30 IST on 1 November was dropped from October's reserve. It was also the wrong rule. An archived account is
-- not in a close after the month it was archived in, which means it is in the close of that month and of every earlier one; household_private_close
-- and the app's own close already work that way, and a close could say 4 of 4 accounts while the reserve beside it said 3 of 3.
--
-- The rule now: an account is in the reserve as at a day when it is in use, or was archived (in India) in the month that day falls in or later.
-- Nothing else changes: the same arguments, the same columns, the same checks, the same grants. This replaces the function; no table changes.

create or replace function public.household_cash_reserve(
  target_household_id uuid,
  as_of date
)
returns table (currency text, reserve_minor bigint, accounts_counted integer, accounts_total integer)
language plpgsql
security definer
stable
set search_path = ''
as $fn$
begin
  if not app.has_second_factor() then
    raise exception 'Reading the household''s cash reserve needs an authenticator code in this session, not only a password.'
      using errcode = '42501';
  end if;

  if not coalesce(app.household_role(target_household_id) in ('owner', 'partner'), false) then
    raise exception 'Only an owner or a partner reads the household''s cash reserve.' using errcode = '42501';
  end if;

  return query
    with in_use as (
      select a.id, a.type, a.currency
        from public.account a
       where a.household_id = target_household_id
         and (a.status = 'active' or (a.archived_at at time zone 'Asia/Kolkata')::date >= date_trunc('month', as_of)::date)
    ),
    latest as (
      select distinct on (b.account_id)
             b.account_id, b.balance_minor
        from public.account_balance b
        join in_use u on u.id = b.account_id
       where b.household_id = target_household_id
         and b.as_at <= as_of
       order by b.account_id, b.as_at desc, (b.source = 'statement') desc
    )
    select u.currency,
           coalesce(sum(case when u.type = 'card' then -l.balance_minor else l.balance_minor end) filter (where l.account_id is not null), 0)::bigint,
           (count(l.account_id))::integer,
           (count(*))::integer
      from in_use u
      left join latest l on l.account_id = u.id
     group by u.currency;
end;
$fn$;

comment on function public.household_cash_reserve(uuid, date) is
  'The cash reserve per currency as at a day: the latest balance of each account, a card''s taken off, with how many accounts had one and how many there are. An account archived in India in the month of that day or later is in it. Totals only: no account, no member, no balance. For an owner or a partner with a second factor (LI-I27).';

revoke all on function public.household_cash_reserve(uuid, date) from public;
grant execute on function public.household_cash_reserve(uuid, date) to authenticated;
