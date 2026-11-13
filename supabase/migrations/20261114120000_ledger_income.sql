-- Family Finance Buddy — step 6a: accounts, money in, moves between accounts, and the Tax screen's typed income.
--
-- FOR REVIEW. Not applied anywhere. The design is `docs/design/ledger-income.md` (section 12 lists the tables and what each one owes), and
-- `docs/design/spending-capture.md` section 7 for the account registry. This file is the schema and its access rules and nothing else:
-- no screen, no repository code and no calculation. Money in, spent and saved are derived in pure domain functions from what these
-- tables hold (ledger-income.md sections 4 and 7), and nothing here stores them.
--
-- ── what is here ────────────────────────────────────────────────────────────
--
--   account            the household's accounts: a savings or current account, or a card. Cash is not an account (spending-capture.md 2).
--   account_balance    a balance as at a date, typed or from a statement; the month close reads these (step 6d).
--   credit_entry       one thing that came in, with exactly one category (ledger-income.md 1).
--   account_transfer   a move between two of the household's own accounts, a card payment among them: neither income nor spent.
--   income_entry       the Tax screen's typed gross figures, per member and tax year (ledger-income.md 8), made exact from the blueprint.
--   recurring_rule     gains a direction, a credit category and an account, so a salary rule can exist (ledger-income.md 5).
--   household_money_totals   the one sum function: came in and refunds per currency, to an owner or a partner, never a row.
--   audit_log policy   an audit row for any of these is readable only by whoever can read the row it records (LI-I22, CLAUDE.md).
--   reset_demo_household   re-created from the latest version, clearing the new tables, in the same migration as the tables.
--
-- ── every table below, in this migration, has what CLAUDE.md asks of it ───────
--
--   an audit trigger; row-level security enabled and forced; explicit grants (select, insert and update, never delete); the
--   second-factor restrictive policy; household-scoped composite foreign keys; and a line in reset_demo_household. The pgTAP file
--   beside this one proves each policy denies. The export list and the repository layer are TypeScript and arrive with the first
--   screen that reads these tables, as the rules require, and are not in this file.
--
-- ── decisions made here, for the reviewer to confirm or change ───────────────
--
--   1. `household_yearly_income()`, which ledger-income.md section 12 lists, is NOT here. The Household FIRE figure needs each earner's
--      usual salary (the amount that occurs most often in their last six months), which is arithmetic, and CLAUDE.md puts every
--      calculation in a pure domain function. A sum function cannot return that figure without doing the arithmetic in the database,
--      and one that returned each earner's months to hand to the domain would disclose more than a household total (the owner chose a
--      total). Which of the two, or another way, is the owner's call; the Household FIRE read waits for it.
--   2. A personal credit can be made only by the member it belongs to, as an expense update already can. Otherwise an owner typing a
--      parent's income (a member with no login) as personal would write a row nobody could ever read again. The owner types such
--      income as household; the member's own private income is their own to enter.
--   3. A transfer is readable only by someone who can read both of its accounts, so a move into or out of a personal account is not
--      shown to the rest of the household. Both legs must be in one currency; a move between currencies is not modelled yet.
--   4. A balance is as private as the account it is a balance of, and so is the audit row that records it.
--   5. Reads are not audited here, for the same reason they are not audited anywhere yet (build-plan step 11). The trigger records
--      writes, as every other table's does.
--   6. No demo seed rows for the ledger yet: reset_demo_household clears the new tables and the seed is unchanged.

-- ══════════════════════════════════════════════════════════════════ account

create table public.account (
  id               uuid        primary key default gen_random_uuid(),
  household_id     uuid        not null references public.household (id) on delete restrict,
  member_id        uuid        not null,

  -- What the person calls it ("HDFC savings"), and the institution as the bank names itself, both optional beyond the name.
  name             text        not null check (length(btrim(name)) between 1 and 80),
  institution      text        check (institution is null or length(btrim(institution)) between 1 and 80),

  -- spending-capture.md section 7: a savings or current account, or a card. Cash is not one of them.
  type             text        not null check (type in ('savings', 'current', 'card')),
  currency         text        not null check (currency ~ '^[A-Z]{3}$'),

  -- The last four characters, and nothing more: no account number is ever stored (CLAUDE.md).
  account_last4    text        check (account_last4 is null or account_last4 ~ '^[0-9A-Za-z]{4}$'),

  -- Whether it is a foreign account for Schedule FA. A decision, never inferred from the currency.
  is_foreign       boolean     not null default false,
  opened_on        date,

  -- A joint account belongs to the household. A member's own account can be personal, as a holding can: its rows and its balances
  -- stay hidden from everyone else, and the month close will take its figure as a sum (step 6d).
  visibility       text        not null default 'household' check (visibility in ('household', 'personal')),

  -- Archived, never deleted: an account's history is the household's arithmetic.
  status           text        not null default 'active' check (status in ('active', 'archived')),
  archived_at      timestamptz,

  created_by       uuid        not null default app.current_account_id()
                               references public.user_account (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint account_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null)),

  -- Both keys are what every table that refers to an account cites: the first so an account and what refers to it share a household,
  -- the second so a balance, a credit and a transfer are in the account's own currency, which the database then guarantees.
  constraint account_household_id_id_key unique (household_id, id),
  constraint account_household_id_id_currency_key unique (household_id, id, currency),

  constraint account_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict
);

comment on table public.account is
  'A savings or current account, or a card, of the household. Archived, never deleted. Carries the last four characters and no number.';
comment on column public.account.visibility is
  'household for a joint account or one the household shares; personal for a member''s own, whose rows and balances nobody else reads.';

create index account_household_idx on public.account (household_id, status);
create index account_member_idx on public.account (member_id);

create trigger account_touch_updated_at
  before update on public.account
  for each row execute function app.touch_updated_at();

create trigger account_audit
  after insert or update or delete on public.account
  for each row execute function app.write_audit();

alter table public.account enable row level security;
alter table public.account force row level security;

revoke all on public.account from public, anon, authenticated;
grant select, insert, update on public.account to authenticated;

-- Owner and partner read the household's accounts and their own personal ones; a contributor reads their own; a viewer reads none.
create policy account_select_by_role
  on public.account
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
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
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
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
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  );

comment on policy account_select_by_role on public.account is
  'Owner and partner: the shared accounts and their own personal ones. Contributor: their own. Viewer: none.';
comment on policy account_insert on public.account is
  'A viewer writes nothing. A contributor writes only under their own name. Only the member an account belongs to can make it personal.';

create policy require_second_factor
  on public.account
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ═════════════════════════════════════════════════════════ account_balance

create table public.account_balance (
  id               uuid        primary key default gen_random_uuid(),
  household_id     uuid        not null references public.household (id) on delete restrict,
  account_id       uuid        not null,

  -- The day the balance was true. A date in IST.
  as_at            date        not null,

  -- For a card, the amount due, positive. A bank account may be overdrawn, so this is any bigint.
  balance_minor    bigint      not null,

  -- In the account's own currency, which the composite key below makes the database enforce.
  currency         text        not null check (currency ~ '^[A-Z]{3}$'),

  -- Typed by a person, or stated by a statement. A statement's closing balance supersedes a typed one for the same account and date
  -- (spending-capture.md section 2), as holding.stated_quantity does: the two are separate rows and the reader prefers the statement.
  source           text        not null default 'typed' check (source in ('typed', 'statement')),
  source_batch_id  uuid,

  note             text        check (note is null or length(note) <= 500),
  created_by       uuid        not null default app.current_account_id()
                               references public.user_account (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint account_balance_batch_only_for_a_statement
    check ((source = 'statement') or (source_batch_id is null)),

  constraint account_balance_account_in_household_fkey
    foreign key (household_id, account_id, currency)
    references public.account (household_id, id, currency) on delete restrict,

  constraint account_balance_batch_in_household_fkey
    foreign key (household_id, source_batch_id)
    references public.import_batch (household_id, id) on delete restrict
);

comment on table public.account_balance is
  'A balance of an account as at a date. As private as the account. The month close derives spent from these and stores nothing of the result.';

-- One balance per account, day and source.
create unique index account_balance_one_per_day_and_source
  on public.account_balance (account_id, as_at, source);
create index account_balance_household_idx on public.account_balance (household_id, as_at desc);

create trigger account_balance_touch_updated_at
  before update on public.account_balance
  for each row execute function app.touch_updated_at();

create trigger account_balance_audit
  after insert or update or delete on public.account_balance
  for each row execute function app.write_audit();

alter table public.account_balance enable row level security;
alter table public.account_balance force row level security;

revoke all on public.account_balance from public, anon, authenticated;
grant select, insert, update on public.account_balance to authenticated;

-- A balance follows its account: it is read by whoever can read the account, because the subquery runs as the caller.
create policy account_balance_select_follows_account
  on public.account_balance
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.account a where a.id = account_balance.account_id)
  );

create policy account_balance_insert
  on public.account_balance
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.account a where a.id = account_balance.account_id)
  );

create policy account_balance_update
  on public.account_balance
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.account a where a.id = account_balance.account_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.account a where a.id = account_balance.account_id)
  );

create policy require_second_factor
  on public.account_balance
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ══════════════════════════════════════════════════════════ credit_entry

create table public.credit_entry (
  id               uuid        primary key default gen_random_uuid(),
  household_id     uuid        not null references public.household (id) on delete restrict,

  -- Whose income it is. The default in the app is the account's member; on a joint account the person chooses.
  member_id        uuid        not null,

  -- Required: there is no credit without an account (LI-I4). The composite key below also makes its currency the account's.
  account_id       uuid        not null,

  -- Exactly one category (LI-I1). 'refund' is Refund or money back: it takes away from spent and is never income.
  category         text        not null
                               check (category in ('salary', 'business', 'interest', 'rent', 'dividend', 'other_income', 'refund')),

  amount_minor     bigint      not null check (amount_minor > 0),
  currency         text        not null check (currency ~ '^[A-Z]{3}$'),

  -- The calendar date in IST on which the bank credited it. A date, so no device timezone can move it.
  credit_date      date        not null,

  -- Private unless the household is told otherwise. The column's own default is the safe one; the app chooses household for a refund.
  visibility       text        not null default 'personal' check (visibility in ('household', 'personal')),

  -- How it arrived. A 'rule' credit was confirmed from an expected one and says which rule and which due date it answers; an 'import'
  -- credit says which batch and which line.
  source           text        not null default 'typed' check (source in ('typed', 'rule', 'import')),
  recurring_rule_id uuid,
  due_date         date,
  source_batch_id  uuid,
  source_hash      text        check (source_hash is null or length(source_hash) between 8 and 128),

  payer            text        check (payer is null or length(btrim(payer)) between 1 and 120),
  note             text        check (note is null or length(note) <= 500),

  -- Voided, never deleted, as expense_txn is.
  voided_at        timestamptz,
  voided_by        uuid        references public.user_account (id) on delete restrict,

  created_by       uuid        not null default app.current_account_id()
                               references public.user_account (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint credit_entry_voided_pair
    check ((voided_at is null) = (voided_by is null)),
  constraint credit_entry_rule_pair
    check ((source = 'rule') = (recurring_rule_id is not null) and (recurring_rule_id is null) = (due_date is null)),
  constraint credit_entry_import_pair
    check ((source = 'import') = (source_batch_id is not null) and (source_batch_id is null) = (source_hash is null)),

  constraint credit_entry_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict,
  constraint credit_entry_account_in_household_fkey
    foreign key (household_id, account_id, currency)
    references public.account (household_id, id, currency) on delete restrict,
  constraint credit_entry_rule_in_household_fkey
    foreign key (household_id, recurring_rule_id)
    references public.recurring_rule (household_id, id) on delete restrict,
  constraint credit_entry_batch_in_household_fkey
    foreign key (household_id, source_batch_id)
    references public.import_batch (household_id, id) on delete restrict
);

comment on table public.credit_entry is
  'One thing that came in, with exactly one category. A credit is voided, never deleted. Private by default. Came in is derived from these and never stored.';
comment on column public.credit_entry.category is
  'salary, business (Business income), interest, rent, dividend, other_income, or refund (Refund or money back). Came in is the sum of all but refund (LI-I1).';
comment on column public.credit_entry.credit_date is
  'The calendar date in Asia/Kolkata on which the bank credited it.';

-- A rule posts at most one credit per due date (LI-I8), and a voided credit still holds its date.
create unique index credit_entry_one_per_due
  on public.credit_entry (recurring_rule_id, due_date)
  where recurring_rule_id is not null;

-- An imported line is recognised on re-import, as lot.source_hash is.
create unique index credit_entry_source_hash_key
  on public.credit_entry (household_id, source_hash)
  where source_hash is not null;

create index credit_entry_household_date_idx on public.credit_entry (household_id, credit_date desc, created_at desc);
create index credit_entry_member_idx on public.credit_entry (member_id);
create index credit_entry_account_idx on public.credit_entry (account_id);

create trigger credit_entry_touch_updated_at
  before update on public.credit_entry
  for each row execute function app.touch_updated_at();

create trigger credit_entry_audit
  after insert or update or delete on public.credit_entry
  for each row execute function app.write_audit();

alter table public.credit_entry enable row level security;
alter table public.credit_entry force row level security;

revoke all on public.credit_entry from public, anon, authenticated;
grant select, insert, update on public.credit_entry to authenticated;

-- Owner and partner: the shared credits and their own personal ones. Contributor: their own. Viewer: none (LI-I12).
create policy credit_entry_select_by_role
  on public.credit_entry
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

-- A viewer writes nothing; a contributor writes only under their own name; attribution cannot be forged; only the member a credit
-- belongs to can make it personal (decision 2 above); and the account must be one the caller can read.
create policy credit_entry_insert
  on public.credit_entry
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and created_by = (select app.current_account_id())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and exists (select 1 from public.account a where a.id = credit_entry.account_id)
  );

create policy credit_entry_update
  on public.credit_entry
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
    and exists (select 1 from public.account a where a.id = credit_entry.account_id)
  );

comment on policy credit_entry_select_by_role on public.credit_entry is
  'Owner and partner: the shared credits and their own personal ones. Contributor: their own, shared or personal. Viewer: none. A household total of private income comes only from household_money_totals.';

create policy require_second_factor
  on public.credit_entry
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ═════════════════════════════════════════════════════ account_transfer

create table public.account_transfer (
  id               uuid        primary key default gen_random_uuid(),
  household_id     uuid        not null references public.household (id) on delete restrict,
  from_account_id  uuid        not null,
  to_account_id    uuid        not null,

  transfer_date    date        not null,
  amount_minor     bigint      not null check (amount_minor > 0),

  -- Both accounts are in this currency, which the two composite keys below enforce (decision 3 above).
  currency         text        not null check (currency ~ '^[A-Z]{3}$'),

  source           text        not null default 'typed' check (source in ('typed', 'import')),
  source_batch_id  uuid,
  source_hash      text        check (source_hash is null or length(source_hash) between 8 and 128),

  note             text        check (note is null or length(note) <= 500),
  voided_at        timestamptz,
  voided_by        uuid        references public.user_account (id) on delete restrict,

  created_by       uuid        not null default app.current_account_id()
                               references public.user_account (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint account_transfer_two_accounts check (from_account_id <> to_account_id),
  constraint account_transfer_voided_pair check ((voided_at is null) = (voided_by is null)),
  constraint account_transfer_import_pair
    check ((source = 'import') = (source_batch_id is not null) and (source_batch_id is null) = (source_hash is null)),

  constraint account_transfer_from_in_household_fkey
    foreign key (household_id, from_account_id, currency)
    references public.account (household_id, id, currency) on delete restrict,
  constraint account_transfer_to_in_household_fkey
    foreign key (household_id, to_account_id, currency)
    references public.account (household_id, id, currency) on delete restrict,
  constraint account_transfer_batch_in_household_fkey
    foreign key (household_id, source_batch_id)
    references public.import_batch (household_id, id) on delete restrict
);

comment on table public.account_transfer is
  'A move between two of the household''s own accounts, a card payment among them. Neither income nor spent (LI-I2). Voided, never deleted.';

create unique index account_transfer_source_hash_key
  on public.account_transfer (household_id, source_hash)
  where source_hash is not null;
create index account_transfer_household_date_idx on public.account_transfer (household_id, transfer_date desc);
create index account_transfer_from_idx on public.account_transfer (from_account_id);
create index account_transfer_to_idx on public.account_transfer (to_account_id);

create trigger account_transfer_touch_updated_at
  before update on public.account_transfer
  for each row execute function app.touch_updated_at();

create trigger account_transfer_audit
  after insert or update or delete on public.account_transfer
  for each row execute function app.write_audit();

alter table public.account_transfer enable row level security;
alter table public.account_transfer force row level security;

revoke all on public.account_transfer from public, anon, authenticated;
grant select, insert, update on public.account_transfer to authenticated;

-- Readable by whoever can read both accounts (decision 3 above); a viewer reads no account and so no transfer.
create policy account_transfer_select_follows_accounts
  on public.account_transfer
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.account a where a.id = account_transfer.from_account_id)
    and exists (select 1 from public.account a where a.id = account_transfer.to_account_id)
  );

create policy account_transfer_insert
  on public.account_transfer
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.account a where a.id = account_transfer.from_account_id)
    and exists (select 1 from public.account a where a.id = account_transfer.to_account_id)
  );

create policy account_transfer_update
  on public.account_transfer
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.account a where a.id = account_transfer.from_account_id)
    and exists (select 1 from public.account a where a.id = account_transfer.to_account_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.account a where a.id = account_transfer.from_account_id)
    and exists (select 1 from public.account a where a.id = account_transfer.to_account_id)
  );

create policy require_second_factor
  on public.account_transfer
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ═══════════════════════════════════════════════════════ income_entry

create table public.income_entry (
  id               uuid        primary key default gen_random_uuid(),
  household_id     uuid        not null references public.household (id) on delete restrict,
  member_id        uuid        not null,

  -- The tax year, '2026-27': 1 April to 31 March, in IST. The second half must follow the first.
  -- Written as a case so a malformed value is refused by this check and not by a cast that fails first.
  tax_year         text        not null check (
                                 case when tax_year ~ '^[0-9]{4}-[0-9]{2}$'
                                      then substr(tax_year, 6, 2)::int = (substr(tax_year, 3, 2)::int + 1) % 100
                                      else false end),

  -- ledger-income.md section 8: gross salary, a business or professional net profit, and other income at slab rates. Widened by a
  -- later migration if house property or foreign income is ever typed here.
  head             text        not null check (head in ('salary', 'business', 'other_sources')),

  -- Gross, typed from the payslip or Form 16; never derived from the Salary credits (LI-I11). Not negative: a business loss is refused
  -- by name in the app and by this check in the table (LI-I19).
  amount_minor     bigint      not null check (amount_minor >= 0),
  currency         text        not null default 'INR' check (currency = 'INR'),

  -- Tax deducted at source so far, when typed.
  tds_minor        bigint      check (tds_minor is null or tds_minor >= 0),

  -- A Form 16 figure is its own row and takes precedence; the payslip figure stays beside it.
  source           text        not null default 'typed' check (source in ('payslip', 'form16', 'typed')),

  created_by       uuid        not null default app.current_account_id()
                               references public.user_account (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint income_entry_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict
);

comment on table public.income_entry is
  'The Tax screen''s typed gross figures, per member and tax year. Readable only by the member''s own login and by whoever typed the row (LI-I21). Not derived from credits.';

create unique index income_entry_one_per_source
  on public.income_entry (household_id, member_id, tax_year, head, source);
create index income_entry_member_idx on public.income_entry (member_id, tax_year);

create trigger income_entry_touch_updated_at
  before update on public.income_entry
  for each row execute function app.touch_updated_at();

create trigger income_entry_audit
  after insert or update or delete on public.income_entry
  for each row execute function app.write_audit();

alter table public.income_entry enable row level security;
alter table public.income_entry force row level security;

revoke all on public.income_entry from public, anon, authenticated;
grant select, insert, update on public.income_entry to authenticated;

-- The member's own login and whoever typed the row, and only an owner, a partner or a contributor: a viewer reads none (LI-I12). A
-- partner does not read the other's gross salary unless they typed it, and neither does an owner (LI-I21).
create policy income_entry_select_own_or_typed
  on public.income_entry
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      member_id = app.current_member_id(household_id)
      or created_by = (select app.current_account_id())
    )
  );

create policy income_entry_insert
  on public.income_entry
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

create policy income_entry_update
  on public.income_entry
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      member_id = app.current_member_id(household_id)
      or created_by = (select app.current_account_id())
    )
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and (
      member_id = app.current_member_id(household_id)
      or created_by = (select app.current_account_id())
    )
  );

create policy require_second_factor
  on public.income_entry
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ═════════════════════════════════════════════════════ recurring_rule

-- A rule can now be a credit: a salary rule that reminds and never posts (LI-I8). category_id is required only for a debit.
alter table public.recurring_rule
  add column direction       text not null default 'debit' check (direction in ('debit', 'credit')),
  add column credit_category text check (credit_category is null
                                         or credit_category in ('salary', 'business', 'interest', 'rent', 'dividend', 'other_income', 'refund')),
  add column account_id      uuid,
  alter column category_id drop not null;

alter table public.recurring_rule
  add constraint recurring_rule_direction_shape
    check (
      (direction = 'debit'  and category_id is not null and credit_category is null)
      or
      (direction = 'credit' and category_id is null and credit_category is not null and account_id is not null)
    ),
  -- A credit rule never posts by itself: it makes an expected credit, which counts nowhere until a person confirms it.
  add constraint recurring_rule_credit_never_auto_posts
    check (direction <> 'credit' or not auto_post),
  add constraint recurring_rule_account_in_household_fkey
    foreign key (household_id, account_id)
    references public.account (household_id, id) on delete restrict;

comment on column public.recurring_rule.direction is
  'debit (an expense, as before) or credit (a salary or other income rule, which reminds and posts only on confirmation).';

-- ═══════════════════════════════════════ the audit log follows the row

-- LI-I22 and CLAUDE.md: an audit row for any of these is readable only by whoever can read the row it records. The test is the row
-- itself, read as the caller, so whatever the table's own policy hides, its audit row hides too: a partner's log shows nothing of the
-- owner's personal credit or the owner's tax inputs, and a personal account's balances stay inside that account.
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

-- ════════════════════════════════════════════ the one sum function

-- What came in and what was refunded, per currency, over a period, for the whole household, including members' private credits.
-- Definer, because the point is to read past the policy; bounded by what it returns: a currency and two sums. No row, no category beyond
-- the refund split, no date and no member, so a total and one's own share cannot be subtracted into another member's income beyond what
-- the owner chose a household total to reveal (ledger-income.md section 7).
create or replace function public.household_money_totals(
  target_household_id uuid,
  from_date date,
  to_date date
)
returns table (currency text, came_in_minor bigint, refunds_minor bigint)
language plpgsql
security definer
stable
set search_path = ''
as $fn$
begin
  if not app.has_second_factor() then
    raise exception 'Reading the household''s money totals needs an authenticator code in this session, not only a password.'
      using errcode = '42501';
  end if;

  if not coalesce(app.household_role(target_household_id) in ('owner', 'partner'), false) then
    raise exception 'Only an owner or a partner reads the household''s money totals.' using errcode = '42501';
  end if;

  return query
    select c.currency,
           coalesce(sum(c.amount_minor) filter (where c.category <> 'refund'), 0)::bigint,
           coalesce(sum(c.amount_minor) filter (where c.category = 'refund'), 0)::bigint
      from public.credit_entry c
     where c.household_id = target_household_id
       and c.voided_at is null
       and c.credit_date between from_date and to_date
     group by c.currency;
end;
$fn$;

comment on function public.household_money_totals(uuid, date, date) is
  'Came in (every category but refund) and refunds, per currency, for the whole household, to an owner or a partner with a second factor. Totals only: no row, no member, never a conversion between currencies.';

revoke all on function public.household_money_totals(uuid, date, date) from public;
grant execute on function public.household_money_totals(uuid, date, date) to authenticated;

-- ═══════════════════════════════════════════ reset_demo_household

-- Re-created from the latest version (20261106120000_gold_physical_etf.sql) with the new tables cleared, in foreign-key order: the
-- credits, transfers and balances before the rules and accounts they refer to, then the accounts, and the tax inputs. The function
-- raises at run time if a household table is left uncleared, which CI does not exercise, so each new table is named here.

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

