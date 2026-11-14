-- Family Finance Buddy — the cash reserve, summed (docs/design/ledger-income.md section 1a and LI-I27; docs/design/spending-capture.md section 2).
--
-- The cash reserve is the money kept in the household's savings and current accounts, less what is due on its cards, as at a day. It comes from
-- the balances typed at a month close, and a household that has closed a month shows it on the Accounts tab and in the month's split.
--
-- A member's personal account is hidden from everyone else: its row and its balances are returned to nobody but its owner (LI-I26, LI-I27).
-- The household's cash reserve must still count it, as a total, and the only way to add what you cannot read is a function that reads past the
-- policy. This is the second such function after household_money_totals, and it is bounded in the same way:
--
--   * Only an owner or a partner may ask, with a second factor, as for every other read of the household's money; anyone else is refused.
--   * It returns a currency, one sum, and two counts (the accounts that had a balance as at the day, and the accounts there are) and nothing
--     else: no account, no member, no balance, no name. The counts say *2 of 3 accounts*, which is what the screen shows beside the figure.
--   * A currency with accounts and no balance at all returns a sum of nothing and a count of none, so the screen can say that nothing was
--     typed and never show it as a reserve of nothing.
--
-- The balance of an account is its latest as at the day, a statement's beating a typed one on the same day (the rule account_balance already
-- follows). A card's balance is what is due, so it comes off. An account archived on or before the day is not in it, as the design says an
-- archived account is not in a close after the month it was archived in. This is a named exception to the rule that calculations are pure
-- functions, for the reason household_money_totals is one: a household total must not disclose what each member keeps private.
--
-- No table changes: nothing here needs a policy, an audit trigger or a reset, and the function is read-only.

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
         and (a.status = 'active' or a.archived_at > (as_of + 1)::timestamptz)
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
  'The cash reserve per currency as at a day: the latest balance of each account, a card''s taken off, with how many accounts had one and how many there are. Totals only: no account, no member, no balance. For an owner or a partner with a second factor (LI-I27).';

revoke all on function public.household_cash_reserve(uuid, date) from public;
grant execute on function public.household_cash_reserve(uuid, date) to authenticated;
