-- Family Finance Buddy — statement import: what an imported line is, and how a payment is recognised again
-- (docs/design/spending-capture.md sections 3, 4 and 7; docs/build-plan.md step 7 and 7a; SC-I5, SC-I6, SC-I8).
--
-- FOR REVIEW. Not applied to the live database. CI's policy suite applies it to a fresh database and runs supabase/tests/statement_import.test.sql against it; Docker
-- is blocked on the maintainer's machine, so CI is the only place it runs. This file is the schema and its access rules and nothing else: no screen, no repository code and no
-- matching. The parsers are pure functions that are already merged (src/domain/statement/), and the matcher that decides what a line is will be pure too.
--
-- The design in one paragraph. A payment is **one entry with up to three witnesses** (section 4): the same Rs 642 can arrive on a bank statement, a Google Pay statement and a
-- card statement, and it is one expense. Whichever statement is read first makes the entry; each later one adds a witness and fills what is empty, and never overwrites a field a
-- person typed. Matching, strongest first: the UPI reference (an exact match merges), then a line hash per source (which recognises a re-imported statement), then a near match
-- that waits for a person. The matching is the app's; what the database owns is that the same reference and the same line are never two rows.
--
-- What is decided (spending-capture.md section 9, and the owner on 19 November 2026):
--   * the UPI reference is stored as its last four digits and a sha256 of it, computed on the device (13 November); a payee's VPA is never stored (section 4);
--   * Excel is skipped (13 November), so no `paytm_xlsx` kind; `paytm_pdf` and `phonepe_pdf` are named here for the PDFs of step 7a that follow;
--   * an imported card purchase is an expense; a card repayment is not (it settles purchases already recorded), and the EMI principal a card re-bills is not either,
--     while its interest and GST are. Those are the matcher's rules, and nothing here encodes them;
--   * the importer adds the accounts a statement names that the household has not. That uses the policies `account` already has (an owner or a partner), and needs nothing here.
--
-- What changes:
--
--   import_batch.kind         names the formats that are parsed now: `hdfc_delimited`, `hdfc_text`, `qif`, `icici_savings_pdf`, `icici_card_pdf`, `axis_card_pdf`, `gpay_pdf`,
--                             and `paytm_pdf`, `phonepe_pdf` for what follows. `bank_csv`, `card_csv` and the rest stay: nothing is renamed.
--   import_batch.account_id   the account a statement is of, when it is of one (a Google Pay statement is of none).
--   expense_txn gains         `account_id` (the account or card it was paid from, in its own currency), `upi_ref_last4` and `upi_ref_hash` (a pair), and `source_batch_id` and
--                             `source_hash` (a pair, as on `credit_entry`: which batch made the entry, and the hash of the line that did). `captured_via` already allows
--                             `import`, and now says which batch: the two go together. Where an entry came from is not changed once it is set.
--   expense_witness           one row for each statement line that made an entry or was merged into one: the entry, the batch, the line's hash. Append-only.
--
-- Two unique indexes are the database's half of SC-I5, one payment one entry:
--   * one live entry for a UPI reference in a household (a voided entry does not count, so a payment voided by mistake can be imported again);
--   * one witness for a line hash in a household, so the second statement to witness a payment is recognised on re-import too, as `lot.source_hash` does for eCAS.
-- A conflict reports that a payment or a line is already recorded; it can reveal that one member's private entry holds that reference to another member who holds the same
-- statement, which `lot.source_hash` and `credit_entry.source_hash` already do in the same way. Said here so it is a choice and not a surprise.
--
-- Who may. An entry is made, and a witness added to one, by whoever may write the entry itself: an owner and a partner for the household, a contributor for their own member. A viewer
-- writes nothing. A witness is read by whoever can read the entry it witnesses, and so is its audit row. There is no update or delete grant on a witness.
--
-- Every new table has its audit trigger, row-level security enabled and forced, explicit grants, the second-factor restrictive policy, a line in `reset_demo_household`, and an
-- entry in the export list (TypeScript, in the same change as this file). Must be applied after 20261117130000_spend_statement.sql, whose reset function this replaces.

-- ═══════════════════════════════════════════════ 1. a batch: the formats, and the account

-- Whatever check on `kind` the table has, however it was named, is replaced by one that names every format. The old kinds stay.
do $do$
declare
  c text;
begin
  for c in
    select conname
      from pg_catalog.pg_constraint
     where conrelid = 'public.import_batch'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.import_batch drop constraint %I', c);
  end loop;
end
$do$;

alter table public.import_batch
  add constraint import_batch_kind_check
  check (kind in ('ecas_cams', 'ecas_kfintech', 'depository_cas', 'bank_csv', 'card_csv', 'broker_csv', 'template',
                  'hdfc_delimited', 'hdfc_text', 'qif', 'icici_savings_pdf', 'icici_card_pdf', 'axis_card_pdf', 'gpay_pdf',
                  'paytm_pdf', 'phonepe_pdf'));

-- The account a statement is of. Null for one that is of none (a UPI app's statement says which account each payment came from, line by line).
alter table public.import_batch
  add column account_id uuid,
  add constraint import_batch_account_in_household_fkey
    foreign key (household_id, account_id)
    references public.account (household_id, id) on delete restrict;

comment on column public.import_batch.account_id is
  'The account the statement is of, by the last four it printed, when it is of one. Null for a UPI app''s statement, which is of none.';

-- ═══════════════════════════════════════════════ 2. an entry knows where it came from

alter table public.expense_txn
  add column account_id      uuid,
  add column upi_ref_last4   text check (upi_ref_last4 is null or upi_ref_last4 ~ '^[0-9]{4}$'),
  add column upi_ref_hash    text check (upi_ref_hash is null or upi_ref_hash ~ '^[0-9a-f]{64}$'),
  add column source_batch_id uuid,
  add column source_hash     text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),

  -- The last four and the hash of a reference are one fact (SC-I8): never a hash with nothing to show, nor a last four with no way to match.
  add constraint expense_txn_ref_pair
    check ((upi_ref_last4 is null) = (upi_ref_hash is null)),
  -- A batch and the line that made the entry are one fact, and an imported entry names both.
  add constraint expense_txn_import_pair
    check ((source_batch_id is null) = (source_hash is null)),
  add constraint expense_txn_import_is_captured_by_import
    check ((captured_via = 'import') = (source_batch_id is not null)),

  -- The account it was paid from is the household's, and in the entry's own currency: a rupee entry is not offered a dollar account.
  add constraint expense_txn_account_in_household_fkey
    foreign key (household_id, account_id, currency)
    references public.account (household_id, id, currency) on delete restrict,
  add constraint expense_txn_batch_in_household_fkey
    foreign key (household_id, source_batch_id)
    references public.import_batch (household_id, id) on delete restrict;

comment on column public.expense_txn.account_id is
  'The account or card the entry was paid from, in its own currency, when known. Null: not said.';
comment on column public.expense_txn.upi_ref_last4 is
  'The last four digits of the 12-digit UPI reference, to show. With upi_ref_hash, a pair (SC-I8). The reference itself and the payee''s VPA are never stored.';
comment on column public.expense_txn.upi_ref_hash is
  'sha256 of the UPI reference, computed on the device. It is how a bank line, a UPI app''s line and an alert are known to be one payment. Not a secret: it keeps the number out of plain view, which is all the last-four rule asks.';
comment on column public.expense_txn.source_batch_id is
  'The batch of the statement whose line made this entry. Null for an entry that was typed, shared or posted by a rule.';
comment on column public.expense_txn.source_hash is
  'The hash of the line that made the entry (date, amount and the raw description, per source), computed on the device. Recognises a re-imported statement.';

-- One payment, one live entry (SC-I5). A voided entry does not hold its reference, so a payment voided by mistake can be imported again.
create unique index expense_txn_upi_ref_key
  on public.expense_txn (household_id, upi_ref_hash)
  where upi_ref_hash is not null and voided_at is null;

-- A statement re-imported makes no second entry, as lot.source_hash and credit_entry.source_hash do. A voided entry keeps its line, so voiding an entry does not
-- let the same line make it again behind the person's back.
create unique index expense_txn_source_hash_key
  on public.expense_txn (household_id, source_hash)
  where source_hash is not null;

create index expense_txn_account_idx on public.expense_txn (account_id) where account_id is not null;
create index expense_txn_batch_idx   on public.expense_txn (source_batch_id) where source_batch_id is not null;

-- A composite key for the witness to cite, so the member on a witness cannot differ from the entry's.
alter table public.expense_txn
  add constraint expense_txn_id_household_member_key unique (id, household_id, member_id);

-- Where an entry came from is not changed once it is set. What was empty can be filled (a typed entry matched to a statement line takes its reference), and nothing set can be moved.
create or replace function app.expense_txn_keep_provenance()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if (old.source_batch_id is not null and new.source_batch_id is distinct from old.source_batch_id)
     or (old.source_hash is not null and new.source_hash is distinct from old.source_hash)
     or (old.upi_ref_hash is not null and (new.upi_ref_hash is distinct from old.upi_ref_hash or new.upi_ref_last4 is distinct from old.upi_ref_last4))
     or (old.captured_via = 'import' and new.captured_via is distinct from old.captured_via)
  then
    raise exception 'Where an imported entry came from is not changed.' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

comment on function app.expense_txn_keep_provenance() is
  'An imported entry''s batch, line and reference are fixed once set. What was empty may be filled.';

create trigger expense_txn_keep_provenance
  before update on public.expense_txn
  for each row execute function app.expense_txn_keep_provenance();

-- ═══════════════════════════════════════════════ 3. a witness

create table public.expense_witness (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,
  expense_id    uuid        not null,
  -- Copied from the entry and held to it by the composite key below, so a witness is as visible as the entry it saw.
  member_id     uuid        not null,

  batch_id      uuid        not null,
  -- The hash of the statement line, computed on the device. Unique in a household: the second statement to witness a payment is recognised on re-import too.
  line_hash     text        not null check (line_hash ~ '^[0-9a-f]{64}$'),

  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),

  constraint expense_witness_entry_fkey
    foreign key (expense_id, household_id, member_id)
    references public.expense_txn (id, household_id, member_id) on delete restrict,
  constraint expense_witness_batch_in_household_fkey
    foreign key (household_id, batch_id)
    references public.import_batch (household_id, id) on delete restrict
);

comment on table public.expense_witness is
  'One statement line that made an entry or was merged into one (spending-capture.md section 4). A payment is one entry with up to three witnesses. Append-only: written, never changed, never deleted.';
comment on column public.expense_witness.line_hash is
  'sha256 of the line (date, amount, raw description, per source), computed on the device. Never the line itself.';

create unique index expense_witness_line_key on public.expense_witness (household_id, line_hash);
create index expense_witness_expense_idx on public.expense_witness (expense_id);
create index expense_witness_batch_idx   on public.expense_witness (batch_id);

create trigger expense_witness_audit
  after insert or update or delete on public.expense_witness
  for each row execute function app.write_audit();

alter table public.expense_witness enable row level security;
alter table public.expense_witness force row level security;

revoke all on public.expense_witness from public, anon, authenticated;
-- No update and no delete: a witness is a fact about a line, and a line cannot un-see a payment.
grant select, insert on public.expense_witness to authenticated;

-- Read by whoever can read the entry it witnesses: the entry's own policy is the test, so a private entry's witnesses are private with it.
create policy expense_witness_select
  on public.expense_witness
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.expense_txn e where e.id = expense_witness.expense_id)
  );

-- Added by whoever may write the entry: an owner or a partner, or a contributor for an entry that is their own; and only to an entry the caller can read.
create policy expense_witness_insert
  on public.expense_witness
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.expense_txn e where e.id = expense_witness.expense_id)
  );

create policy require_second_factor
  on public.expense_witness
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

comment on policy expense_witness_select on public.expense_witness is
  'A witness is read by whoever can read the entry it witnesses. A viewer reads none, and another household reads none.';
comment on policy expense_witness_insert on public.expense_witness is
  'An owner or a partner witness any entry they can read; a contributor only their own. A viewer writes nothing.';

-- ═══════════════════════════════════════════════ 4. the audit log follows the row

-- As 20261117120000 left it, with the witness among the rows whose audit row is read only by whoever can read the row it records: an audit row carries the line's hash and the entry's
-- id, and an entry may be private.

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
      entity not in ('account', 'account_balance', 'account_transfer', 'credit_entry', 'income_entry', 'expense_witness')
      or case entity
           when 'account'          then exists (select 1 from public.account x          where x.id = audit_log.entity_id)
           when 'account_balance'  then exists (select 1 from public.account_balance x  where x.id = audit_log.entity_id)
           when 'account_transfer' then exists (select 1 from public.account_transfer x where x.id = audit_log.entity_id)
           when 'credit_entry'     then exists (select 1 from public.credit_entry x     where x.id = audit_log.entity_id)
           when 'income_entry'     then exists (select 1 from public.income_entry x     where x.id = audit_log.entity_id)
           when 'expense_witness'  then exists (select 1 from public.expense_witness x  where x.id = audit_log.entity_id)
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
  'Owner and partner: the household''s log, minus other members'' private rows, minus anything about a position or property they cannot read, and minus an audit row for an account, balance, transfer, credit, tax input or statement witness whose row they cannot read. Contributor: entries about their own rows only. Viewer: none.';

-- ═══════════════════════════════════════════════ 5. reset_demo_household

-- Re-created from 20261117130000 with the new table cleared, before the entries it cites. The function raises at run time if a household table is left uncleared, which
-- CI exercises only where a seeded household holds a row of it, so the table is named here.

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
  -- A rule's entries cite it by a restricting foreign key, so the rules go once the entries have.
  delete from public.recurring_rule     where household_id = target_household_id;
  -- A batch of statements cites the account it was of by a restricting foreign key, and the batches go last, so the reference is cleared before the accounts go.
  update public.import_batch            set account_id = null where household_id = target_household_id and account_id is not null;
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
