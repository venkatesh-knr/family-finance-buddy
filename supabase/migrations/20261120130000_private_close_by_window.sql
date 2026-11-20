-- Family Finance Buddy — household_private_close counts a statement-date card by its window (docs/design/card-cycles.md section 6, slice 3; CY-I12).
--
-- FOR REVIEW. Not applied. A card that closes on its statement date (account.cycle_ends = 'statement', migration 20261120120000) is counted over the cycle of its statement ending
-- in the month, not over the calendar month, and the app's own close does the same (src/features/money/closeMonth.ts, `cardCycles`). So what the caller cannot read that is paid into
-- such a card, a partner's private refund say, must be counted in the same window, or the owner's close and the database's would disagree about which month it belongs to.
--
-- The signature, the columns of the result and its promise (LI-I31: totals only, no account, no member, no holding, no date) are unchanged. For every account that is not a
-- statement-date card the window is the calendar month, so a household with no such card gets exactly the figures it had (CY-I1).
--
-- The window is worked out here as the app works it out (a calculation in the database, a named exception for the same reason as household_yearly_income: only the database can see
-- what the caller cannot, and a total it returns has to be in the window the close uses):
--   dues     a card's recorded dues: every statement's, and a typed one only in a month that has no statement's (one cycle, one figure: CY-I13); one per day, a statement's beating a typed.
--   closing  the latest due dated in the month; opening the latest due before it. The window is the day after the opening to the closing.
--   none     with no opening (the card's first cycle) the window is the closing's month up to the closing, which is as much as is known of it.
--   empty    with no due in the month, and a later one (no statement was dated in it), or none at all yet (waiting), nothing is counted in the month.
--   left out with no due in the month, none later, and a live close_without_card for the month, the card is not in the close and nothing paid into it is counted.
--
-- Decisions made here, for the reviewer to confirm or change:
--   1. The window logic is written twice, here and in closeMonth.ts. A pgTAP file beside this one holds them to the same cases (card-cycles.md section 9's refund). A later change to one
--      is a change to the other; the alternative, the app passing the windows in, would make the function's signature depend on what the caller says and was left out for that reason.
--   2. A private credit into a card is moved into the window; so are the purchases, sales and PPF entries of a private holding that name the card. Nothing else is changed.

create or replace function public.household_private_close(
  target_household_id uuid,
  month_first date,
  month_last date
)
returns table (
  currency text,
  left_minor bigint,
  outside_minor bigint,
  refunds_minor bigint,
  came_in_minor bigint,
  into_holdings_minor bigint,
  out_of_holdings_minor bigint
)
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_me uuid;
begin
  if not app.has_second_factor() then
    raise exception 'Reading the household''s month close needs an authenticator code in this session, not only a password.'
      using errcode = '42501';
  end if;

  if not coalesce(app.household_role(target_household_id) in ('owner', 'partner'), false) then
    raise exception 'Only an owner or a partner reads the household''s month close.' using errcode = '42501';
  end if;

  v_me := app.current_member_id(target_household_id);

  return query
    with acct as (
      select a.id
        from public.account a
       where a.household_id = target_household_id
         and (a.status = 'active' or (a.archived_at at time zone 'Asia/Kolkata')::date >= month_first)
    ),
    -- a statement-date card's recorded dues (card-cycles.md 2.1, 5): one per day, a statement's beating a typed one, and a typed one read only where the month has no statement's
    dues as (
      select distinct on (b.account_id, b.as_at) b.account_id, b.as_at
        from public.account_balance b
        join public.account a on a.id = b.account_id
       where a.household_id = target_household_id
         and a.type = 'card'
         and a.cycle_ends = 'statement'
         and (
           b.source = 'statement'
           or not exists (
             select 1
               from public.account_balance s
              where s.account_id = b.account_id
                and s.source = 'statement'
                and date_trunc('month', s.as_at) = date_trunc('month', b.as_at)
           )
         )
       order by b.account_id, b.as_at, (b.source = 'statement') desc
    ),
    cyc as (
      select c.id as account_id,
             (select max(d.as_at) from dues d where d.account_id = c.id and d.as_at between month_first and month_last) as to_day,
             exists (select 1 from dues d where d.account_id = c.id and d.as_at > month_last) as later,
             exists (
               select 1
                 from public.close_without_card w
                where w.account_id = c.id and w.month = month_first and w.voided_at is null
             ) as without
        from acct c
        join public.account a on a.id = c.id
       where a.type = 'card' and a.cycle_ends = 'statement'
    ),
    -- each account's days in this close: the calendar month, except a statement-date card's cycle; and whether it is in the close at all
    acctwin as (
      select b.id as account_id,
             case
               when y.account_id is null then month_first
               when y.to_day is not null then coalesce(
                 (select max(d.as_at) + 1 from dues d where d.account_id = y.account_id and d.as_at < y.to_day),
                 y.to_day - (extract(day from y.to_day)::int - 1)
               )
               else date '9999-12-31'
             end as wfrom,
             case
               when y.account_id is null then month_last
               when y.to_day is not null then y.to_day
               else date '0001-01-01'
             end as wto,
             not (y.account_id is not null and y.to_day is null and not y.later and y.without) as included
        from acct b
        left join cyc y on y.account_id = b.id
    ),
    cr as (
      select c.account_id, c.currency, c.amount_minor,
             (c.category = 'refund') as is_refund,
             (c.visibility = 'personal' and c.member_id is distinct from v_me) as hidden_credit
        from public.credit_entry c
        left join acctwin aw on aw.account_id = c.account_id
       where c.household_id = target_household_id
         and c.voided_at is null
         and c.credit_date between coalesce(aw.wfrom, month_first) and coalesce(aw.wto, month_last)
         and (aw.account_id is null or aw.included)
    ),
    -- Money into and out of holdings that names an account, as the holdings' own entries say it: a purchase lot is into, a sale, redemption or maturity
    -- is out, a PPF payment is into and a PPF withdrawal is out, a deposit's or bond's principal is into, and so is the opening cost of a holding opened
    -- with one and no purchase and no terms. A bonus issue, a split, a transfer, a gift and an ESOP vest moved no money. Each is counted in the window of the account it names.
    hm as (
      select l.account_id, l.account_currency as currency, coalesce(l.account_amount_minor, l.cost_minor) as amount_minor, 'into'::text as dir,
             (h.visibility = 'personal' and h.member_id is distinct from v_me) as hidden_entry
        from public.lot l
        join public.holding h on h.id = l.holding_id
        join acctwin aw on aw.account_id = l.account_id and aw.included and l.acquired_on between aw.wfrom and aw.wto
       where l.household_id = target_household_id and l.account_id is not null and l.kind = 'purchase'
      union all
      select d.account_id, d.account_currency, coalesce(d.account_amount_minor, d.proceeds_minor), 'out'::text,
             (h.visibility = 'personal' and h.member_id is distinct from v_me)
        from public.disposal d
        join public.holding h on h.id = d.holding_id
        join acctwin aw on aw.account_id = d.account_id and aw.included and d.disposed_on between aw.wfrom and aw.wto
       where d.household_id = target_household_id and d.account_id is not null and d.kind in ('sale', 'redemption', 'maturity')
      union all
      select p.account_id, p.currency, abs(p.amount_minor), case when p.amount_minor > 0 then 'into' else 'out' end,
             (h.visibility = 'personal' and h.member_id is distinct from v_me)
        from public.ppf_entry p
        join public.holding h on h.id = p.holding_id
        join acctwin aw on aw.account_id = p.account_id and aw.included and p.entry_date between aw.wfrom and aw.wto
       where p.household_id = target_household_id and p.account_id is not null and p.voided_at is null
      union all
      select t.account_id, t.account_currency, coalesce(t.account_amount_minor, t.principal_minor), 'into'::text,
             (h.visibility = 'personal' and h.member_id is distinct from v_me)
        from public.fixed_income_terms t
        join public.holding h on h.id = t.holding_id
        join public.instrument i on i.id = h.instrument_id
        join acctwin aw on aw.account_id = t.account_id and aw.included and t.start_date between aw.wfrom and aw.wto
       where t.household_id = target_household_id and t.account_id is not null
         and i.scheme is distinct from 'rd'
      union all
      select h.cost_account_id, h.cost_account_currency, h.cost_minor, 'into'::text,
             (h.visibility = 'personal' and h.member_id is distinct from v_me)
        from public.holding h
        join public.instrument i on i.id = h.instrument_id
        join acctwin aw on aw.account_id = h.cost_account_id and aw.included and h.opened_on between aw.wfrom and aw.wto
       where h.household_id = target_household_id and h.cost_account_id is not null and h.cost_minor is not null
         and i.currency = h.cost_account_currency
         and i.scheme is distinct from 'rd'
         and not exists (select 1 from public.lot x where x.holding_id = h.id)
         and not exists (select 1 from public.fixed_income_terms x where x.holding_id = h.id)
    ),
    -- The ones the caller's own screen does not add: the holding is another member's private one, paid from or into an account in the close.
    hm_unseen as (
      select m.* from hm m join acct b on b.id = m.account_id where m.hidden_entry
    ),
    parts as (
      -- a private credit into an account: money in that the caller cannot see, and so more left the account than the caller's screen shows
      select c.currency, c.amount_minor as left_minor, 0::bigint as outside_minor,
             case when c.is_refund then c.amount_minor else 0::bigint end as refunds_minor,
             case when c.is_refund then 0::bigint else c.amount_minor end as came_in_minor,
             0::bigint as into_holdings_minor, 0::bigint as out_of_holdings_minor
        from cr c join acct b on b.id = c.account_id
       where c.hidden_credit
      union all
      -- a private credit with no account: came in outside the accounts added
      select c.currency, 0::bigint, c.amount_minor,
             case when c.is_refund then c.amount_minor else 0::bigint end,
             case when c.is_refund then 0::bigint else c.amount_minor end,
             0::bigint, 0::bigint
        from cr c
       where c.account_id is null and c.hidden_credit
      union all
      -- money paid into a holding that the caller's own screen does not add
      select m.currency, 0::bigint, 0::bigint, 0::bigint, 0::bigint, m.amount_minor, 0::bigint
        from hm_unseen m where m.dir = 'into'
      union all
      -- money taken out of a holding and paid into an account: money in to that account that the caller's own screen does not add
      select m.currency, m.amount_minor, 0::bigint, 0::bigint, 0::bigint, 0::bigint, m.amount_minor
        from hm_unseen m where m.dir = 'out'
    )
    select p.currency,
           sum(p.left_minor)::bigint, sum(p.outside_minor)::bigint, sum(p.refunds_minor)::bigint, sum(p.came_in_minor)::bigint,
           sum(p.into_holdings_minor)::bigint, sum(p.out_of_holdings_minor)::bigint
      from parts p
     group by p.currency;
end;
$fn$;

comment on function public.household_private_close(uuid, date, date) is
  'What a month close needs of the money the caller cannot read, per currency: other members'' private credits and the entries of their private holdings (purchases, sales, PPF entries, a deposit''s or bond''s principal, an opening cost). Every account is read, so none is hidden. A card that closes on its statement date is counted over the cycle of its statement ending in the month, the same window the app''s close uses (card-cycles.md); every other account over the calendar month. Totals only: no account, no member, no holding, no balance, no date. A deposit''s maturity payout is not here: it is worked out in the app. For an owner or a partner with a second factor.';

revoke all on function public.household_private_close(uuid, date, date) from public;
grant execute on function public.household_private_close(uuid, date, date) to authenticated;
