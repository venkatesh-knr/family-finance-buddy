-- Family Finance Buddy — a card switched to its statement date keeps the months it was closed at month end (docs/design/card-cycles.md section 6.1; CY-I18).
--
-- FOR REVIEW. Not applied. Shown before any screen is built on it (CLAUDE.md). It is the launch blocker of commercial-launch.md section 11: required before the first real, non-demo household.
-- Until now a switch applied to every month, either way, at any time, which was right while only demo data existed. From here a switch leaves the months already closed as they were.
--
-- What it adds:
--   account.cycle_from                     the first month a card is on its statement date, the first day of a month; null is every month (a card made so, and every card until now).
--   app.account_cycle_guard()              sets it when a card is switched to its statement date and refuses what would change a closed month.
--   app.close_without_card_check           re-created: a card is left out of a close only for a month it closes on its statement date.
--   household_private_close                re-created: a card is counted over its cycle only from its first month, and the window of that month opens at the last month-end due before it.
--
-- The rules (card-cycles.md 6.1); the first is decided by the owner on 27 November 2026, the rest follow the design:
--   1. A month is closed for a card when the card has a due dated on that month's last day, a statement's or a typed one ("month-end due recorded"; there is no stored flag, a closed month is derived).
--   2. Switching to the statement date sets cycle_from to the month after the card's latest month-end due, or leaves it null for a card with none. A caller may ask for a later month, never an earlier one.
--   3. Switching back to month end is refused once any due is dated in or after cycle_from (any due at all, for a card with no cycle_from): a statement under the rule is in use, and closed months would
--      change. It clears cycle_from. A card with no due under the rule goes back freely.
--   4. cycle_from is set only by a switch. It is not edited on a card that stays on its statement date.
--   5. The first window opens at the later of the statement's previous-balance date and the last month-end due, so no day is counted twice: the previous balance the import records, dated in a month
--      already closed, is earlier than that month-end due and opens nothing; where the first month asked for is later, a statement's due dated after the last month-end due does open it.
--
-- What it does not change: row-level security on account (whoever may update an account may switch it: an owner or a partner for any card, a contributor for their own), its grants, its audit trigger,
-- and the signature and promise of household_private_close (LI-I31: totals only, no account, no member, no holding, no date). The window logic is still written twice, here and in closeMonth.ts, and
-- the pgTAP file beside this one holds them to the same cases.
--
-- Decisions made here, for the reviewer to confirm or change:
--   1. account_cycle_guard is security definer so that it reads the card's dues whoever is switching it: a contributor may switch their own card without being able to read every due. It returns nothing
--      to the caller but the sentence of a refusal.
--   2. The guard fires on insert and on update of cycle_ends or cycle_from only, so no other change to an account reads a balance.
--   3. A due dated on the last day of a month counts as a close whatever its source and whether or not its card was then on its statement date; a statement that happens to be dated the 31st is a close.
--   4. cycle_from cannot be set on a new card: a card made on its statement date has no month closed before it.
--   5. The import's *Use the statement date* for a month-end card is a switch like any other, so it is held to the same rules (its screen is a later slice).

-- ═══════════════════════════════════════════════ 1. account: the first month a card is on its statement date

alter table public.account
  add column cycle_from date;

alter table public.account
  add constraint account_cycle_from_a_month_of_a_statement_card
    check (cycle_from is null or (cycle_ends = 'statement' and extract(day from cycle_from) = 1));

comment on column public.account.cycle_from is
  'The first month a card is on its statement date, the first day of a month; the months before it were closed at month end and stay as they were (card-cycles.md 6.1). Null is every month. Set by switching a card, never edited.';

-- ═══════════════════════════════════════════════ 2. the guard on a switch

create or replace function app.account_cycle_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_last_close date;
  v_minimum date;
begin
  if tg_op = 'INSERT' then
    if new.cycle_from is not null then
      raise exception 'A new card has no month closed before it, so it has no first month on its statement date.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.cycle_ends = 'statement' and old.cycle_ends = 'month_end' then
    -- Switched to the statement date: from the month after the card's latest month-end due, never an earlier month.
    select max(b.as_at) into v_last_close
      from public.account_balance b
     where b.account_id = new.id
       and b.as_at = (date_trunc('month', b.as_at) + interval '1 month - 1 day')::date;
    v_minimum := case when v_last_close is null then null else (date_trunc('month', v_last_close) + interval '1 month')::date end;
    if new.cycle_from is null then
      new.cycle_from := v_minimum;
    elsif v_minimum is not null and new.cycle_from < v_minimum then
      raise exception 'The months up to % were closed at month end and stay as they were, so the statement date can start from % at the earliest.',
        to_char(v_last_close, 'FMMonth YYYY'), to_char(v_minimum, 'FMMonth YYYY') using errcode = '23514';
    end if;
  elsif new.cycle_ends = 'month_end' and old.cycle_ends = 'statement' then
    -- Switched back: only while no due under the statement date is in use.
    if exists (
      select 1 from public.account_balance b
       where b.account_id = new.id and (old.cycle_from is null or b.as_at >= old.cycle_from)
    ) then
      raise exception 'This card has dues recorded on its statement date, so it cannot go back to month end: months already closed would change.' using errcode = '23514';
    end if;
    new.cycle_from := null;
  elsif new.cycle_from is distinct from old.cycle_from then
    raise exception 'The first month on the statement date is set when the card is switched and does not change after.' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

create trigger account_cycle_guard
  before insert or update of cycle_ends, cycle_from on public.account
  for each row execute function app.account_cycle_guard();

-- ═══════════════════════════════════════════════ 3. a card is left out of a close only for a month it closes on its statement date

create or replace function app.close_without_card_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.account a
       where a.id = new.account_id and a.type = 'card' and a.cycle_ends = 'statement' and (a.cycle_from is null or new.month >= a.cycle_from)
    ) then
      raise exception 'Only a card whose bill closes on its statement date can be left out of a close, and only for a month it closes on it.' using errcode = '23514';
    end if;
    if new.month >= date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date then
      raise exception 'A month can be closed only once it has ended.' using errcode = '23514';
    end if;
  elsif (new.household_id, new.account_id, new.month, new.created_by) is distinct from (old.household_id, old.account_id, old.month, old.created_by) then
    raise exception 'A close without a card is voided and made again, never edited.' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

-- ═══════════════════════════════════════════════ 4. household_private_close: the window starts at the card's first month
-- (the function as 20261120130000 made it, with the two changes marked "CY-I18")

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
           -- CY-I18: the dues of the card's first month on its statement date and after: every statement's, and a typed one only where the month has no statement's
           (
             (a.cycle_from is null or b.as_at >= a.cycle_from)
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
           )
           -- CY-I18: and, for a card switched from month end, the later of the last month-end due and a statement's due before that month: it opens the first window
           or (
             a.cycle_from is not null
             and b.as_at < a.cycle_from
             and (b.source = 'statement' or b.as_at = (date_trunc('month', b.as_at) + interval '1 month - 1 day')::date)
             and b.as_at = (
               select max(m.as_at)
                 from public.account_balance m
                where m.account_id = b.account_id
                  and m.as_at < a.cycle_from
                  and (m.source = 'statement' or m.as_at = (date_trunc('month', m.as_at) + interval '1 month - 1 day')::date)
             )
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
       where a.type = 'card' and a.cycle_ends = 'statement' and (a.cycle_from is null or month_first >= a.cycle_from)   -- CY-I18
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
