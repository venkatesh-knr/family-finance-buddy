/**
 * Suggested categories — a menu, not a default.
 *
 * The first version of this inserted thirty-six categories in one click,
 * straight from the workbook this app was built to replace. That was the
 * fastest way to get one household running and the wrong thing for the screen
 * to do: the names were somebody's own ("Milk Aavin", "Mobile1", "Office
 * expense person1", "Insurance Scooty"), and a household that does not own a
 * scooty inherits a category it will never use and has to go and archive.
 *
 * Twenty-two untouched envelopes was the visible symptom, and the fix there
 * was to fold them away. This is the cause.
 *
 * So these are generic, grouped, and chosen rather than given. Nobody has to
 * take any of them: the free-text field beside this list is the real answer
 * for a household whose spending does not look like anybody else's, and these
 * exist so that setting up does not begin with a blank page and a cursor.
 *
 * Deliberately UI copy rather than data. A suggestion nobody has accepted is
 * not a row in anybody's household, and putting the list in the database
 * would make every future edit of it a migration.
 */

import type { CategoryNature } from '../../repo/types.ts';

export interface Suggestion {
  readonly name: string;
  /**
   * `fixed` is a commitment that arrives whether or not anybody acts —
   * a rent, a fee, a premium. `variable` is a decision each time.
   *
   * It is a starting guess and editable afterwards, because the same name is
   * genuinely both in different households: groceries are a fixed monthly
   * envelope for one family and a variable one for another.
   */
  readonly nature: CategoryNature;
}

export interface SuggestionGroup {
  readonly group: string;
  readonly items: readonly Suggestion[];
}

export const CATEGORY_CATALOGUE: readonly SuggestionGroup[] = [
  {
    group: 'Home and bills',
    items: [
      { name: 'Rent', nature: 'fixed' },
      { name: 'Maintenance', nature: 'fixed' },
      { name: 'Electricity', nature: 'fixed' },
      { name: 'Cooking gas', nature: 'fixed' },
      { name: 'Water', nature: 'fixed' },
      { name: 'Broadband', nature: 'fixed' },
      { name: 'Mobile', nature: 'fixed' },
      { name: 'TV and streaming', nature: 'fixed' },
      { name: 'Household help', nature: 'fixed' },
      { name: 'Repairs', nature: 'variable' },
    ],
  },
  {
    group: 'Food',
    items: [
      { name: 'Groceries', nature: 'fixed' },
      { name: 'Vegetables', nature: 'fixed' },
      { name: 'Fruit', nature: 'fixed' },
      { name: 'Milk', nature: 'fixed' },
      { name: 'Eating out', nature: 'variable' },
      { name: 'Food delivery', nature: 'variable' },
    ],
  },
  {
    group: 'Transport',
    items: [
      { name: 'Fuel', nature: 'variable' },
      { name: 'Public transport', nature: 'variable' },
      { name: 'Vehicle service', nature: 'variable' },
      { name: 'Vehicle insurance', nature: 'fixed' },
      { name: 'Tolls and parking', nature: 'variable' },
      { name: 'Taxi and rideshare', nature: 'variable' },
    ],
  },
  {
    group: 'Health',
    items: [
      { name: 'Health insurance', nature: 'fixed' },
      { name: 'Doctor and dentist', nature: 'variable' },
      { name: 'Medicines', nature: 'variable' },
      { name: 'Fitness', nature: 'fixed' },
    ],
  },
  {
    group: 'Children and education',
    items: [
      { name: 'School fees', nature: 'fixed' },
      { name: 'Tuition and coaching', nature: 'fixed' },
      { name: 'Books and supplies', nature: 'variable' },
      { name: 'Childcare', nature: 'fixed' },
      { name: 'Activities', nature: 'variable' },
    ],
  },
  {
    group: 'Personal',
    items: [
      { name: 'Clothing', nature: 'variable' },
      { name: 'Grooming', nature: 'variable' },
      { name: 'Subscriptions', nature: 'fixed' },
      { name: 'Gifts', nature: 'variable' },
      { name: 'Giving', nature: 'variable' },
    ],
  },
  {
    /*
     * The group a testing round found missing entirely.
     *
     * An EMI and a premium leave the bank like any other spend, and there was
     * nowhere to file either — no loan category at all, and only the two
     * insurances that happen to sit under Health and Transport. So the payment
     * could be made and not recorded, which is the one thing a ledger must not
     * make easy.
     *
     * These are for recording what left the account. They are NOT how a loan
     * or a policy reaches the annual expense: that comes from the loan and
     * policy rows themselves, on FIRE. Budgeting one of these as well would
     * count the same commitment twice and inflate the FIRE target by every
     * loan the household has — which is why the chooser says so out loud.
     *
     * No "credit card repayment" here, deliberately. Paying a card settles
     * spending that was already recorded when it happened; filing the
     * repayment as an expense too would double every card purchase.
     */
    group: 'Loans and premiums',
    items: [
      { name: 'Home loan', nature: 'fixed' },
      { name: 'Vehicle loan', nature: 'fixed' },
      { name: 'Personal loan', nature: 'fixed' },
      { name: 'Education loan', nature: 'fixed' },
      { name: 'Gold loan', nature: 'fixed' },
      { name: 'Life insurance', nature: 'fixed' },
      { name: 'Term insurance', nature: 'fixed' },
      { name: 'Home insurance', nature: 'fixed' },
    ],
  },
  {
    group: 'Occasional',
    items: [
      { name: 'Travel and holidays', nature: 'variable' },
      { name: 'Festivals', nature: 'variable' },
      { name: 'Household goods', nature: 'variable' },
      { name: 'Pets', nature: 'variable' },
      { name: 'Other', nature: 'variable' },
    ],
  },
];
