-- Family Finance Buddy — a holding's entries name the account they were paid from or into (docs/design/ledger-income.md section 4a, LI-I28 to LI-I31;
-- docs/design/spending-capture.md section 10).
--
-- Three tables get an optional account: a purchase lot, a sale (disposal) and a PPF entry. The app writes it from the purchase, sale and PPF forms and
-- reads it in the month close; household_private_close adds the same entries for what the caller cannot read. Apply it before the code that reads
-- the new columns is deployed.
--
-- A month close works out what was spent from balances. Money that left an account to buy something that is not spending (a fund, a PPF payment)
-- has to be named, or it reads as spent and "saved" reads low by it; money that came back (a sale, a PPF withdrawal) has to be named, or it reads as
-- money in the household never had. Three tables hold what the household puts into a holding and takes out of it, and each gets one optional column:
--
--   lot          a purchase: account_id is the account it was paid from
--   disposal     a sale, redemption or maturity: account_id is the account the proceeds were paid into
--   ppf_entry    a payment in (positive) is paid from the account, a withdrawal (negative) is paid into it
--
-- Optional, as accounts are (LI-I26): null means "not said", and the month close then counts the money as it does today. It is never required, and
-- an entry that names none loses nothing.
--
-- The account is of the entry's own household. A purchase abroad is usually paid from a rupee account while the lot records dollars, so a lot and a
-- disposal also say what the account was debited or credited, in the account's own currency, as the bank statement shows it: `account_amount_minor`,
-- in `account_currency`. When the account is in the entry's own currency there is nothing to add (the amount is the cost, or the proceeds) and
-- both are null apart from the currency. No exchange rate is invented, and nothing is converted: the bank's own figure is typed. A PPF entry is
-- rupees only and keeps the plain composite key.
--
-- What does not change: RLS stays enabled and forced on all three tables and their grants are untouched (select, insert, update; no delete). Each
-- table already has its audit trigger, from the migration that created it. This migration recreates the six insert and update policies to add one
-- clause (an account named must be one the caller can read), and recreates household_private_close with two more sums.
--
-- Not here: a deposit's principal and payout, a bond, and a holding opened with a cost and no purchase. Those are counted in "invested" but are not
-- in a lot, and naming their account is a later step of its own.

-- ═══════════════════════════════════════════════ 1. the column

alter table public.lot
  add column account_id uuid,
  add column account_currency text check (account_currency is null or account_currency ~ '^[A-Z]{3}$'),
  add column account_amount_minor bigint check (account_amount_minor is null or account_amount_minor > 0);
alter table public.disposal
  add column account_id uuid,
  add column account_currency text check (account_currency is null or account_currency ~ '^[A-Z]{3}$'),
  add column account_amount_minor bigint check (account_amount_minor is null or account_amount_minor > 0);
alter table public.ppf_entry
  add column account_id uuid;

-- The account named is of this household and is in the currency the entry says it is in (account_currency), by the composite key. With no account
-- named, there is no account currency and no amount. With one named in another currency than the entry's, the amount in that currency is needed,
-- because the cost in the entry's currency is not what left the account; in the entry's own currency it is not given, because the cost is it.
alter table public.lot
  add constraint lot_account_in_household_fkey
    foreign key (household_id, account_id, account_currency)
    references public.account (household_id, id, currency) on delete restrict,
  add constraint lot_account_amount_shape
    check (
      (account_id is null and account_currency is null and account_amount_minor is null)
      or (account_id is not null and account_currency is not null
          and ((account_currency = currency and account_amount_minor is null)
               or (account_currency <> currency and account_amount_minor is not null)))
    );
alter table public.disposal
  add constraint disposal_account_in_household_fkey
    foreign key (household_id, account_id, account_currency)
    references public.account (household_id, id, currency) on delete restrict,
  add constraint disposal_account_amount_shape
    check (
      (account_id is null and account_currency is null and account_amount_minor is null)
      or (account_id is not null and account_currency is not null
          and ((account_currency = currency and account_amount_minor is null)
               or (account_currency <> currency and account_amount_minor is not null)))
    );
alter table public.ppf_entry
  add constraint ppf_entry_account_in_household_fkey
    foreign key (household_id, account_id, currency)
    references public.account (household_id, id, currency) on delete restrict;

comment on column public.lot.account_id is
  'The account the purchase was paid from, when the person says. Null: not said, and the month close counts the money as spent (LI-I28).';
comment on column public.lot.account_currency is
  'The currency of the account named, which may differ from the lot''s (LI-I28).';
comment on column public.lot.account_amount_minor is
  'What left the account, in the account''s currency, as its statement shows it. Given only when that currency is not the lot''s; otherwise the cost is it.';
comment on column public.disposal.account_id is
  'The account a sale, redemption or maturity was paid into, when the person says. Null: not said (LI-I28).';
comment on column public.disposal.account_currency is
  'The currency of the account named, which may differ from the disposal''s (LI-I28).';
comment on column public.disposal.account_amount_minor is
  'What reached the account, in the account''s currency, as its statement shows it. Given only when that currency is not the disposal''s; otherwise the proceeds are it.';
comment on column public.ppf_entry.account_id is
  'The account a payment was paid from, or a withdrawal was paid into, when the person says. Null: not said (LI-I28).';

-- ═══════════════════════════════════════════════ 2. the policies: an account named is one the caller can read

-- A named account must be one the caller can read, so a contributor cannot attach a purchase to another member's private account and learn from the
-- error that it exists (the same rule as credit_entry). A null names nothing and has nothing to check. Only the one clause is added: every other
-- clause is as the policy was.

drop policy lot_insert_own_household on public.lot;
create policy lot_insert_own_household
  on public.lot
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = lot.holding_id)
    and (account_id is null or exists (select 1 from public.account a where a.id = lot.account_id))
  );

drop policy lot_update_own_household on public.lot;
create policy lot_update_own_household
  on public.lot
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = lot.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = lot.holding_id)
    and (account_id is null or exists (select 1 from public.account a where a.id = lot.account_id))
  );

comment on policy lot_update_own_household on public.lot is
  'A cost may be corrected in place. Attribution cannot be moved, the holding must still be one the caller can read, and an account named must be one the caller can read.';

drop policy disposal_insert_own_household on public.disposal;
create policy disposal_insert_own_household
  on public.disposal
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = disposal.holding_id)
    and (account_id is null or exists (select 1 from public.account a where a.id = disposal.account_id))
  );

drop policy disposal_update_own_household on public.disposal;
create policy disposal_update_own_household
  on public.disposal
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = disposal.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = disposal.holding_id)
    and (account_id is null or exists (select 1 from public.account a where a.id = disposal.account_id))
  );

drop policy ppf_entry_insert on public.ppf_entry;
create policy ppf_entry_insert
  on public.ppf_entry
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = ppf_entry.holding_id)
    and (account_id is null or exists (select 1 from public.account a where a.id = ppf_entry.account_id))
  );

drop policy ppf_entry_update on public.ppf_entry;
create policy ppf_entry_update
  on public.ppf_entry
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = ppf_entry.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = ppf_entry.holding_id)
    and (account_id is null or exists (select 1 from public.account a where a.id = ppf_entry.account_id))
  );

-- ═══════════════════════════════════════════════ 3. the month close, summed over what the caller cannot read

-- household_private_close (20261115140000) adds what the caller cannot read to a month close. Money into and out of holdings is now part of the
-- close, so it gains two sums, and the second changes `left`:
--
--   into_holdings_minor     money paid into a holding that the caller cannot see the whole of: from a hidden account with both balances, or, from an
--                           account the caller can read, for a holding that is another member's private one
--   out_of_holdings_minor   money taken out of a holding, in the same cases
--
-- A take-out is money in to the account it was paid into, so it is added to `left_minor` too: what left an account is its opening plus the money in,
-- less its closing, and the money in includes a sale's proceeds. A hidden account missing either balance still contributes nothing but its place in
-- the count, as before; its holding entries are not guessed at either.
--
-- A different result shape needs the function dropped first. Its grants are put back, and it is still callable only by an owner or a partner with a
-- second factor; it returns sums per currency and no account, no member, no holding, no date.

drop function public.household_private_close(uuid, date, date);

create function public.household_private_close(
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
  into_holdings_minor bigint,
  out_of_holdings_minor bigint,
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
    -- Money into and out of holdings that names an account, as the holdings' own entries say it: a purchase lot is into, a sale, redemption or maturity
    -- is out, a PPF payment is into and a PPF withdrawal is out. A bonus issue, a split, a transfer, a gift and an ESOP vest moved no money.
    hm as (
      select l.account_id, l.account_currency as currency, coalesce(l.account_amount_minor, l.cost_minor) as amount_minor, 'into'::text as dir,
             (h.visibility = 'personal' and h.member_id is distinct from v_me) as hidden_entry
        from public.lot l join public.holding h on h.id = l.holding_id
       where l.household_id = target_household_id and l.account_id is not null and l.kind = 'purchase'
         and l.acquired_on between month_first and month_last
      union all
      select d.account_id, d.account_currency, coalesce(d.account_amount_minor, d.proceeds_minor), 'out'::text,
             (h.visibility = 'personal' and h.member_id is distinct from v_me)
        from public.disposal d join public.holding h on h.id = d.holding_id
       where d.household_id = target_household_id and d.account_id is not null and d.kind in ('sale', 'redemption', 'maturity')
         and d.disposed_on between month_first and month_last
      union all
      select p.account_id, p.currency, abs(p.amount_minor), case when p.amount_minor > 0 then 'into' else 'out' end,
             (h.visibility = 'personal' and h.member_id is distinct from v_me)
        from public.ppf_entry p join public.holding h on h.id = p.holding_id
       where p.household_id = target_household_id and p.account_id is not null and p.voided_at is null
         and p.entry_date between month_first and month_last
    ),
    -- The ones the caller's own screen does not add: the account is hidden and has both balances, or the account is readable and the holding is not.
    hm_unseen as (
      select m.* from hm m join bal b on b.id = m.account_id
       where (b.hidden and b.opening is not null and b.closing is not null) or (not b.hidden and m.hidden_entry)
    ),
    parts as (
      -- the money that left each hidden account with both balances
      select r.currency,
             (case when r.type = 'card' then r.closing - r.opening else r.opening - r.closing end
              + coalesce((select sum(c.amount_minor) from cr c where c.account_id = r.id), 0)
              + coalesce((select sum(t.amount_minor) from tr t where t.to_account_id = r.id), 0))::bigint as left_minor,
             0::bigint as outside_minor, 0::bigint as own_out_minor, 0::bigint as refunds_minor, 0::bigint as came_in_minor,
             (case when r.type = 'card' then -(r.closing - r.opening) else r.closing - r.opening end)::bigint as reserve_change_minor,
             0::bigint as into_holdings_minor, 0::bigint as out_of_holdings_minor,
             1 as accounts_counted, 1 as accounts_total
        from ready r
      union all
      -- a hidden account with a balance missing: only its place in the count
      select b.currency, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0, 1
        from bal b where b.hidden and (b.opening is null or b.closing is null)
      union all
      -- a private credit into an account the caller reads: money in that the caller cannot see
      select c.currency, c.amount_minor, 0::bigint, 0::bigint,
             case when c.is_refund then c.amount_minor else 0::bigint end,
             case when c.is_refund then 0::bigint else c.amount_minor end,
             0::bigint, 0::bigint, 0::bigint, 0, 0
        from cr c join bal b on b.id = c.account_id
       where c.hidden_credit and not b.hidden
      union all
      -- a move from a hidden account into one the caller reads
      select t.currency, t.amount_minor, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0, 0
        from tr t join bal f on f.id = t.from_account_id join bal x on x.id = t.to_account_id
       where f.hidden and not x.hidden
      union all
      -- a private credit with no account: came in outside the accounts added
      select c.currency, 0::bigint, c.amount_minor, 0::bigint,
             case when c.is_refund then c.amount_minor else 0::bigint end,
             case when c.is_refund then 0::bigint else c.amount_minor end,
             0::bigint, 0::bigint, 0::bigint, 0, 0
        from cr c
       where c.account_id is null and c.hidden_credit
      union all
      -- a credit into a hidden account with both balances: of whoever's, it is in that account's money in, and so in came in or refunds
      select c.currency, 0::bigint, 0::bigint, 0::bigint,
             case when c.is_refund then c.amount_minor else 0::bigint end,
             case when c.is_refund then 0::bigint else c.amount_minor end,
             0::bigint, 0::bigint, 0::bigint, 0, 0
        from cr c join ready r on r.id = c.account_id
      union all
      -- a move out that the caller cannot see: from a readable account into a hidden one, or from a hidden account with both balances
      select t.currency, 0::bigint, 0::bigint, t.amount_minor, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0, 0
        from tr t join bal f on f.id = t.from_account_id join bal x on x.id = t.to_account_id
       where (not f.hidden and x.hidden)
          or (f.hidden and f.opening is not null and f.closing is not null)
      union all
      -- money paid into a holding that the caller's own screen does not add
      select m.currency, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, m.amount_minor, 0::bigint, 0, 0
        from hm_unseen m where m.dir = 'into'
      union all
      -- money taken out of a holding and paid into an account: money in to that account that the caller's own screen does not add
      select m.currency, m.amount_minor, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, m.amount_minor, 0, 0
        from hm_unseen m where m.dir = 'out'
    )
    select p.currency,
           sum(p.left_minor)::bigint, sum(p.outside_minor)::bigint, sum(p.own_out_minor)::bigint,
           sum(p.refunds_minor)::bigint, sum(p.came_in_minor)::bigint, sum(p.reserve_change_minor)::bigint,
           sum(p.into_holdings_minor)::bigint, sum(p.out_of_holdings_minor)::bigint,
           sum(p.accounts_counted)::integer, sum(p.accounts_total)::integer
      from parts p
     group by p.currency;
end;
$fn$;

comment on function public.household_private_close(uuid, date, date) is
  'What a month close needs of the money the caller cannot read, per currency: what left hidden accounts, credits, moves and holding entries the caller cannot see, with how many hidden accounts had both balances. Totals only: no account, no member, no holding, no balance, no date. For an owner or a partner with a second factor.';

revoke all on function public.household_private_close(uuid, date, date) from public;
grant execute on function public.household_private_close(uuid, date, date) to authenticated;
