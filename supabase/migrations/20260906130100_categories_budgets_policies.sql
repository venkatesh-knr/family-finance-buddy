-- Family Finance Buddy — policies for categories and budgets.
--
-- Same shape as everything else: resolve through membership, scope to
-- `authenticated`, decide access and nothing else. No delete policy, because
-- deletes are soft — and here that is not merely a convention: a category that
-- has ever been used must remain on every historical row it appears in (§269),
-- so removing one would silently rewrite past months.

-- ---------------------------------------------------------- expense_category

create policy expense_category_select_same_household
  on public.expense_category
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

-- Categories are shared by the household rather than owned by a member, so the
-- contributor restriction that applies to transactions does not apply here —
-- the same reasoning as instruments. A contributor who could not add a
-- category would be forced to file their own spending under someone else's.
create policy expense_category_insert_own_household
  on public.expense_category
  for insert
  to authenticated
  with check (app.household_role(household_id) in ('owner', 'partner', 'contributor'));

create policy expense_category_update_own_household
  on public.expense_category
  for update
  to authenticated
  using (app.household_role(household_id) in ('owner', 'partner', 'contributor'))
  with check (app.household_role(household_id) in ('owner', 'partner', 'contributor'));

comment on policy expense_category_update_own_household on public.expense_category is
  'Renaming and archiving both happen here. Neither touches history: transactions reference a category by id.';

-- ------------------------------------------------------------------- budget

create policy budget_select_same_household
  on public.budget
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

-- Planning, not recording. A contributor logs what was spent; deciding what
-- the household intends to spend is the owner's and partner's business, which
-- is the same line §1023 draws by putting income and budgets in setup.
create policy budget_insert_own_household
  on public.budget
  for insert
  to authenticated
  with check (app.household_role(household_id) in ('owner', 'partner'));

create policy budget_update_own_household
  on public.budget
  for update
  to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'))
  with check (app.household_role(household_id) in ('owner', 'partner'));

comment on policy budget_insert_own_household on public.budget is
  'Owner and partner only. Recording a spend and planning one are different rights.';

-- ------------------------------------------- the second factor, on these too

create policy require_second_factor
  on public.expense_category
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.budget
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());
