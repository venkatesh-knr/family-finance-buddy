-- Family Finance Buddy — accounts are always visible to the household
-- (the owner's decision of 16 November 2026, docs/decisions.md; docs/design/ledger-income.md section 4c).
--
-- Until now an account could be `personal`: a member's own, whose rows and balances nobody else read, and whose figures the month close had to fetch
-- through a security-definer sum. The owner judged the privacy not worth its cost: the last four digits are optional, and what is worth keeping private
-- is what is spent, received and held, which is unchanged. So there is no private account and no setting for one.
--
-- What stays private, as before, in every list: a private credit, a private expense, a private holding and a private holding's entries. What stops being
-- hidden is the total through an account: a private credit paid into an account shows in that account's balance, and a private holding's purchase in
-- what left it, as the design always said of a joint account (private in the list only).
--
-- What this migration does:
--   1. Makes every existing personal account the household's, and adds a check that refuses a personal one (the column stays, with one value, so no
--      table that refers to an account changes shape).
--   2. Recreates the three account policies without the visibility clause. Who reads an account is now its role and nothing else: owner and partner
--      read all of the household's, a contributor reads their own, a viewer none. That is the role model, not privacy, so the clauses that name an
--      account the writer must be able to read stay on the tables a contributor can write (credit, balance, transfer, lot, disposal, PPF, deposit).
--   3. Removes what existed only for a private account from the loan payment: it was readable by whoever could read its account, its audit row likewise,
--      and an account it named had to be one the writer could read. A payment is the household's, like the loan, and only an owner or a partner writes one.
--   4. Recreates the audit-log policy without `loan_payment` among the tables whose audit row follows the row it records.
--   5. Recreates household_private_close without the hidden-account branches. What is left of it is what it exists for: a private credit, and the
--      money into and out of a private holding, into or out of an account the caller reads. It no longer returns what left hidden accounts, the moves
--      that touched them, the change in their reserve or a count of them, because there are none. The function is dropped and created, since its columns
--      change; the grants are repeated.
--
-- The live household's data is dummy, as the owner said, so nothing is lost. Audit rows already written for a personal account keep the visibility they
-- were written with, and stay as hidden as they were: the log is append-only.
--
-- Not changed: household_cash_reserve (it is a total over every account and counts none as hidden), the export list, and the tables' own policies other
-- than those named above.

-- ═══════════════════════════════════════════════ 1. every account is the household's

update public.account set visibility = 'household' where visibility = 'personal';

alter table public.account
  add constraint account_is_household_visible check (visibility = 'household');

comment on column public.account.visibility is
  'Always household: there is no private account (decisions.md, 16 November 2026). The column is kept so nothing that refers to an account changes shape.';

-- ═══════════════════════════════════════════════ 2. the account policies

drop policy if exists account_select_by_role on public.account;
drop policy if exists account_insert on public.account;
drop policy if exists account_update on public.account;

-- Owner and partner read the household's accounts; a contributor reads their own; a viewer reads none.
create policy account_select_by_role
  on public.account
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

create policy account_insert
  on public.account
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and created_by = (select app.current_account_id())
  );

create policy account_update
  on public.account
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  );

comment on policy account_select_by_role on public.account is
  'Owner and partner: the household''s accounts. Contributor: their own. Viewer: none. There is no private account.';
comment on policy account_insert on public.account is
  'A viewer writes nothing. A contributor writes only under their own name.';

-- ═══════════════════════════════════════════════ 3. the loan payment is the household's

drop policy if exists loan_payment_select_follows_account on public.loan_payment;
drop policy if exists loan_payment_insert on public.loan_payment;
drop policy if exists loan_payment_update on public.loan_payment;

create policy loan_payment_select
  on public.loan_payment
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

-- Owner and partner only, as for a loan. Every account of the household is theirs to read, so there is nothing more to ask of an account named.
create policy loan_payment_insert
  on public.loan_payment
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and created_by = (select app.current_account_id())
  );

create policy loan_payment_update
  on public.loan_payment
  for update
  to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'))
  with check (app.household_role(household_id) in ('owner', 'partner'));

comment on policy loan_payment_select on public.loan_payment is
  'The household reads its payments, as it reads its loans.';
comment on policy loan_payment_insert on public.loan_payment is
  'Owner and partner only, like the loan itself.';
comment on table public.loan_payment is
  'One payment on a loan: all of what left, principal and interest. Names the account it left when the person says. Does not change the loan''s stated outstanding. Voided, never deleted (LI-I36 to LI-I38).';

-- ═══════════════════════════════════════════════ 4. the audit log

-- As 20261116120000 left it, without `loan_payment`: a payment is the household's, so its audit row is read as any other row of the household is.
drop policy if exists audit_log_select_by_role on public.audit_log;

create policy audit_log_select_by_role
  on public.audit_log
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (
      (coalesce(after, before) ->> 'holding_id') is null
      or exists (
        select 1
          from public.holding h
         where h.id = ((coalesce(after, before)) ->> 'holding_id')::uuid
      )
    )
    and (
      (coalesce(after, before) ->> 'property_id') is null
      or exists (
        select 1
          from public.property p
         where p.id = ((coalesce(after, before)) ->> 'property_id')::uuid
      )
    )
    and (
      entity not in ('account', 'account_balance', 'account_transfer', 'credit_entry', 'income_entry')
      or case entity
           when 'account'          then exists (select 1 from public.account x          where x.id = audit_log.entity_id)
           when 'account_balance'  then exists (select 1 from public.account_balance x  where x.id = audit_log.entity_id)
           when 'account_transfer' then exists (select 1 from public.account_transfer x where x.id = audit_log.entity_id)
           when 'credit_entry'     then exists (select 1 from public.credit_entry x     where x.id = audit_log.entity_id)
           when 'income_entry'     then exists (select 1 from public.income_entry x     where x.id = audit_log.entity_id)
         end
    )
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

comment on policy audit_log_select_by_role on public.audit_log is
  'Owner and partner: the household''s log, minus other members'' private rows, minus anything about a position or property they cannot read, and minus an audit row for an account, balance, transfer, credit or tax input whose row they cannot read. Contributor: entries about their own rows only. Viewer: none.';

-- ═══════════════════════════════════════════════ 5. the month close, summed over what the caller cannot read

-- As 20261115200000 left it, with every hidden-account branch gone. What the caller cannot read is now only another member's private credit and another
-- member's private holding's entries; both are paid into or out of accounts the caller reads. Per currency:
--
--   left_minor            what the caller's own screen does not add to what left the accounts: a private credit into an account (it raised that account's
--                         closing balance, so more left than the screen shows), and the proceeds of a private holding's sale paid into an account
--   outside_minor         a private credit that names no account: it came in outside the accounts added
--   refunds_minor         a private credit that is a refund, to an account or to none
--   came_in_minor         a private credit that is income, likewise
--   into_holdings_minor   money paid into a holding that the caller's own screen does not add: a private holding's purchase, a deposit's or bond's
--                         principal, an opening cost
--   out_of_holdings_minor money taken out of such a holding and paid into an account; already in left_minor
--
-- own_out_minor and reserve_change_minor are gone: they were the moves that touched a hidden account and the change in its balance. accounts_counted
-- and accounts_total are gone: they counted hidden accounts.

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
    cr as (
      select c.account_id, c.currency, c.amount_minor,
             (c.category = 'refund') as is_refund,
             (c.visibility = 'personal' and c.member_id is distinct from v_me) as hidden_credit
        from public.credit_entry c
       where c.household_id = target_household_id
         and c.voided_at is null
         and c.credit_date between month_first and month_last
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
  'What a month close needs of the money the caller cannot read, per currency: other members'' private credits and the entries of their private holdings (purchases, sales, PPF entries, a deposit''s or bond''s principal, an opening cost). Every account is read, so none is hidden. Totals only: no account, no member, no holding, no balance, no date. A deposit''s maturity payout is not here: it is worked out in the app. For an owner or a partner with a second factor.';

revoke all on function public.household_private_close(uuid, date, date) from public;
grant execute on function public.household_private_close(uuid, date, date) to authenticated;
