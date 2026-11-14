-- Family Finance Buddy — a salary or other income rule may name no account (the owner, 14 November 2026; docs/design/ledger-income.md
-- section 5, following account_optional, which made the account optional on a credit itself, LI-I4).
--
-- A household that has added no accounts still has a salary: the rule reminds on payday, and the credit it makes when confirmed names no
-- account and counts as came in outside the accounts added. Only the shape check changes; a credit rule still never posts by itself, still
-- has a credit category and no expense category, and a rule that does name an account still names one of its own household
-- (recurring_rule_account_in_household_fkey, unchanged: a foreign key skips a null column).
--
-- RLS, grants, policies and the audit trigger on recurring_rule are untouched.

alter table public.recurring_rule
  drop constraint recurring_rule_direction_shape;

alter table public.recurring_rule
  add constraint recurring_rule_direction_shape
    check (
      (direction = 'debit'  and category_id is not null and credit_category is null)
      or
      (direction = 'credit' and category_id is null and credit_category is not null)
    );

comment on column public.recurring_rule.account_id is
  'For a credit rule, the account the money arrives in, or null when the household has added none (LI-I4). Not used by an expense rule.';
