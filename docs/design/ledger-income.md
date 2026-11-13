# Money as a ledger, and how income is captured

<!-- invariant-prefix: LI -->

The Expenses screen becomes **Money**: a ledger of credits and debits, the way a bank
statement reads. Income is captured as credits on it. From the credits, the month's
money screen, FIRE and Tax each get the income figure they need. This was decided in
outline by the owner on 13 November 2026 (`docs/decisions.md`, "The owner's answers to
the open questions"), and the details were decided in chat the same day (§0).

The pictures are `docs/design/ledger-income-boards.html`: MoneyLedger, MoneyLedgerLight,
AddCredit, AddCredit2, SalaryRule, TaxIncomeInputs, FireIncome, FireBusiness and
MonthMoney (redrawn).
The boards use the Simple layout (`simple-layout.md`): one lifted surface, soft panels,
underline fields, stepped forms, and ovals for small controls. Dashed indigo circles with
a number are annotations, not UI. Each one points to a numbered state in §9. Where this
file and the boards differ, this file is the authority. It supersedes the parts of
`spending-capture.md` and `protection-and-flow.md` that §11 names.

Design only. Every question in §10 was answered by the owner on 13 November 2026, so
the design is ready for the build of step 6a.

## 0. What is decided, and what is proposed

**Decided by the owner, 13 November 2026:**

- Money is a ledger. A debit is spending, unless it is one of the exclusions below.
- A credit carries a category: Salary, interest, rent, refund, dividend or other.
- Moving money between the household's own accounts is in neither income nor spent. So
  is a card payment, and so is money paid into or taken out of a holding.
- Take-home pay is the Salary credit as the bank received it. Deductions are not
  recorded.
- FIRE takes its yearly income from the Salary credits and never grows it by inflation.
  **Amended in chat, 13 November 2026:** FIRE uses the *usual* monthly salary, meaning the
  amount that recurs most often, in place of the highest month ("if 4 months reported the
  same salary, we can consider that salary").
- Tax takes a gross salary typed once a year, per member, from the payslip. It can be
  corrected later from Form 16. Other income and TDS are optional. CTC is not the
  taxable gross.
- The "put away through payroll" line is dropped.
- Income is private by default. Household totals come from a sum function. A
  contributor sees their own income; a viewer sees none.
- A realised capital gain is not income.
- The cash reserve is a legitimate reserve. The screen never says "not yet invested" or
  "left in the bank".
- The month control is This month | Last month.
- **In chat, 13 November 2026:**
  - The rename is **label and route**: `#/money`, with `#/expenses` redirecting to it.
  - A salary rule **reminds you, and posts only when you confirm**.
  - Money coming back to you is **"Refund or money back"**. It takes away from spent
    and is not income.
- **Business income, in chat, 13 November 2026.** The app serves salaried people and
  business people alike, so a credit can be salary or business income.
  - **What counts:** Money records what **reaches home**. A *Business income* credit is
    money drawn from the business into a household account. Business bank accounts,
    sales and business costs stay out of the app, so household spent is never mixed
    with business costs.
  - **FIRE** takes business income as **the total of the last 12 complete months**.
    With fewer months, it uses their average × 12, labelled as such. It is never grown
    by inflation.
  - **Tax** takes business income as **a net profit, typed** once a year per member,
    from the books or the ITR.
  - **A mixed account is left as it is:** client fees paid into a personal account are
    Business income, and business costs paid from it count as spent.

- **The four proposals, accepted in chat, 13 November 2026** (§10):
  - **The usual salary** is the most common amount in the **last six months entered**.
    On a tie, the **more recent** amount is used. When nothing repeats, FIRE uses the
    **latest month** and says so.
  - **Loan EMIs** are a fourth part of the month's split: **spent · invested · paid to
    loans · to cash reserve**.
  - **A member's tax inputs** are read only by that member's login and by whoever typed
    them.
  - **Audit rows** for `credit_entry` and `income_entry` follow the visibility of the row
    they record.

## 1. The ledger

**One screen, one list, newest first, grouped by IST date.** Each line shows:

- a direction icon;
- a name, such as the payee, the category or the holding;
- a second line naming the category, the account (last four only) and, where relevant,
  the member;
- the amount, with its sign;
- one word saying what the line does to the month: *spent*, *came in*, *takes away from
  spent*, *moved · not spent* or *into a holding*.

Direction is never shown by colour alone:

- **A credit** has a `+` sign, an arrow pointing in, and the word under the amount. Teal
  is the third signal.
- **A debit** has a `−` sign and an arrow pointing out.
- **A move** has no sign, a two-arrow icon and the words *moved · not spent*.

**The lines come from four places.** The ledger is a read-only view over them. Nothing is
written twice.

| Line | Comes from | Counts as |
|---|---|---|
| Spending (debit) | `expense_txn`, as today | spent |
| Money in (credit) | `credit_entry`, new | came in, or takes away from spent (a refund) |
| A move between own accounts, a card payment among them | `account_transfer`, new | neither |
| Money into or out of a holding | the holding's own entries that name the account they were paid from or into (spending-capture §10) | neither: invested, or taken out |

**A spending debit stays an `expense_txn`.** Nothing about expense entries changes. They
keep their category, payee, method, visibility, recurring rule and capture source. The
ledger shows them beside the credits, and does not turn them into a second kind of row.

**Where a credit is entered.** Two buttons sit above the list: *+ Money in* and *+ Money
out*. Money out is today's quick add, unchanged. Money in is the stepped AddCredit form
(§2). The filter is a row of ovals: All | In | Out | Moved.

**The lifted surface is the month** (§4): *Came in · Spent · Saved*, with the This month |
Last month control. Spent against the plan was the lifted figure until now. It moves,
unchanged, to a soft panel, *Against the plan*, under *Expected*. That panel is not
redrawn.

### The credit entry

| Field | Rule |
|---|---|
| `direction` | Implied by the table. Every `credit_entry` is a credit. A debit that is spending is an `expense_txn`; a debit that is a move is the out-leg of an `account_transfer`. |
| `category` | Exactly one of: `salary`, `business`, `interest`, `rent`, `dividend`, `other_income`, `refund`. The screen shows `business` as *Business income* and `refund` as *Refund or money back*. |
| `amount_minor`, `currency` | `bigint > 0`, integer minor units, ISO code. Stored as received, never converted on write. |
| `credit_date` | A calendar date in IST: the date the bank credited it. |
| `member_id` | Whose income it is. The default is the account's member. On a joint account, the person chooses. |
| `account_id` | Required. The household account it was credited to (§6, cash). |
| `visibility` | `personal` or `household`. Income categories default to `personal`; `refund` defaults to `household`. The column's own default is `personal`, the safe one. |
| `source` | `typed`, `rule` (confirmed from an expected credit) or `import`. With `rule`, it also stores `recurring_rule_id` and the `due_date` it answers. With `import`, it also stores `source_batch_id` and `source_hash`. |
| `payer`, `note` | Optional text: who paid, as the bank shows it. |
| `voided_at`, `voided_by` | A credit is voided, never deleted, as `expense_txn` is. |

**A move between own accounts** is one `account_transfer` row: `from_account_id`,
`to_account_id` (never the same account), `transfer_date`, `amount_minor`, `currency`,
`source`, a note, and void fields. The ledger shows it as a single line. It is neither a
credit nor a debit of the household's money.

**On AddCredit**, the chip *From my own account* makes the form an `account_transfer`.
Step 2 then asks *From which account* in place of *Whose income*.

## 2. Adding money in

Two steps (SL-I6: going back keeps every value, and nothing is written until the last
step's button).

1. **What came in.**
   - Amount.
   - What it is: the eight chips, Salary, Business income, Interest, Rent, Dividend,
     Other income, Refund or money back, and From my own account. *Business income*
     carries a line: *money you take from the business into this account; the
     business's own accounts are not added here.*
   - Into which account.
   - The date it was credited.
   - A line under the chips says what each kind counts as.
2. **Whose, and who sees it.**
   - Whose income.
   - Who can see this row: *Only me* or *The household*, as ovals.
   - From (the payer, optional).
   - *Repeats every month*, which opens the rule (§5) after the credit is saved.

Required fields carry the asterisk in the attention colour, with `aria-required`, and the
form has one key line at the top (the 13 November decision on required fields).

## 3. The money screen's name

The bar becomes **Overview · Money · Holdings · Goals · More**. The route is `#/money`.
`#/expenses` and any `#/expenses?…` replace themselves with the same query on `#/money`,
so a saved link still works and the back button does not loop. The Expense categories
settings keep their name: they are categories of spending.

## 4. The month: came in, spent, saved

```
came in (month)  = Σ credits in the month whose category is salary, business,
                   interest, rent, dividend or other_income      (per currency)
refunds (month)  = Σ credits in the month whose category is refund

open month:
  spent so far   = Σ expense_txn in the month − refunds          ("itemised so far")
  saved          = not shown                                     ("after the close")

closed month (spending-capture §2, money in made exact):
  money in (per account) = its credits + transfers into it + holding take-outs paid into it
  left           = opening + money in − closing        (bank)
                 = due at end − due at start + money in (card: payments and refunds)
  spent          = Σ left − own transfers out − money into holdings − refunds
                   − paid to loans
  saved          = came in − spent
                 = net invested + paid to loans + change in cash reserve   (SC-I12)

paid to loans    = the month's loan EMI debits, on their own line (spending-capture,
                   decided 13 November), all of each EMI: principal and interest
```

**Why saved splits exactly.** Write every account's change as its credits minus its
outflows. An own transfer appears once as an outflow and once as a credit. Money into a
holding is an outflow, and money taken out of one is a credit. Substituting those into
`came in − spent` leaves exactly `(put into holdings − taken out) + paid to loans + Σ change
in balances`.
No payroll term is needed, because take-home is what the bank received. No business
term is needed either, because only what reached a household account is recorded.

**Spent is still derived, never stored** (SC-I1). The close stores balances. Money in for
an account is no longer typed at the close as *other money in*. Each credit is a ledger
line with a category, so the close shows what was recorded per account, and offers
*+ Money in* when it is short.

**The month control** is This month | Last month, as ovals in the lifted surface. Last
month is closed, or shows the open state if nobody has closed it yet.

**Currencies are never added together.** A month with a USD credit shows a second *came
in* line in USD. FIRE and Tax read INR only, and say when credits in another currency
were left out.

## 5. A recurring credit: the salary rule (and any income rule)

A rule that is due shows an **expected** credit. It is not a row, and it counts nowhere,
until somebody confirms it. That was the owner's choice (13 November): a salary varies a
little, and an unconfirmed figure must not reach the month, FIRE or the household total.

- **The rule** is a `recurring_rule` with `direction = 'credit'`, a `credit_category`, a
  `member_id`, an `account_id`, a usual amount, the payday (`due_day` 1–28, as today) and
  a visibility. A credit rule **never auto-posts**: the database refuses
  `auto_post = true` when `direction = 'credit'`. Rules for business income (a fixed
  monthly drawing) and rent work the same way; the SalaryRule board is the salary case.
- **On payday** (IST), the ledger's *Expected* panel lists each active credit rule whose
  `next_due` is today or earlier. A rule three months behind lists three. Each has three
  actions:
  - **Confirm** writes one `credit_entry` with `source = 'rule'`, the rule and the due
    date, and moves `next_due` on by one period.
  - **Change amount** opens AddCredit pre-filled. It saves the same way, and offers
    *Use this amount from now on*, which updates the rule.
  - **Not this month** moves `next_due` on and writes nothing.
- **At most one credit per rule and due date** (a unique key on
  `(recurring_rule_id, due_date)`), so a double tap cannot post twice.
- **The rule's own screen** lists its due dates:
  - *expected* for a date not yet confirmed;
  - *confirmed* for a date that has a credit;
  - *confirmed at a different amount*, with the rule's amount beside it;
  - *nothing posted* for a date that was passed over.

  *Nothing posted* is worked out from the due dates and the credits, not stored.
- **The reminder** is the rule's existing `reminder_days`. It names the rule and never the
  amount: no figure in a notification or an email.

## 6. Awkward cases

| Case | What happens |
|---|---|
| **A reimbursement** (an employer repays travel) | Refund or money back. It takes away from spent in its month and is not income. If the spending was in an earlier month, that month's spent does not change, and this month's spent can go below the itemised total. The ledger's word for it says so. |
| **A refund** | Refund or money back, on the account or card it landed on. On a card it is money in for the card, so the card's *left* stays gross, and the refund is taken away once, as for any other account. |
| **A joint account** | The account belongs to the household (`visibility = household`). A credit on it belongs to whoever the person names. If the credit is private, AddCredit warns that the account's balance is seen by the household, so the credit is private *in the list only* (AddCredit2, state 1). |
| **Cash** | The wallet is not an account (spending-capture §2). Cash kept as cash is not entered. Cash income paid into an account is entered on the day it is paid in, with its real category. A credit always names an account. |
| **A salary in two parts** | Two Salary credits in the same month. The month's salary is their sum, and FIRE reads monthly sums, not single credits. |
| **A month with no salary** | Came in holds whatever else came in, and saved can be negative. A negative saved shows a minus sign and the words *spent more than came in*, never red alone. The month is not a month entered for FIRE (§7). |
| **A bonus** | A Salary credit. It counts in that month's came in. Because FIRE uses the *usual* amount, a bonus month does not move it (FireIncome, Oct). |
| **Business income** | Money drawn from the business into a household account, as *Business income*, on the day it lands. Sales, client receipts and costs that stay in the business's own account are not entered. Taking money out of the business is the household's income; what the business earned is Tax's net profit (§8). |
| **A month with no business income** | Nothing is entered. Inside FIRE's twelve months it counts as zero, which is what makes the yearly figure honest for income that comes unevenly. |
| **Salaried and in business** | Both kinds of credit. FIRE adds the usual salary × 12 to the business figure. Tax takes both gross salary and net profit. |
| **A mixed account** (fees paid straight into a personal savings account, and business costs paid from it) | Left as it is (the owner, 13 November). Client fees are Business income. Business costs paid from the account are spent, because the app cannot tell them from household spending. Someone who wants them apart keeps the business in its own account and records what they draw from it. |
| **The first month** | The first close asks for opening and closing balances (spending-capture §2). FIRE has one month entered, and nothing repeats yet: see §10, question 1. |
| **A credit that is really a transfer** | The person picks *From my own account*, which makes an `account_transfer`, not a credit. If money comes from a family member's account that the household has not added, it is money from outside: Other income for a gift, or Refund or money back for a repayment. Bank import (Stage 5) must detect a matching debit and credit and offer the move. That is part of import, not a follow-up (protection-and-flow §4). |

## 7. FIRE

FIRE only reads income. Income is entered in Money.

**Salary.**

```
month's salary (member, month)  = Σ confirmed Salary credits for that member in the IST month
months entered (member)         = months with a month's salary > 0
usual (member)                  = the month's-salary amount that occurs most often among the
                                  last six months entered, compared to the paisa;
                                  on a tie, the more recent amount;
                                  when nothing repeats, the latest month's    (owner, 13 Nov)
yearly salary (member)          = usual × 12                       never grown by inflation
```

**Business income** (owner, 13 November):

```
window (member)          = the last 12 complete IST months, starting no earlier than the
                           month of the member's first Business income credit
yearly business (member) = Σ Business income credits in the window          (12 months)
                         = Σ in the window ÷ months in the window × 12      (fewer, labelled
                                                                            "average of n
                                                                            months × 12")
                           a month in the window with nothing entered counts as zero
```

The current month is never in the window, because it is not complete. With only the
current month entered, FIRE says the first figure comes when that month ends (FireBusiness,
state 4).

**Together.**

```
yearly income (Mine)      = yearly salary + yearly business      never grown by inflation
yearly income (Household) = Σ over earners of the same           through the sum function
```

**On the screen** (FireIncome):

- The yearly income, with its working (*₹1,42,000 × 12 · never grown by inflation*).
- One sentence on where the usual amount came from (*came in four of the six months
  entered*).
- The months, each marked *usual* (a tick and the word) or *not the usual amount*.
- A link to change it in Money.
- **A year, side by side:** comes in, spent (from the plan) and the difference, labelled
  *arithmetic only, not advice*.

FIRE never suggests what to do with the difference.

**Empty states.**

- **State 2, no amount repeats** (the first month among them). FIRE uses the latest month's
  salary and says so.
- **State 3, no Salary or Business income credit at all.** FIRE shows the FIRE number
  without a yearly income, and links to *+ Money in*. It is never zero, and never a guess.

**On the screen for business income** (FireBusiness):

- The yearly figure, with its working (*Business income, last 12 months · never grown by
  inflation*).
- The twelve months in a grid of two columns, with *nothing drawn* written beside a zero
  month.
- *A year, side by side*, as for salary.

**Household view.** It uses the sum of each earner's yearly salary and yearly business
income, and no member's months
are listed (state 4). With two earners, a total and your own share reveal the other
person's. That is the price of a household total, which the owner chose. The screen does
not pretend otherwise.

## 8. Tax: the year's income, typed

Tax does **not** read the Salary credits, which are take-home. It takes gross figures typed
for each member and tax year (TaxIncomeInputs). The board keeps the native selects for year
and member (decided) and the label above each value.

| Input | Rule |
|---|---|
| Gross salary for the year | Optional, like every input here: the estimate covers what is typed. Typed from the payslip's gross earnings. The help line says it is **not the CTC**, and not the Salary credits in Money. |
| Correct from Form 16 | Writes the Form 16 figure as its own row. The Form 16 figure is used from then on, and the payslip figure is still shown (*was ₹22,80,000 from payslip*). |
| Business or professional income | Optional. **The net profit for the year, typed**, from the books or the ITR, after business expenses (owner, 13 November). It is not the Business income credits in Money, which are drawings. Taxed at slab rates, with no standard deduction, which is salary's alone. Refused by name and not guessed: a loss, presumptive taxation (44AD, 44ADA) and advance-tax instalments, which the build plan already lists as ahead. |
| Other income at slab rates | Optional. |
| TDS so far | Optional. When typed, the lifted figure adds *still to pay after TDS*. |

**Storage** is the blueprint's `income_entry`, §04, made exact:

- `member_id`, `tax_year` (`'2026-27'`, IST, 1 April to 31 March);
- `head`: `salary`, `business` or `other_sources`;
- `amount_minor` and `currency` (`INR`);
- `tds_minor`, which may be null;
- `source`: `payslip`, `form16` or `typed`.

Rows are unique on (member, tax year, head, source). The figure in force is `form16` if
present, otherwise `payslip` (or `typed` for business and other sources).

**With nothing typed** (state 3), the estimate covers what is typed and the gains, and
says what it left out. That is today's behaviour, unchanged.

**Who reads these figures** (the owner, 13 November): the member's own login, and whoever
typed the row. That covers a parent without a login, whose income the owner types. A
partner does not see the other's gross salary unless they typed it. On Tax, choosing a
member whose figures you cannot read shows *these figures are kept private by their
owner*, and no estimate.

## 9. States drawn on the boards

| Board | State | What it shows |
|---|---|---|
| MoneyLedger | 1 | An open month: saved is "—", *after the close* |
| | 2 | An expected credit, waiting: Confirm, Change amount, Not this month |
| | 3 | A card payment as a move: no sign, *moved · not spent* |
| | 4 | Money into a holding, from the holding's own entry |
| | 5 | A private Salary credit: a lock and *only you see this row* |
| | 6 | Other members' private credits: in *Came in*, not listed |
| MoneyLedgerLight | 1–6 | The same in Mist |
| AddCredit | — | Step 1, amount focused |
| AddCredit2 | 1 | The joint-account warning |
| | 2 | Repeats every month, which leads to the rule |
| SalaryRule | 1–4 | A due date that is expected, confirmed, confirmed at a different amount, and passed over |
| TaxIncomeInputs | 1 | Gross salary from the payslip, and business income left empty |
| | 2 | Corrected from Form 16, with the payslip figure kept |
| | 3 | Nothing typed yet |
| FireIncome | 1 | The usual amount, and the months it came from |
| | 2 | No amount repeats: the latest month, said so |
| | 3 | No Salary credit |
| | 4 | The Household view |
| FireBusiness | 1 | Business income over the last 12 complete months, zero months included |
| | 2 | Fewer months: the average × 12, labelled |
| | 3 | Salaried and in business: the two added |
| | 4 | Only the current month entered: the first figure comes when it ends |
| MonthMoney | 1 | A closed month: the cash reserve by account, with the decided wording. The example has no EMI; with one, *paid to loans* is a fourth part of the bar and the legend, and a row of its own. |
| | 2 | An open month: invested so far, with saved after the close |

**At 200% text.** No row has a fixed height. A row's amount column stays together and its
name wraps underneath it. The three figures in the lifted surface fold to one column below
360 CSS px of content width. The ovals wrap rather than scroll. The bar keeps its
labels, as today.

## 10. Questions for the owner, answered

All answered in chat on 13 November 2026, each by accepting the proposal:

1. **The usual salary when it is not clear-cut:** the last six months entered; on a tie
   the more recent amount; when nothing repeats, the latest month, said so (§7).
2. **Loan EMIs:** a fourth part of the split, *paid to loans*, and SC-I12 gains it (§4).
3. **Another member's tax inputs:** read by that member's login and by whoever typed them
   (§8).
4. **The audit log and private income:** audit rows for `credit_entry` and `income_entry`
   follow the visibility of the row they record (§12). This is the owner's ruling as
   maintainer on the CLAUDE.md invariant that makes audit rows readable by the household.
5. **A mixed account:** left as it is (§6).

## 11. What this changes elsewhere

- **spending-capture.md §2.** *Money in is pre-filled* becomes *money in is the account's
  credits, transfers in and holding take-outs from the ledger*. *Other money in* at the
  close is replaced by *+ Money in*, which records a credit with a category.
- **spending-capture.md §10.**
  - The opening says *how much went to the cash reserve*. The sentence *not yet moved into
    savings, and the screen should say so* is removed.
  - The payroll bullet is removed.
  - *On the screen* reads *spent · invested · to cash reserve*.
  - The note that the build will not copy "Left in the bank" is replaced by a pointer to
    the redrawn MonthMoney board.
- **SC-I12** is reworded, so that it does not depend on payroll and includes the EMIs:
  *for a closed month, came in minus spent equals net invested plus paid to loans plus the
  change in cash reserve, to the paisa*. §10's split reads *spent · invested · paid to
  loans · to cash reserve*. Its
  waiver stays until the close is built.
- **SC-I14 is withdrawn**, with its test line and its waiver (the owner dropped the payroll
  line on 13 November).
- **protection-and-flow.md §4.**
  - The `income` table and its categories (`capital_gain`, `business`, `gift`, the
    recurring flag) are superseded by §1. `business` stays, as money drawn into a
    household account. `capital_gain` was already wrong, since a realised gain is not
    income. `gift` is Other income.
  - *Saved this month = income − expense* stands, as came in − spent.
- **protection-and-flow.md §6.** The bar keeps Goals, not FIRE, as built. Only Expenses is
  renamed. Tax stays behind More.
- **The blueprint, §04.** `income_entry` gains `source`; the `income` of PF §4 is
  `credit_entry`; and `account_transfer` is new.

## 12. New tables, and what each one owes

`credit_entry`, `account_transfer` and `income_entry` are new. So are `account` and
`account_balance` from step 6a, which spending-capture §7 already specifies. In
`recurring_rule`:

- it gains `direction`, `credit_category` and `account_id`;
- `category_id` becomes required only for a debit;
- a check refuses `auto_post` on a credit.

Every new table, in the same migration that creates it, has:

- its **audit trigger**, recording reads as well as writes, because these tables carry
  personal detail. For `credit_entry` and `income_entry`, an audit row is readable only by
  whoever can read the row it records (§10, question 4), and a denying test proves it before
  any income is stored;
- **RLS enabled** explicitly, and **explicit grants**;
- a **pgTAP test per verb and role that proves the policy denies**:
  - a viewer reads no `credit_entry` and no `income_entry`;
  - a contributor reads only their own;
  - an owner or a partner does not read another member's private credit;
- household-scoped composite foreign keys, as `recurring_rule` has;
- a line in **`reset_demo_household`** that clears it, and demo seed rows if the demo
  should show the ledger;
- registration in the **export's entity list** (build plan, step 5).

The sum function is a `security definer` SQL function:
`household_money_totals(from, to)` returns came in and refunds per currency, and
`household_yearly_income()` returns the Household FIRE figure (salary and business) per
currency. Each:

- checks the caller is an owner or a partner of that household;
- returns totals only, never rows and never a member's share;
- has its own denying test for a contributor and a viewer.

It does access, not business rules: the arithmetic of §4 and §7 stays in pure domain
functions, which read the totals.

**Conflicts with CLAUDE.md:**

- The audit log is readable by the household. The owner ruled on 13 November that audit
  rows for private income follow the row's visibility. CLAUDE.md's audit paragraph needs a
  second named exception beside `import_batch_row`. That edit is the maintainer's to make,
  in the same change as the build.
- The "no figure in a notification" rule shapes the payday reminder (§5); it is followed,
  not in conflict.

## Invariants

**LI-I1 — A credit has exactly one category, and *came in* is the sum of the salary, business, interest, rent, dividend and other-income credits alone;** a refund is never in it. (§1, §4)

**LI-I2 — A move between the household's own accounts, a card payment, and money into or out of a holding are in neither came in nor spent.** (§1, §4)

**LI-I3 — A refund or money back reduces spent in the month it is credited and is never income.** (§4, §6)

**LI-I4 — Every credit names an account of the household;** there is no credit without one. (§1, §6)

**LI-I5 — Amounts are integer minor units with a currency, dates are IST calendar dates, and totals are per currency, never converted into one another.** (§1, §4)

**LI-I6 — A closed month's money in, for each account, is the sum of its credits, transfers in and holding take-outs;** nothing is typed beside them at the close, and spent is still derived, never stored. (§4)

**LI-I7 — Saved is shown only for a closed month, and equals came in minus spent.** (§4)

**LI-I8 — An expected credit counts nowhere until it is confirmed;** a credit rule never auto-posts, and a rule posts at most one credit per due date. (§5)

**LI-I9 — FIRE's yearly income is the usual monthly salary times twelve plus the yearly business income, summed over earners on Household,** where the usual salary is the amount that occurs most often among the months entered, and it is never grown by inflation. (§7)

**LI-I10 — With no Salary or Business income credit, FIRE shows its number without a yearly income;** it never shows zero or an estimate in its place. (§7)

**LI-I11 — Tax's gross salary is typed per member and tax year and is never derived from the Salary credits;** a Form 16 figure takes precedence and the payslip figure stays visible beside it. (§8)

**LI-I12 — An income credit is private by default; a viewer reads no credit, a contributor reads only their own, and nobody reads another member's private credit row.** (§1, §12)

**LI-I13 — The household's total of private income is reachable only through the sum function, by an owner or a partner, as totals per currency;** never as rows and never per member. (§7, §12)

**LI-I14 — The payday reminder names the rule and never an amount.** (§5)

**LI-I15 — `#/expenses` replaces itself with `#/money`, keeping its query;** the bar's label is Money. (§3)

**LI-I16 — A ledger line's direction is given by its sign, its icon and its word, never by colour alone.** (§1)

**LI-I17 — The month's money screen calls the reserve the cash reserve;** the strings "not yet invested" and "left in the bank" appear nowhere in the app. (§11)

**LI-I18 — FIRE's yearly business income is the total of Business income credits over the last 12 complete IST months,** or, with fewer months since the first one, their average times twelve, labelled; a month with nothing entered counts as zero, and the current month is never included. (§7)

**LI-I20 — The usual salary is the most common month's salary among the last six months entered;** on a tie the more recent amount, and when nothing repeats the latest month's, which FIRE says. (§7)

**LI-I21 — A member's tax inputs are readable only by that member's login and by whoever typed them.** (§8)

**LI-I22 — An audit row for a credit or a tax input is readable only by whoever can read the row it records.** (§12)

**LI-I23 — For a closed month, the split is spent, invested, paid to loans and to cash reserve, and the last three add up to saved to the paisa.** (§4)

**LI-I19 — Tax's business income is a typed net profit per member and tax year, taxed at slab rates without the standard deduction,** never derived from the Business income credits; a loss is refused by name. (§8)

## Tests

- LI-I1: a month with Salary ₹1,42,000, Interest ₹1,250 and Refund ₹1,299 gives came in ₹1,43,250, and a ₹50,000 Business income credit raises it to ₹1,93,250; a credit with no category, or two, is refused by the table's check.
- LI-I2: an `account_transfer` of ₹18,240 from savings to a card, and a ₹10,000 SIP paid from savings, change neither came in nor a closed month's spent (pure domain test over the §4 worked example).
- LI-I3: the §4 worked example with a ₹1,299 refund gives spent ₹1,299 lower than without it and came in unchanged; the same refund in the next month changes the next month alone.
- LI-I4: inserting a `credit_entry` with a null `account_id`, or an account of another household, is refused (pgTAP).
- LI-I5: a credit with a fractional amount is refused; a credit at 23:30 IST on 31 October lands in October; a USD credit and an INR credit give two came-in lines and no sum.
- LI-I6: for the MonthMoney example (Salary ₹1,42,000 to HDFC, Interest ₹1,250 to SBI, a ₹1,299 refund and an ₹18,240 payment to the card, ₹55,000 into holdings from HDFC; HDFC up ₹20,380, SBI up ₹400, card due up ₹2,200), left is HDFC ₹1,21,620, SBI ₹850 and card ₹21,739, Σ ₹1,44,209, and spent = ₹1,44,209 − ₹18,240 − ₹55,000 − ₹1,299 = ₹69,670; no column stores it.
- LI-I7: the open month renders saved as "—" with "after the close"; the closed month renders ₹73,580, which equals ₹55,000 + ₹18,580.
- LI-I8: an active credit rule due today adds nothing to came in or FIRE until confirmed; confirming twice inserts one row; `auto_post = true` with `direction = 'credit'` is refused (pgTAP).
- LI-I9: monthly salaries of 1,42,000 ×4, 1,38,450 and 2,10,000 give ₹17,04,000; adding the FireBusiness months gives ₹31,44,000; two earners give the sum of both on Household; a year later, with no new credit, the figure is unchanged.
- LI-I10: a member with no Salary or Business income credit sees the FIRE number, no yearly-income figure, and the link to + Money in; the DOM contains no "₹0" in that panel.
- LI-I11: a member with ₹1,42,000 monthly Salary credits and no typed gross has no salary in the tax estimate; typing a payslip figure then a Form 16 figure uses the Form 16 one and shows "was" with the payslip one.
- LI-I12: pgTAP, per verb: a viewer selects no `credit_entry`; a contributor selects only rows with their member; an owner does not select a partner's personal credit.
- LI-I13: `household_money_totals` returns one row per currency to an owner and a partner, and raises for a contributor and a viewer; its result has no member column.
- LI-I14: the reminder text for a credit rule matches no digit sequence or currency symbol.
- LI-I15: loading `#/expenses?month=2026-10` lands on `#/money?month=2026-10`, and Back leaves the app rather than returning to `#/expenses`.
- LI-I16: in each ledger line the accessible name includes "came in", "spent" or "moved", and a greyscale screenshot comparison passes the axe colour rule.
- LI-I17: a build-output grep finds neither string; MonthMoney's reserve section is named "Cash reserve".
- LI-I18: the FireBusiness months (Nov 2025 to Oct 2026, two of them empty) give ₹14,40,000 on 13 November 2026; five complete months totalling ₹5,40,000 give ₹12,96,000 labelled "average of 5 months × 12"; a credit dated in the current month changes nothing until the month ends.
- LI-I19: a typed net profit of ₹6,00,000 with no salary is taxed on ₹6,00,000 with no standard deduction; a salary of ₹10,00,000 plus that profit takes ₹75,000 off the salary alone; a negative profit is refused with its reason; Business income credits in Money do not change the estimate.
- LI-I20: months of 1,30,000 ×3 then 1,42,000 ×3 give ₹1,42,000 (a tie, so the more recent); 1,30,000 ×4 then 1,42,000 ×2 give ₹1,30,000; six different amounts give the latest, and the screen says so; a seventh month drops the oldest from the count.
- LI-I21: pgTAP, select: a partner reads no `income_entry` of the owner's that the partner did not create; the owner reads a parent's row the owner typed; the parent's own login, once invited, reads it too.
- LI-I22: pgTAP: a partner reading `audit_log` sees no row for the owner's personal `credit_entry` or the owner's `income_entry`; the owner sees both.
- LI-I23: the §4 worked example plus a ₹32,000 EMI from HDFC (HDFC then down ₹11,620, so the cash reserve is down ₹13,420) gives spent ₹69,670, paid to loans ₹32,000, and saved ₹73,580 = ₹55,000 + ₹32,000 − ₹13,420.
