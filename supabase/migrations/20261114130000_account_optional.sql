-- Family Finance Buddy — accounts are optional (the owner, 14 November 2026; docs/design/ledger-income.md section 0, LI-I4, LI-I26).
--
-- Two changes, both to what step 6a built:
--
--   1. A credit may name no account. Came in, FIRE and Tax count it as they count any credit; the month close treats it as having
--      arrived outside the accounts added (section 4). A credit that names an account still names one of its own household, in the
--      account's own currency: the composite foreign key skips a null account_id, and the policies below say so on purpose.
--
--   2. An account's type cannot change once something refers to it (LI-I26). Its currency already cannot: every credit, transfer and
--      balance cites (household, account, currency), so the foreign key refuses a currency that no longer matches. The type had no
--      guard. One trigger refuses a change to either, with a message a person can read, before the key would refuse the currency
--      with a code. It reads past row-level security, because an account's history includes rows its editor may not see (another
--      member's private credit on a shared account), and an account with history must not change type just because the editor
--      cannot see it. It returns nothing and reveals nothing but the refusal.
--
-- Not here, and why: the cash-reserve sum function (LI-I27). It sums the balances typed at a month close, and the close (step 6d) has
-- not been built, so which balance counts is not decided anywhere yet. It arrives with the close.
--
-- Not changed: a credit rule (recurring_rule, direction 'credit') still names its account. Design section 5 says so, and a household
-- with no accounts has no use for a rule that reminds of a salary into one. That is for the owner to say, and is raised in the PR.
--
-- RLS is already enabled and forced on credit_entry and account, and their grants and audit triggers are unchanged: this migration
-- recreates two policies and adds one trigger, and nothing else.

-- ═══════════════════════════════════════════════ 1. a credit may name no account

alter table public.credit_entry
  alter column account_id drop not null;

comment on column public.credit_entry.account_id is
  'The household account it was credited to, when the person has added it. Null: it counts as came in, and the month close treats it as having arrived outside the accounts added (LI-I4, LI-I6).';

-- A credit that names an account must name one the caller can read (so not another member's private one); a credit that names none
-- has nothing to check. Only the policies change; every other clause is as it was.
drop policy credit_entry_insert on public.credit_entry;

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
    and (account_id is null or exists (select 1 from public.account a where a.id = credit_entry.account_id))
  );

drop policy credit_entry_update on public.credit_entry;

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
    and (account_id is null or exists (select 1 from public.account a where a.id = credit_entry.account_id))
  );

-- ═════════════════════════════════════ 2. an account with history keeps its type

create or replace function app.refuse_account_retyping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.type is not distinct from old.type and new.currency is not distinct from old.currency then
    return new;
  end if;

  -- Any row at all counts, a voided credit and an archived account's included: they are the household's arithmetic.
  if exists (select 1 from public.credit_entry where account_id = old.id)
     or exists (select 1 from public.account_transfer where from_account_id = old.id or to_account_id = old.id)
     or exists (select 1 from public.account_balance where account_id = old.id) then
    raise exception 'An account''s type and currency cannot change once it has a credit, a transfer or a balance. Archive it and add another.'
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function app.refuse_account_retyping() is
  'Refuses a change of an account''s type or currency once a credit, a transfer or a balance refers to it (LI-I26). Definer, so history the editor cannot read still counts.';

revoke all on function app.refuse_account_retyping() from public;

create trigger account_refuse_retyping
  before update of type, currency on public.account
  for each row execute function app.refuse_account_retyping();
