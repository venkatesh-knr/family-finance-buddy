-- Family Finance Buddy — a deposit, a bond and a holding's opening cost name the account they were paid from or into
-- (docs/design/ledger-income.md section 4b, LI-I32 to LI-I35).
--
-- Section 4a (20261115180000) let a purchase lot, a sale and a PPF entry say which account the money came from or went to, so the month close can read
-- money into and out of holdings. Three things that count in "invested" are not lots and so could not say:
--
--   fixed_income_terms   a deposit's principal, or a bond's face value, paid on `start_date`: `account_id` is the account it was paid from.
--                        A deposit's maturity payout is paid into `payout_account_id`.
--   holding              a holding opened with a cost and no purchase and no terms: `cost_account_id` is the account the cost was paid from, on `opened_on`.
--
-- Optional, as every account on an entry is (LI-I26, LI-I28): null means "not said", and the month close counts the money as it does today.
--
-- A deposit or a bond abroad can be bought from a rupee account, so the principal carries what left the account in the account's currency, as a lot does
-- (`account_amount_minor`, given only when the account's currency is not the deposit's). The payout, which is worked out from the terms and never stored,
-- is paid into an account in the deposit's own currency only; there is no typed amount for it. A holding's opening cost is paid from an account in the
-- holding's own currency only, and the sum below ignores one that is not.
--
-- What does not change: RLS stays enabled and forced and the grants are as they were (no delete). Both tables already have their audit triggers. The four
-- write policies are recreated with one clause each: an account named must be one the caller can read (LI-I29), as for a lot.
--
-- What the database cannot sum, and says so (LI-I35): a deposit's maturity payout. Its amount is the maturity value computed from the terms by
-- src/domain/accrual.ts, which the database does not carry. The month close counts it against the account named for what the caller can read, as it counts
-- the principal; for a deposit of another member's private holding, or one paid into a hidden account, it is not added here, and the close reads that
-- money as it does today. Nothing is guessed.
--
-- household_private_close keeps its signature and its columns; only its body gains the two new sources of money into a holding.

-- ═══════════════════════════════════════════════ 1. the columns

alter table public.fixed_income_terms
  add column account_id uuid,
  add column account_currency text check (account_currency is null or account_currency ~ '^[A-Z]{3}$'),
  add column account_amount_minor bigint check (account_amount_minor is null or account_amount_minor > 0),
  add column payout_account_id uuid;

alter table public.holding
  add column cost_account_id uuid,
  add column cost_account_currency text check (cost_account_currency is null or cost_account_currency ~ '^[A-Z]{3}$');

-- The principal: as a lot's cost. The account is of this household and in the currency it says (the composite key); with none named there is no account
-- currency and no amount; in another currency than the deposit's the amount in that currency is needed, and in its own it is not given.
alter table public.fixed_income_terms
  add constraint fixed_income_terms_account_in_household_fkey
    foreign key (household_id, account_id, account_currency)
    references public.account (household_id, id, currency) on delete restrict,
  add constraint fixed_income_terms_account_amount_shape
    check (
      (account_id is null and account_currency is null and account_amount_minor is null)
      or (account_id is not null and account_currency is not null
          and ((account_currency = currency and account_amount_minor is null)
               or (account_currency <> currency and account_amount_minor is not null)))
    ),
  -- The payout is worked out in the deposit's own currency and paid into an account in it: the composite key on the deposit's own currency says so.
  add constraint fixed_income_terms_payout_account_in_household_fkey
    foreign key (household_id, payout_account_id, currency)
    references public.account (household_id, id, currency) on delete restrict;

-- A holding's cost is in its instrument's currency, which is not on the row, so the shape here is only that an account comes with its currency and a cost.
-- The sum below and the app both use it only where the account's currency is the instrument's.
alter table public.holding
  add constraint holding_cost_account_in_household_fkey
    foreign key (household_id, cost_account_id, cost_account_currency)
    references public.account (household_id, id, currency) on delete restrict,
  add constraint holding_cost_account_shape
    check (
      (cost_account_id is null and cost_account_currency is null)
      or (cost_account_id is not null and cost_account_currency is not null and cost_minor is not null)
    );

comment on column public.fixed_income_terms.account_id is
  'The account the principal (a bond''s face value) was paid from on start_date, when the person says. Null: not said, and the month close counts the money as spent (LI-I32).';
comment on column public.fixed_income_terms.account_currency is
  'The currency of the account named, which may differ from the deposit''s (LI-I32).';
comment on column public.fixed_income_terms.account_amount_minor is
  'What left the account, in the account''s currency, as its statement shows it. Given only when that currency is not the deposit''s; otherwise the principal is it.';
comment on column public.fixed_income_terms.payout_account_id is
  'The account the maturity payout is paid into, in the deposit''s own currency, when the person says. The payout is worked out from the terms and is not stored (LI-I33, LI-I35).';
comment on column public.holding.cost_account_id is
  'The account the opening cost was paid from, on opened_on, for a holding opened with a cost and no purchase and no terms. Null: not said (LI-I34).';
comment on column public.holding.cost_account_currency is
  'The currency of the account named. Counted only where it is the instrument''s own currency (LI-I34).';

-- ═══════════════════════════════════════════════ 2. the policies: an account named is one the caller can read

drop policy fixed_income_terms_insert_own_household on public.fixed_income_terms;
create policy fixed_income_terms_insert_own_household
  on public.fixed_income_terms
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = fixed_income_terms.holding_id)
    and (account_id is null or exists (select 1 from public.account a where a.id = fixed_income_terms.account_id))
    and (payout_account_id is null or exists (select 1 from public.account a where a.id = fixed_income_terms.payout_account_id))
  );

drop policy fixed_income_terms_update_own_household on public.fixed_income_terms;
create policy fixed_income_terms_update_own_household
  on public.fixed_income_terms
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = fixed_income_terms.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = fixed_income_terms.holding_id)
    and (account_id is null or exists (select 1 from public.account a where a.id = fixed_income_terms.account_id))
    and (payout_account_id is null or exists (select 1 from public.account a where a.id = fixed_income_terms.payout_account_id))
  );

comment on policy fixed_income_terms_update_own_household on public.fixed_income_terms is
  'Terms may be corrected in place. The holding must still be one the caller can read, and an account named must be one the caller can read.';

drop policy holding_insert_own_household on public.holding;
create policy holding_insert_own_household
  on public.holding
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and (cost_account_id is null or exists (select 1 from public.account a where a.id = holding.cost_account_id))
  );

drop policy holding_update_own_household on public.holding;
create policy holding_update_own_household
  on public.holding
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (cost_account_id is null or exists (select 1 from public.account a where a.id = holding.cost_account_id))
  );

comment on policy holding_update_own_household on public.holding is
  'A personal holding is editable only by the member it belongs to, and only they can make one personal. An account named for the opening cost must be one the caller can read.';

-- ═══════════════════════════════════════════════ 3. the month close, summed over what the caller cannot read

-- As household_private_close was left by 20261115180000, with two more sources of money into a holding in `hm`:
--
--   a deposit's or a bond's principal on its start date, from the account that named it (a recurring deposit is kept out of invested, so out of this);
--   a holding opened with a cost and no purchase and no terms, at its cost on its opening date, from the account that named it, where that account is in the
--   instrument's own currency.
--
-- Both are money into a holding. The deposit's payout is not here (LI-I35). Same signature, same columns; so create or replace.

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
    -- is out, a PPF payment is into and a PPF withdrawal is out, a deposit's or bond's principal is into, and so is the opening cost of a holding opened
    -- with one and no purchase and no terms. A bonus issue, a split, a transfer, a gift and an ESOP vest moved no money.
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
      union all
      select t.account_id, t.account_currency, coalesce(t.account_amount_minor, t.principal_minor), 'into'::text,
             (h.visibility = 'personal' and h.member_id is distinct from v_me)
        from public.fixed_income_terms t
        join public.holding h on h.id = t.holding_id
        join public.instrument i on i.id = h.instrument_id
       where t.household_id = target_household_id and t.account_id is not null
         and t.start_date between month_first and month_last
         and i.scheme is distinct from 'rd'
      union all
      select h.cost_account_id, h.cost_account_currency, h.cost_minor, 'into'::text,
             (h.visibility = 'personal' and h.member_id is distinct from v_me)
        from public.holding h join public.instrument i on i.id = h.instrument_id
       where h.household_id = target_household_id and h.cost_account_id is not null and h.cost_minor is not null
         and h.opened_on between month_first and month_last
         and i.currency = h.cost_account_currency
         and i.scheme is distinct from 'rd'
         and not exists (select 1 from public.lot x where x.holding_id = h.id)
         and not exists (select 1 from public.fixed_income_terms x where x.holding_id = h.id)
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
  'What a month close needs of the money the caller cannot read, per currency: what left hidden accounts, credits, moves and holding entries the caller cannot see (purchases, sales, PPF entries, a deposit''s or bond''s principal, an opening cost), with how many hidden accounts had both balances. Totals only: no account, no member, no holding, no balance, no date. A deposit''s maturity payout is not here: it is worked out in the app. For an owner or a partner with a second factor.';

revoke all on function public.household_private_close(uuid, date, date) from public;
grant execute on function public.household_private_close(uuid, date, date) to authenticated;
