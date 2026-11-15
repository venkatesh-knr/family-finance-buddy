-- Family Finance Buddy — the month close, summed over what the caller cannot read (docs/design/spending-capture.md section 2 and the
-- Departures row "Month close: what it reads"; docs/design/ledger-income.md section 4 and LI-I6, LI-I27).
--
-- A month close works out what was spent from the balances at the month's two ends and the money that came in, account by account. A member's
-- personal account, a credit they keep private, and a move that touches either are hidden from everyone else by row-level security. Left out,
-- the close would read wrong, and not only low: a partner's private salary paid into a shared account makes that account's money in too small, so
-- what left it reads too high, and a move from a shared account into a private card is not known to be a move at all.
--
-- The same answer as household_cash_reserve and household_money_totals, and bounded in the same way:
--
--   * Only an owner or a partner may ask, with a second factor; anyone else is refused (42501).
--   * It returns a currency, six sums and two counts, and nothing else: no account, no member, no balance, no name, no date.
--   * It sums only what the caller cannot read. A shared account's own rows are the caller's to read and the screen adds them itself; this adds
--     the rest, so nothing is counted twice and the two halves together are the household's close.
--
-- What it adds, per currency, for a month (the account's own currency; a currency's accounts are never converted into another's):
--
--   left_minor          the money that left each hidden account that has both balances, as the close works it out (opening + money in - closing, and
--                       the other way round for a card), plus the money into a readable account that the caller cannot see: a private credit
--                       to it, and a move into it from a hidden account
--   outside_minor       credits with no account that the caller cannot read, of every category: money that came in outside the accounts added
--   own_out_minor       moves out that the caller cannot see: from a readable account into a hidden one, and from a hidden account with both balances
--   refunds_minor       refunds that the caller cannot read, to a readable account or to none, and every refund to a hidden account with both balances
--   came_in_minor       income (every category but refund) of the same kind
--   reserve_change_minor  the change in a hidden account's balance, a card's due taken off, for the accounts with both balances
--   accounts_counted / accounts_total   the hidden accounts that had both balances, and those there are, so the screen can say
--                       "1 of 2 accounts" and never present a missing balance as nothing
--
-- An account archived before the month began is not in it, as the design says an archived account is not in a close after the month it was
-- archived in. A hidden account missing either balance contributes nothing but its place in the count: its spending is not guessed at.
--
-- This is a named exception to the rule that calculations are pure functions, for the reason household_money_totals is one: a household's
-- total must not disclose what each member keeps private. It is read-only and changes no table, so it needs no policy, audit trigger or reset.

create or replace function public.household_private_close(
  target_household_id uuid,
  month_first date,
  month_last date
)
returns table (
  currency text,
  left_minor bigint,
  outside_minor bigint,
  own_out_minor bigint,
  refunds_minor bigint,
  came_in_minor bigint,
  reserve_change_minor bigint,
  accounts_counted integer,
  accounts_total integer
)
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_me uuid;
  v_open date := month_first - 1;
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
      select a.id, a.type, a.currency,
             (a.visibility = 'personal' and a.member_id is distinct from v_me) as hidden
        from public.account a
       where a.household_id = target_household_id
         and (a.status = 'active' or (a.archived_at at time zone 'Asia/Kolkata')::date >= month_first)
    ),
    bal as (
      select a.id, a.type, a.currency, a.hidden,
             (select b.balance_minor from public.account_balance b
               where b.account_id = a.id and b.as_at = v_open
               order by (b.source = 'statement') desc limit 1) as opening,
             (select b.balance_minor from public.account_balance b
               where b.account_id = a.id and b.as_at = month_last
               order by (b.source = 'statement') desc limit 1) as closing
        from acct a
    ),
    ready as (
      select b.* from bal b where b.hidden and b.opening is not null and b.closing is not null
    ),
    cr as (
      select c.account_id, c.currency, c.amount_minor,
             (c.category = 'refund') as is_refund,
             (c.visibility = 'personal' and c.member_id is distinct from v_me) as hidden_credit
        from public.credit_entry c
       where c.household_id = target_household_id
         and c.voided_at is null
         and c.credit_date between month_first and month_last
    ),
    tr as (
      select t.from_account_id, t.to_account_id, t.currency, t.amount_minor
        from public.account_transfer t
       where t.household_id = target_household_id
         and t.voided_at is null
         and t.transfer_date between month_first and month_last
    ),
    parts as (
      -- the money that left each hidden account with both balances
      select r.currency,
             (case when r.type = 'card' then r.closing - r.opening else r.opening - r.closing end
              + coalesce((select sum(c.amount_minor) from cr c where c.account_id = r.id), 0)
              + coalesce((select sum(t.amount_minor) from tr t where t.to_account_id = r.id), 0))::bigint as left_minor,
             0::bigint as outside_minor, 0::bigint as own_out_minor, 0::bigint as refunds_minor, 0::bigint as came_in_minor,
             (case when r.type = 'card' then -(r.closing - r.opening) else r.closing - r.opening end)::bigint as reserve_change_minor,
             1 as accounts_counted, 1 as accounts_total
        from ready r
      union all
      -- a hidden account with a balance missing: only its place in the count
      select b.currency, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0, 1
        from bal b where b.hidden and (b.opening is null or b.closing is null)
      union all
      -- a private credit into an account the caller reads: money in that the caller cannot see
      select c.currency, c.amount_minor, 0::bigint, 0::bigint,
             case when c.is_refund then c.amount_minor else 0::bigint end,
             case when c.is_refund then 0::bigint else c.amount_minor end,
             0::bigint, 0, 0
        from cr c join bal b on b.id = c.account_id
       where c.hidden_credit and not b.hidden
      union all
      -- a move from a hidden account into one the caller reads
      select t.currency, t.amount_minor, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0, 0
        from tr t join bal f on f.id = t.from_account_id join bal x on x.id = t.to_account_id
       where f.hidden and not x.hidden
      union all
      -- a private credit with no account: came in outside the accounts added
      select c.currency, 0::bigint, c.amount_minor, 0::bigint,
             case when c.is_refund then c.amount_minor else 0::bigint end,
             case when c.is_refund then 0::bigint else c.amount_minor end,
             0::bigint, 0, 0
        from cr c
       where c.account_id is null and c.hidden_credit
      union all
      -- a credit into a hidden account with both balances: of whoever's, it is in that account's money in, and so in came in or refunds
      select c.currency, 0::bigint, 0::bigint, 0::bigint,
             case when c.is_refund then c.amount_minor else 0::bigint end,
             case when c.is_refund then 0::bigint else c.amount_minor end,
             0::bigint, 0, 0
        from cr c join ready r on r.id = c.account_id
      union all
      -- a move out that the caller cannot see: from a readable account into a hidden one, or from a hidden account with both balances
      select t.currency, 0::bigint, 0::bigint, t.amount_minor, 0::bigint, 0::bigint, 0::bigint, 0, 0
        from tr t join bal f on f.id = t.from_account_id join bal x on x.id = t.to_account_id
       where (not f.hidden and x.hidden)
          or (f.hidden and f.opening is not null and f.closing is not null)
    )
    select p.currency,
           sum(p.left_minor)::bigint, sum(p.outside_minor)::bigint, sum(p.own_out_minor)::bigint,
           sum(p.refunds_minor)::bigint, sum(p.came_in_minor)::bigint, sum(p.reserve_change_minor)::bigint,
           sum(p.accounts_counted)::integer, sum(p.accounts_total)::integer
      from parts p
     group by p.currency;
end;
$fn$;

comment on function public.household_private_close(uuid, date, date) is
  'What a month close needs of the money the caller cannot read, per currency: what left hidden accounts, credits and moves the caller cannot see, with how many hidden accounts had both balances. Totals only: no account, no member, no balance, no date. For an owner or a partner with a second factor.';

revoke all on function public.household_private_close(uuid, date, date) from public;
grant execute on function public.household_private_close(uuid, date, date) to authenticated;
