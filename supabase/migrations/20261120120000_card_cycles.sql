-- Family Finance Buddy — a card's cycle: at month end (as today) or on its statement date (docs/design/card-cycles.md).
--
-- FOR REVIEW. Not applied. Shown before any screen is built on it (CLAUDE.md). Slice 1 of card-cycles.md section 10; the owner's decisions of 20 November 2026 are in
-- docs/decisions.md. A household with no card on its statement date sees no difference anywhere (CY-I1): every column below has a default that is today's behaviour.
--
-- What it adds:
--   account.cycle_ends                      'month_end' (default) or 'statement'; only a card may be 'statement' (CY-I8).
--   account_balance.emi_converted_minor,
--   account_balance.emi_principal_minor     a card cycle's EMI figures (section 4a), zero where there is none.
--   liability.card_account_id               a card's EMI plans as one debt per card, linked to the card (CY-I17).
--   loan_payment guard                      a payment is never typed against a card's debt: its instalments come from the card's statements (CY-I17).
--   close_without_card                      an owner or a partner closed a month without a statement-date card's statement (CY-I14).
--   reset_demo_household                    re-created with the new table cleared, and the liabilities cleared before the accounts they now cite.
--
-- What it does not change: row-level security on account, account_balance and liability (whoever may write them may write the new columns), their audit triggers, and
-- household_private_close, which counts by calendar month and is replaced by window in slice 3, in a migration of its own.
--
-- Decisions made here, for the reviewer to confirm or change:
--   1. liability's link to the card is the three-column key (household, account, currency), as the loan payment's is, so a card's debt is in the card's currency. The design
--      showed two columns; this is stricter and costs nothing, since account already has that unique key.
--   2. The guard on loan_payment also fires when an existing payment is moved to a card debt (update of liability_id), not only on insert.
--   3. close_without_card is readable by an owner and a partner only, as it is written only by them; a contributor learns that a card is waiting from the close, not from this
--      table. The design's comment said "every member who can read the close" and its policy said owner and partner; the policy is kept.
--   4. close_without_card's card-and-month check runs on insert only. A void is an update, and must still be possible after the card has been switched back to month end.
--   5. emi_* are not checked against the account's type: a check cannot read another table, and a bank account's row carries 0 because nothing writes otherwise. The domain
--      reads them for a card only.
--   6. close_without_card_check is security definer, so that it reads the card whoever is writing: a viewer or another household's owner is then refused by the policy
--      (who may), and not by a message about a card they cannot read (what may be). It reads one account's type and cycle and returns nothing to the caller.
--   7. The export: account and account_balance are in NOT_EXPORTED with their reasons, so the two new columns reach no sheet today. close_without_card is added to
--      NOT_EXPORTED in the same change (src/domain/export/entities.ts), since a test holds the tables to that list.

-- ═══════════════════════════════════════════════ 1. account: when a card's month closes

alter table public.account
  add column cycle_ends text not null default 'month_end'
    check (cycle_ends in ('month_end', 'statement'));

alter table public.account
  add constraint account_cycle_only_for_a_card
    check (cycle_ends = 'month_end' or type = 'card');

comment on column public.account.cycle_ends is
  'When a card''s month closes: at month end (default) or on its statement date (card-cycles.md). Always month_end for a bank account. A switch applies to every month, either way; protecting closed months is deferred (card-cycles.md 6.1).';

-- ═══════════════════════════════════════════════ 2. account_balance: a card cycle's EMI figures (section 4a)

alter table public.account_balance
  add column emi_converted_minor bigint not null default 0 check (emi_converted_minor >= 0),
  add column emi_principal_minor bigint not null default 0 check (emi_principal_minor >= 0);

comment on column public.account_balance.emi_converted_minor is
  'For a card due: what was converted to EMI plans in the cycle ending on this date. Counted as spent in that cycle (card-cycles.md 4a).';
comment on column public.account_balance.emi_principal_minor is
  'For a card due: the principal of the EMI instalments billed in the cycle. Paid to loans, not spent; their interest and GST are spent (card-cycles.md 4a).';

-- ═══════════════════════════════════════════════ 3. liability: a card's EMI plans as a debt (section 4a)

alter table public.liability
  add column card_account_id uuid;

alter table public.liability
  add constraint liability_card_account_in_household_fkey
    foreign key (household_id, card_account_id, currency)
    references public.account (household_id, id, currency) on delete restrict,
  add constraint liability_card_account_only_for_credit_card
    check (card_account_id is null or kind = 'credit_card');

create unique index liability_one_emi_debt_per_card
  on public.liability (card_account_id) where card_account_id is not null;

comment on column public.liability.card_account_id is
  'The card whose EMI plans this debt is. One debt per card; its outstanding follows the card''s statements and its instalments are counted from them (card-cycles.md 4a, CY-I17).';

-- CY-I17: a card debt's instalments are counted from the card's statements, never as loan payments too.
create or replace function app.loan_payment_not_on_a_card_debt()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if exists (select 1 from public.liability l where l.id = new.liability_id and l.card_account_id is not null) then
    raise exception 'This debt''s instalments come from its card''s statements, so a payment is not typed against it.'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

create trigger loan_payment_not_on_a_card_debt
  before insert or update of liability_id on public.loan_payment
  for each row execute function app.loan_payment_not_on_a_card_debt();

-- ═══════════════════════════════════════════════ 4. close_without_card (the owner's control to close, section 2.4)

-- An owner or a partner closed a month without a statement-date card's statement. The card adds nothing to that month until its statement arrives, when the month corrects
-- itself and this row is simply no longer needed. Never deleted: undone by voiding, as a figure relied upon is.

create table public.close_without_card (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,
  account_id    uuid        not null,
  month         date        not null check (extract(day from month) = 1),
  voided_at     timestamptz,
  voided_by     uuid        references public.user_account (id) on delete restrict,
  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint close_without_card_void_pair check ((voided_at is null) = (voided_by is null)),
  constraint close_without_card_account_in_household_fkey
    foreign key (household_id, account_id) references public.account (household_id, id) on delete restrict
);

comment on table public.close_without_card is
  'A month an owner or a partner closed without a statement-date card''s statement (card-cycles.md 2.4). The card adds nothing to that month until its statement is imported. Voided, never deleted.';

create unique index close_without_card_one_live
  on public.close_without_card (account_id, month) where voided_at is null;

create trigger close_without_card_touch_updated_at
  before update on public.close_without_card
  for each row execute function app.touch_updated_at();

create trigger close_without_card_audit
  after insert or update or delete on public.close_without_card
  for each row execute function app.write_audit();

-- Only a card that closes on its statement date, and only a month that has ended (IST), when it is made; and once made, only voided.
create or replace function app.close_without_card_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.account a where a.id = new.account_id and a.type = 'card' and a.cycle_ends = 'statement') then
      raise exception 'Only a card whose bill closes on its statement date can be left out of a close.' using errcode = '23514';
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

create trigger close_without_card_check
  before insert or update on public.close_without_card
  for each row execute function app.close_without_card_check();

alter table public.close_without_card enable row level security;
alter table public.close_without_card force row level security;

revoke all on public.close_without_card from public, anon, authenticated;
grant select, insert, update on public.close_without_card to authenticated;   -- no delete

-- Written only by an owner or a partner, as only they close a month (spending-capture.md section 9, decision 5), and read by them.
create policy close_without_card_select
  on public.close_without_card
  for select
  to authenticated
  using (household_id in (select app.household_ids()) and app.household_role(household_id) in ('owner', 'partner'));

create policy close_without_card_insert
  on public.close_without_card
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and created_by = (select app.current_account_id())
  );

create policy close_without_card_void
  on public.close_without_card
  for update
  to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'))
  with check (app.household_role(household_id) in ('owner', 'partner'));

create policy require_second_factor
  on public.close_without_card
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ═══════════════════════════════════════════════ 5. reset_demo_household

-- Re-created from 20261119120000 with the new table cleared, and with the liabilities cleared before the accounts: a card's debt now cites its card by a restricting foreign
-- key, so the old order (accounts, then liabilities) would be refused.

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

  -- A witness cites the entry it saw by a restricting foreign key, so the witnesses go before the entries.
  delete from public.expense_witness    where household_id = target_household_id;
  delete from public.expense_txn        where household_id = target_household_id;
  delete from public.credit_entry       where household_id = target_household_id;
  -- A loan payment cites a loan and, when it names one, an account by restricting foreign keys, so it goes before both.
  delete from public.loan_payment       where household_id = target_household_id;
  delete from public.spend_statement    where household_id = target_household_id;
  delete from public.account_transfer   where household_id = target_household_id;
  delete from public.account_balance    where household_id = target_household_id;
  -- A month closed without a card cites the card, and a card's EMI debt cites it too, so both go before the accounts.
  delete from public.close_without_card where household_id = target_household_id;
  delete from public.liability          where household_id = target_household_id;
  -- A rule's entries cite it by a restricting foreign key, so the rules go once the entries have.
  delete from public.recurring_rule     where household_id = target_household_id;
  -- A batch of statements cites the account it was of by a restricting foreign key, and the batches go last, so the reference is cleared before the accounts go.
  update public.import_batch            set account_id = null where household_id = target_household_id and account_id is not null;
  delete from public.account            where household_id = target_household_id;
  delete from public.income_entry       where household_id = target_household_id;
  delete from public.budget             where household_id = target_household_id;
  delete from public.expense_category   where household_id = target_household_id;

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
  -- It has now done that for `import_batch` and `close_without_card`.
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
