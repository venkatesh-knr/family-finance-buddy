-- Family Finance Buddy — a loan payment, and the month close's sum of what it cannot read
-- (docs/design/ledger-income.md section 4c, LI-I36 to LI-I39).
--
-- The month close splits saved into invested, paid to loans and the cash reserve (LI-I23, spending-capture decided 13 November). The close's domain
-- function has taken loan payments from the start (src/domain/money-month.ts) and has been given none, because nothing records one: a `liability` says
-- what is owed and what the instalment is, and no row says that an instalment was paid, when, or from which account. This is that row.
--
--   loan_payment   one payment on a loan: the loan, the day, all of the amount that left (principal and interest, as the decided wording has it) and,
--                  when the person says, the account it left. Optional, as every account on an entry is: naming none changes nothing the close does.
--
-- A payment is in the loan's own currency and leaves an account in that currency only: the two composite keys below say so, and there is no typed
-- amount (a dollar loan is not offered a rupee account). It does not change what the loan says is outstanding, and nothing is worked out from it: what
-- is owed stays the figure a person states (20260908130000), as of the day they state it.
--
-- Who sees it. A payment naming an account is as private as that account, as a transfer is (LI-I27): it is read by whoever can read the account, and so
-- is its audit row (LI-I37). A payment naming none is the household's, like the loan. Only an owner or a partner records one, as they alone record a
-- loan, and only against an account they can read (LI-I29). Voided, never deleted.
--
-- The close, for an owner or a partner, cannot read another member's private account. `household_private_close` adds what left such an account as a
-- total; the payments among it are one more sum, in a function of its own (`household_private_loans`) so that function's pinned result is left alone:
-- a currency and one number, no account, no loan, no member and no date.
--
-- What does not change: `household_private_close`, and every other table. The audit trigger is in this migration, as for every table that holds
-- household data. reset_demo_household is re-created with the new table cleared, and the export's list names the table.

-- ═══════════════════════════════════════════════ 1. the table

-- A payment's currency is its loan's, enforced by a composite key onto the loan's own currency.
alter table public.liability
  add constraint liability_household_id_id_currency_key unique (household_id, id, currency);

create table public.loan_payment (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,
  liability_id  uuid        not null,

  paid_on       date        not null,
  amount_minor  bigint      not null check (amount_minor > 0),
  currency      text        not null check (currency ~ '^[A-Z]{3}$'),

  -- The account the payment left, when the person says. Null: not said, and the close does not count the payment (LI-I38).
  account_id    uuid,

  note          text        check (note is null or length(note) <= 500),
  voided_at     timestamptz,
  voided_by     uuid        references public.user_account (id) on delete restrict,

  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint loan_payment_voided_pair check ((voided_at is null) = (voided_by is null)),

  -- The loan is of this household and in this currency; the account, when named, likewise.
  constraint loan_payment_liability_in_household_fkey
    foreign key (household_id, liability_id, currency)
    references public.liability (household_id, id, currency) on delete restrict,
  constraint loan_payment_account_in_household_fkey
    foreign key (household_id, account_id, currency)
    references public.account (household_id, id, currency) on delete restrict
);

comment on table public.loan_payment is
  'One payment on a loan: all of what left, principal and interest. Names the account it left when the person says, and is then as private as that account. Does not change the loan''s stated outstanding. Voided, never deleted (LI-I36 to LI-I38).';
comment on column public.loan_payment.account_id is
  'The account the payment left, in the loan''s own currency, when the person says. Null: not said, and the month close does not count it (LI-I38).';

create index loan_payment_household_date_idx on public.loan_payment (household_id, paid_on desc);
create index loan_payment_liability_idx on public.loan_payment (liability_id);
create index loan_payment_account_idx on public.loan_payment (account_id) where account_id is not null;

create trigger loan_payment_touch_updated_at
  before update on public.loan_payment
  for each row execute function app.touch_updated_at();

create trigger loan_payment_audit
  after insert or update or delete on public.loan_payment
  for each row execute function app.write_audit();

-- ═══════════════════════════════════════════════ 2. row-level security, deny by default

alter table public.loan_payment enable row level security;
alter table public.loan_payment force row level security;

revoke all on public.loan_payment from public, anon, authenticated;
grant select, insert, update on public.loan_payment to authenticated;

-- Readable by the household, and when it names an account, by whoever can read that account (the account's own policy is the test).
create policy loan_payment_select_follows_account
  on public.loan_payment
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (account_id is null or exists (select 1 from public.account a where a.id = loan_payment.account_id))
  );

-- Owner and partner only, as for a loan; and only an account the writer can read.
create policy loan_payment_insert
  on public.loan_payment
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and created_by = (select app.current_account_id())
    and (account_id is null or exists (select 1 from public.account a where a.id = loan_payment.account_id))
  );

create policy loan_payment_update
  on public.loan_payment
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner')
    and (account_id is null or exists (select 1 from public.account a where a.id = loan_payment.account_id))
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and (account_id is null or exists (select 1 from public.account a where a.id = loan_payment.account_id))
  );

create policy require_second_factor
  on public.loan_payment
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

comment on policy loan_payment_select_follows_account on public.loan_payment is
  'The household reads a payment that names no account; one that names an account is read by whoever can read the account.';
comment on policy loan_payment_insert on public.loan_payment is
  'Owner and partner only, like the loan itself; an account named must be one the caller can read (LI-I29).';

-- ═══════════════════════════════════════════════ 4. the audit log follows the row

-- As 20261114120000 left it, with `loan_payment` among the tables whose audit row is readable only by whoever can read the row it records (LI-I37).
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
      entity not in ('account', 'account_balance', 'account_transfer', 'credit_entry', 'income_entry', 'loan_payment')
      or case entity
           when 'account'          then exists (select 1 from public.account x          where x.id = audit_log.entity_id)
           when 'account_balance'  then exists (select 1 from public.account_balance x  where x.id = audit_log.entity_id)
           when 'account_transfer' then exists (select 1 from public.account_transfer x where x.id = audit_log.entity_id)
           when 'credit_entry'     then exists (select 1 from public.credit_entry x     where x.id = audit_log.entity_id)
           when 'income_entry'     then exists (select 1 from public.income_entry x     where x.id = audit_log.entity_id)
           when 'loan_payment'     then exists (select 1 from public.loan_payment x     where x.id = audit_log.entity_id)
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
  'Owner and partner: the household''s log, minus other members'' private rows, minus anything about a position or property they cannot read, and minus an audit row for an account, balance, transfer, credit, loan payment or tax input whose row they cannot read. Contributor: entries about their own rows only. Viewer: none.';

-- ═══════════════════════════════════════════════ 5. the close's sum of what the caller cannot read

-- The loan payments that left an account the caller cannot read, in a month, per currency: a total, and nothing that says which account, which loan,
-- whose or when. Only those whose account is hidden and has both balances at the month's two ends are counted, for those are the accounts whose
-- `left` household_private_close adds (an account missing a balance is only in its count). A payment on an account the caller reads is added by the
-- caller's own screen; one that names no account, or is voided, or is in another month, is not counted. Same guards as the close: a second factor, and
-- an owner or a partner.

create or replace function public.household_private_loans(
  target_household_id uuid,
  month_first date,
  month_last date
)
returns table (currency text, paid_to_loans_minor bigint)
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
    select l.currency, sum(l.amount_minor)::bigint
      from public.loan_payment l
      join public.account a on a.id = l.account_id
     where l.household_id = target_household_id
       and l.voided_at is null
       and l.paid_on between month_first and month_last
       and a.visibility = 'personal' and a.member_id is distinct from v_me
       and (a.status = 'active' or (a.archived_at at time zone 'Asia/Kolkata')::date >= month_first)
       and exists (select 1 from public.account_balance b where b.account_id = a.id and b.as_at = v_open)
       and exists (select 1 from public.account_balance b where b.account_id = a.id and b.as_at = month_last)
     group by l.currency;
end;
$fn$;

comment on function public.household_private_loans(uuid, date, date) is
  'The loan payments of a month that left an account the caller cannot read and that has both balances, per currency: one total each, with no account, loan, member or date. For an owner or a partner with a second factor, beside household_private_close.';

revoke all on function public.household_private_loans(uuid, date, date) from public;
grant execute on function public.household_private_loans(uuid, date, date) to authenticated;

-- ═══════════════════════════════════════════════ 6. reset_demo_household

-- Re-created from 20261114120000 with the new table cleared, in foreign-key order. The function raises at run time if a household table is left
-- uncleared, which CI does not exercise, so the table is named here.

create or replace function public.reset_demo_household(target_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kind    text;
  v_account uuid;
  v_table   text;
  v_left    boolean;
begin
  if not app.has_second_factor() then
    raise exception 'Resetting needs an authenticator code in this session, not only a password.'
      using errcode = '42501';
  end if;

  -- One message whether the household is somebody else's or does not exist,
  -- so a probe learns nothing about ids that are not the caller's.
  if app.household_role(target_household_id) is distinct from 'owner' then
    raise exception 'Only an owner can reset a demo household.' using errcode = '42501';
  end if;

  -- Locked, so two resets at once run one after the other rather than
  -- interleaving deletes and inserts into a state neither of them meant.
  select h.kind into v_kind
    from public.household h
   where h.id = target_household_id
     for update;

  if v_kind is distinct from 'demo' then
    raise exception 'This household is not marked demo, and only a demo household can be reset. Nothing was changed.'
      using errcode = '22023';
  end if;

  v_account := app.current_account_id();

  -- ── the wipe, children before parents ─────────────────────────────────
  --
  -- Every foreign key here is `on delete restrict`, deliberately, so the order
  -- is forced and a mistake in it fails loudly rather than cascading.

    -- Deposits and bonds hang off a holding by a restricting foreign key, so they go first. The earlier
  -- definition of this function predates them, which left a demo household that held a deposit or a
  -- bond unable to be reset at all: the delete of its holdings was refused and the whole reset rolled
  -- back. The rating log is append-only for everybody who can sign in; a reset is not one of them, and
  -- the audit trail of those rows stays where it is.
  -- A PPF's account and entries hang off its holding by a restricting foreign key, so they go with the deposits and
  -- bonds, before the holdings. The rate table has no household and is not touched.
  delete from public.ppf_entry           where household_id = target_household_id;
  delete from public.ppf_account         where household_id = target_household_id;
  delete from public.bond_rating_change  where household_id = target_household_id;
  delete from public.deposit_renewal     where household_id = target_household_id;
  delete from public.fixed_income_terms  where household_id = target_household_id;

  -- A property's valuations and improvements hang off it, and it can cite a loan, so all three go before
  -- the liabilities they point at. Nothing cites a property.
  delete from public.property_valuation   where household_id = target_household_id;
  delete from public.property_improvement where household_id = target_household_id;
  delete from public.property             where household_id = target_household_id;

  -- A policy can cite a holding (a ULIP's surrender value) by a restricting foreign key, so the policies
  -- go before the holdings they point at.
  delete from public.insurance_policy   where household_id = target_household_id;

  delete from public.valuation_snapshot where household_id = target_household_id;
  delete from public.lot                where household_id = target_household_id;
  delete from public.disposal           where household_id = target_household_id;
  delete from public.holding            where household_id = target_household_id;
  delete from public.instrument         where household_id = target_household_id;

  delete from public.expense_txn        where household_id = target_household_id;
  delete from public.credit_entry       where household_id = target_household_id;
  -- A loan payment cites a loan and, when it names one, an account by restricting foreign keys, so it goes before both.
  delete from public.loan_payment       where household_id = target_household_id;
  delete from public.account_transfer   where household_id = target_household_id;
  delete from public.account_balance    where household_id = target_household_id;
  -- A rule's entries cite it by a restricting foreign key, so the rules go once the entries have.
  delete from public.recurring_rule     where household_id = target_household_id;
  delete from public.account            where household_id = target_household_id;
  delete from public.income_entry       where household_id = target_household_id;
  delete from public.budget             where household_id = target_household_id;
  delete from public.expense_category   where household_id = target_household_id;

  delete from public.liability          where household_id = target_household_id;
  delete from public.fx_rate            where household_id = target_household_id;
  delete from public.gold_rate          where household_id = target_household_id;

  -- After the rows that cite it. An import is the record of a file somebody
  -- imported into this household, and a sandbox emptied of everything that
  -- file wrote has no use for the record of having written it.
  -- An upload's ledger and its references point at the batch by a restricting foreign key, so they go before it. The ledger holds
  -- the images of rows this wipe has just removed, and has no use after it.
  delete from public.import_batch_row   where household_id = target_household_id;
  delete from public.import_ref         where household_id = target_household_id;
  delete from public.import_batch       where household_id = target_household_id;

  -- Members nobody signs in as — the seed's Meera and Priya, and anyone added
  -- by hand. A member with a membership, live or revoked, is a person with a
  -- login and stays: the membership's own foreign key would refuse otherwise.
  delete from public.member m
   where m.household_id = target_household_id
     and not exists (select 1 from public.membership ms where ms.member_id = m.id);

  update public.household
     set fire_multiplier                = default,
         fire_inflation_pct             = default,
         fire_years_ahead               = default,
         fire_return_pct                = default,
         fire_step_up_pct               = default,
         fire_monthly_contribution_minor = default,
         cover_dependency_years         = default,
         property_valuation_stale_months = default
   where id = target_household_id;

  -- ── the guard against the next table ──────────────────────────────────
  --
  -- The list above is complete today. The day somebody adds a household table
  -- and forgets this function, a reset would quietly leave that table's rows
  -- behind, and "a known state" would stop being true without anything saying
  -- so. So: every table in public carrying a household_id, other than the ones
  -- kept on purpose, must now be empty for this household — or the whole
  -- reset is rolled back and names the table it does not know about.
  --
  -- It has now done that once, for `import_batch`, which is this migration.
  for v_table in
    select c.relname
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c     on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and a.attname = 'household_id'
       and not a.attisdropped
       and c.relname not in ('member', 'membership', 'invite', 'audit_log')
  loop
    execute format('select exists (select 1 from public.%I where household_id = $1)', v_table)
       into v_left
      using target_household_id;

    if v_left then
      raise exception 'Reset does not know how to clear %. Add it to public.reset_demo_household. Nothing was changed.', v_table;
    end if;
  end loop;

  -- ── and the seed again ────────────────────────────────────────────────
  perform app.seed_demo_household(target_household_id, v_account);
end;
$fn$;

comment on function public.reset_demo_household(uuid) is
  'Owner only, second factor required, demo households only. Hard-deletes the household''s data — imports included, never its members with logins, memberships, invites or audit history — and reseeds it.';

revoke all on function public.reset_demo_household(uuid) from public;
grant execute on function public.reset_demo_household(uuid) to authenticated;
