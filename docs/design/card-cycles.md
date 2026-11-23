# A card whose bill is made mid-month: its cycle in the month close

<!-- invariant-prefix: CY -->

Design only, 20 November 2026. The owner answered every question in §12 the same day
(§0). No application code and no migration is applied from this file until it is built in
the order of §10. Every change to another document is listed in §11 as an exact edit,
and each one is **proposed**.

## 0. When this applies, and when nothing changes

The owner's words, 20 November 2026: *"A card's amount due for the month close: we can have
a provision/config asking whether the credit card billing cycle doesn't close at the end of
month, and if not, the month closes with the credit card billing date and once the
statement is uploaded. The first time, the previous half month or one month's spend will be
left out; from the consecutive month it will tally with the months."* And, the same day:
*"this design is required if a user holds a credit card and a mixed billing cycle; consider
it for all users in the household. If there is no credit card, or the billing cycle ends in
the month, the existing design holds good."*

So:

- **A household with no card, or whose cards all close at month end, sees no change at
  all.** Every figure, screen and invariant is exactly today's (CY-I1). The setting
  defaults to month end, and nothing asks about it unless a card exists.
- **The rule is per card, for every member's cards.** Every account is the household's
  (LI-I27), so a statement-date card of any member, owner, partner or contributor, is in
  the household's close. Cards can be mixed: one closing on the 17th, one on the 3rd, one
  at month end. Each card follows its own setting, and bank accounts are always on the
  calendar month.
- **Also decided on 20 November 2026:**
  - editing a payee, date or amount in the import preview is not needed;
  - a bank payment to a card need not be counted (it stays a skipped card repayment, as
    `plan.ts` does today).

  §4 shows what that second decision means for a statement-date card.
- **The owner's answers, 20 November 2026** (§12, questions 1, 2, 3 and 6):
  1. *"If previous balance available, yes."* A statement's printed previous balance opens
     its cycle (§3).
  2. *"Keep skipping and show a note. Also, sometimes the bill amount will be converted to
     EMIs as well."* Card payments stay skipped, and the month card says what that does
     (§4). A bill or purchase converted to EMIs is covered in §4a.
  3. *"Yes, typing can be done, but [check] whether a duplicate check can be done if an
     upload also happens."* A due can be typed, and an upload for the same cycle replaces it
     and says so (§5).
  4. *"Yes, the owner has control to close."* An owner or a partner may close a month
     without a card's statement; the card is left out of that month until its statement
     arrives (§2.4).
- **The owner's further answers, 20 November 2026** (§12):
  - **7, the statement day:** *"yes, can."* It is learnt from the statements, and nothing
    asks for it.
  - **8, offering the switch in the preview:** *"yes."*
  - **9, a contributor's own card:** *"yes, ideally it should be as per card. If they give
    a different date, the app is not responsible for incorrect data."* Each card's owner
    sets it, and the app uses the dates the statements and the person give it.
  - **10, a bill converted to EMIs:** *"converted amount as spent."* The converted amount
    counts as spent in the cycle it was converted, and its instalments as paid to loans
    (§4a).
  - **4, from when and switching back:** *"No real data is available now, only demo data,
    and checking is happening, so we need not consider old-data correction scenarios for
    now."* A card's cycle can be switched either way at any time, and it applies to every
    month (§6). Protecting closed months on a switch is deferred (§6.1, `docs/later.md`).

## 1. The problem, in the code as it is

`closedMonthFigures` (`src/domain/money-month.ts`) needs, for every account, an opening and
a closing balance at the two calendar month ends. For a card, the balance is the amount
due. `closeFigures` (`src/features/money/closeMonth.ts`) reads them with `balanceOn(…,
lastDayOf(month))`, the balance dated exactly that day.

A card statement is dated on its billing day, usually mid-month. `statedBalances`
(`src/domain/statement/statedBalance.ts`) records only balances dated on a month's last day,
because the cash reserve takes an account's latest balance on or before a month end, and a
mid-month due would be read as the month end's. So a mid-month card statement gives the
close nothing, and the person must type a month-end due that no document prints.

## 2. The model

### 2.1 The setting

**A card has a cycle:** *ends at month end* (the default, today's behaviour) or *ends on
its statement date*. A bank account has no choice: it is always month end. A card on its
statement date uses it for every month (§6).

The boundaries are **the dates of the card's own statements**, as recorded balances. They
are not a stored day number:

- a cycle's closing is the amount due on a statement date;
- its opening is the amount due the day before the statement's period begins. That is the
  statement's own printed previous balance where it has one (decided, §3). Otherwise it is
  the due on the statement before.

Because most statements carry their own opening, **each cycle stands on its own.** A
statement uploaded late, out of order, or after a missed month still gives its cycle in
full.

A bank can move a statement date by a day for a holiday, and the close follows the
document, not a calendar rule.

### 2.2 Which cycle belongs to which month

**A month M takes, for a statement-date card, the cycle that ends on the latest statement
dated in M.**

- The card's **window** for M runs from its statement's period start to its statement
  date: `(the day before the period, statement in M]`. Without a printed period, it runs
  from the day after the previous statement.
- **Its money in is counted by that window, not by the calendar month:** its credits
  (refunds), the transfers into it, and holding take-outs. Every other account stays on M.
- **A transfer has two legs.** Its out-leg is counted in the window of the account it left,
  and its in-leg in the window of the account it reached. With a single date on the
  transfer, the two legs fall in different months only when the money reached a
  statement-date card after its statement date.

The card's `left` is unchanged in form: `due at the window's end − due at its start + money
in during the window`. That is its purchases, charges, interest and fees in the cycle.

```
spent (M) = Σ left of the bank accounts over M
          + Σ left of each month-end card over M
          + Σ left of each statement-date card over its window ending in M
          + outside − own transfers out − money into holdings − refunds − paid to loans
            (each counted in the window of the account it touches)
```

**In words:** spent in October is the banks' spending in October, plus each such card's
purchases in the cycle that ended in October.

### 2.3 The cash reserve uses the same two figures

`household_cash_reserve(as_of)` already takes each account's latest balance on or before
`as_of`. For a statement-date card, that is exactly the due on the statement dated in the
month: the close's closing. So the reserve as at 31 October is the banks on 31 October less
the card's due on 17 October. The function needs no change, and the close's change in cash
reserve uses the same pair of figures (CY-I9).

### 2.4 Waiting for the statement

**The month waits for each statement-date card's statement dated in it** (CY-I3). The close
already lists missing balances. For such a card, the line says what it is waiting for, in
words (§8).

**The owner has control to close** (decided, 20 November 2026). An owner or a partner may
close the month without a card that is still waiting. It is a choice on the waiting card's row
inside the close, **saved with the close and not before it: Cancel leaves nothing behind**, so a
month never shows as closed because someone cancelled a close (the owner, 23 November 2026). A
contributor reads the choice for the cards they can read, so their month stops saying *waiting*;
only an owner or a partner makes or undoes it.

- The close offers *Close without HDFC Regalia*, with one line saying what that does.
- That card adds nothing to the month. A payment made to it from a bank account in the
  month is already in the bank's spending, because card repayments are skipped (§4), so
  it stands in for the card's purchases, as a cash withdrawal does for cash.
- The month card says so, in words: *HDFC Regalia not in this close: its statement is not
  imported. Payments to it this month count as spent instead.*
- **When the statement arrives later, the month corrects itself.** Spent is derived, never
  stored (SC-I1). The card's cycle then counts, and the *not in this close* line goes.
  Nothing has to be reopened.
- The choice is recorded per card and month (§6, `close_without_card`), so the month is
  shown as closed and the waiting line stops asking. A contributor cannot make it, as
  only an owner or a partner closes the month (`spending-capture.md` §9, decision 5).

**A month with no statement dated in it.** A card whose bill falls on the 1st or the 31st
can skip a short month: billed on 31 January, then 1 March, with none in February.
Proposed:

- February waits like any month, and the owner can close it without the card (above).
- Once March's statement arrives, and its period began on 1 February (its previous
  balance is dated 31 January), the app knows no statement was dated in February. February
  then says *No statement dated in February: this card's spending is in March's close*,
  and the waiting line goes by itself.
- March's window covers that statement's whole period.

This needs no stored day number, because each statement says its own period.

## 3. The first statement

The owner accepted that the first cycle is left out, because there is no earlier statement
to open it. **Most card statements print the previous balance.** `CardFigures` already
parses it as `previousBalanceMinor`, for ICICI and Axis cards today. That figure is the
amount due on the previous statement date, which is the day before the period starts.

**Decided by the owner, 20 November 2026: *"if previous balance available, yes."*** It is
recorded as the card's balance on that day, source `statement`, basis `opening`. Then:

- the first uploaded statement's own cycle is counted, and nothing of it is left out;
- what is left out is the cycle **before** it, which no statement in the app covers. That
  month's close says *This card starts with its statement of 17 November; its spending
  before 18 October is not in the app.*

**When there is no previous balance** (a typed due, or a format that does not print one),
the owner's first rule holds. The first cycle's opening is taken as its closing, so the card adds
nothing that month (and the arithmetic still balances), and the close says *First cycle of
this card (18 Oct – 17 Nov) left out: there is no earlier statement to start from. From
December it is counted in full.*

## 4. Card payments: where the timing lands

The model given for this design said the identity `saved = invested + paid to loans +
change in cash reserve` (LI-I23) holds only to within the timing of card payments. That is
true only when a card payment is recorded as a move between own accounts. Under the owner's
decision of 20 November it is not: the import skips it on both statements (`plan.ts`: *a
card repayment*). The two cases behave differently.

| A payment to the card is… | Spent in a month | The split |
|---|---|---|
| **skipped (today's import; the owner's decision)** | Off by payments made after the card's statement date in the month: they read as spent this month, and come back off next month. Over two months it nets to zero. | Adds up to saved exactly (gap 0): the timing is inside spent, so nothing is left over for the split. |
| **recorded as a move** (typed, or a future import that records it) | Exact: the banks' spending in the month plus the card's purchases in its cycle | Off by the same payments, which left a bank in the month and reach the card next cycle. A line of its own carries them, so the split adds up to saved exactly (§7). |

Why: a skipped payment lowers the bank's balance in October and the card's due in
November. October's `left` therefore has the payment on the bank side and not on the card
side.

**Decided by the owner, 20 November 2026: keep skipping, and show a note.** The first row of
the table is the rule.

- Every closed month that has a statement-date card carries one line under Spent: *A card
  payment made after a card's statement date counts in this month, and comes off the
  next.* There is no figure, because a skipped payment is not stored.
- Over any two months running, spent is the same as an exact count. Months of cover uses
  twelve months, so it is unaffected in practice (§8.4).
- **A payment typed by hand as a move** (Money → *+ Money in*, *From my own account*)
  still counts in each account's own window. Its timing then shows on the split's line of
  its own (§7), and only then.

### 4a. A bill or a purchase converted to EMIs

The owner, 20 November 2026: *"sometimes the bill amount will be converted to EMIs as
well."* A card can turn a purchase, or part of a bill, into monthly instalments. The card
statement then shows:

- a credit that takes the converted amount off what is due (*EMI conversion* or *Loan on
  card*);
- each month, a charge for the instalment's principal, and separate charges for its
  interest and GST.

**Decided by the owner, 20 November 2026: *"converted amount as spent."*** The converted
amount counts as spent in the cycle in which it was converted, like any purchase, and is
not spread over the instalments.

**How the close does it.** Left to the balances, a conversion lowers the due (the credit),
so that cycle would read low; each instalment then raises it, so later cycles would read
high. The close corrects both, from two figures each card statement gives for its cycle:

- **converted**: the conversion credits, the amount moved off the bill into an EMI plan;
- **EMI principal billed**: the principal part of the instalments charged this cycle. The
  interest and GST on an instalment are ordinary charges, and stay spent.

```
left (a card, its cycle) = due at end − due at start + money in
                           + converted − EMI principal billed
paid to loans (month)    += EMI principal billed − converted     (on the card's own line)
```

- **Spent** gets the converted amount back in its cycle: the purchase counts in full, as
  the owner decided. It does not get the instalments' principal later, because they repay
  a purchase already counted.
- **The split stays exact** (gap 0, LI-I23). The card's plan is a debt: borrowing on it in
  a month shows as negative *paid to loans*, and each instalment's principal as paid to
  loans. Over the plan's life the two cancel.
- **The cash reserve's level** stays banks less card dues. The unbilled plan is not yet
  due, but it is owed, so it belongs with the household's debts.

**A card's EMI plans are a debt, recorded with the household's loans** (the owner, 20
November 2026: *"whether we are capturing loan and debt; if so, card loan also can add to
it"*). The app already records debts:

- `liability`, whose kinds include *credit card*, with its outstanding and its date;
- `loan_payment`, which counts as *paid to loans* in the month (`ledger-income.md` §4c);
- every debt is in net worth.

So:

- **One debt per card, made from its first conversion.** It is named *HDFC Regalia ••1188 —
  EMI plans*, kind *credit card*, for the card's member, and linked to the card account
  (`liability.card_account_id`, §6). The statement's preview adds it, ticked: *Add the
  ₹60,000 converted to EMIs to your debts as "HDFC Regalia — EMI plans"*. A person can
  untick it. Every later plan on the same card goes into the same debt.
- **Its outstanding follows the card's statements**, and is never typed: after each
  statement, outstanding = outstanding before + converted − EMI principal billed, as at
  the statement date. A plan begun before the card's first statement in the app starts
  from what that statement prints as *EMI outstanding*, where it prints it, or from a
  typed figure.
- **Counted once.** A linked card debt's instalments are paid to loans through the card's
  statement figures (above). No `loan_payment` is made for them. One typed against it by
  hand is refused with a sentence saying why, since the instalment is already counted
  from the card (CY-I17).
- **Net worth** then has the card's due in the cash reserve, and its unbilled plans under
  debts. Nothing is counted twice: the due holds only the instalments billed, and the debt
  holds only what is still to be billed.
- **Closing the debt:** when the outstanding reaches zero, the debt is marked closed, on
  the statement date that took it there. It reopens by itself if the card converts again.
- **Without the debt** (unticked), the close's figures are the same. Only net worth
  leaves out the unbilled plans, and the Accounts row of the card says *EMI plans not
  in your debts*.
- **The itemised list now agrees:** the purchase is an expense on its own date, and the
  instalment's principal is not an expense, while its interest and GST are (the import's
  rules of 19 November). So *from balances* and *itemised* no longer differ by a
  conversion.
- **A plan begun before the card's first statement in the app** has no conversion in any
  window. Its instalments' principal is still taken off spent, because it repays a
  purchase made before the app had the card. That is right for the months shown, and the
  first close with such an instalment says so once: *Includes EMI instalments of a plan
  that began before this card's first statement: their principal is not counted as
  spent.*

**On the screen.** Under Paid to loans, for a month with a card EMI:

- *Card EMIs: ₹60,000 converted (now owed), ₹5,000 of instalments paid*;
- the month of a conversion reads *Paid to loans −₹55,000*, with that line beneath it;
- the sign is a minus and the words say why, never colour alone.

**Where the two figures come from:**

- **An imported statement:** the card parsers already tell an instalment's principal from
  its interest (the import's rules). They add the conversion credit, which is today read
  as a refund and must not be. Both totals are stored with the statement's due (§6).
- **A typed due:** two optional fields, folded under *EMIs on this bill?*, called
  *Converted to EMIs this cycle* and *EMI principal billed this cycle*. Left empty, both
  are 0.
- **A month-end card** whose statement is dated on a month end gets the same correction.
  For a month-end card whose due is typed, the same two fields are offered.

**Built, 23 November 2026** (slice 7, second part): the debt is a `credit card` liability linked to the card, one per card, offered by the statement's preview (ticked) and from the card's row on Accounts, named from the card, and kept after each import and close from the card's recorded dues, those the close reads. Its outstanding is written to the liability's own balance and date, as at the card's latest statement, and is never typed. It is closed when it is nothing and open again when the card converts again. A payment typed against it is refused in the Plan list and by the database. Not built: the statement's printed *EMI outstanding* and a typed start figure.

## 5. The import side (`statedBalance.ts`)

- **For a card on its statement date**, `statedBalances` records:
  - `due` on the statement date;
  - `opening` (the printed previous balance) on the day before the period starts.

  Both have source `statement`, whatever day of the month they fall on. The month-end
  filter stays for every other account.
- **A month-end card is unchanged.** It records nothing unless its statement is dated on a
  month's last day.
- **The preview says what the statement does**, in one line under the card's total due:
  - *Amount due ₹28,640 on 17 Oct. It closes October for this card.* (statement date)
  - *Dated 17 Oct, not a month end, so it gives the close nothing. Does this card's bill
    close mid-month? [Use the statement date for this card]* (month end, mid-month
    statement). The action opens the setting (§8.1) and does not change it silently.
- **Re-importing the same statement** changes nothing. A balance is unique per account,
  day and source (`account_balance_one_per_day_and_source`), and a statement's balance
  replaces the same statement's. A corrected statement for the same date replaces the
  earlier statement's figure, and the audit log keeps both.
- **A typed due and an uploaded statement for the same cycle** (decided, 20 November 2026:
  typing is allowed, with a duplicate check):
  - **One cycle, one figure.** For a statement-date card, a statement-sourced due dated
    in the month beats a typed one dated in the same month, **whatever day each is
    dated**. A typed 17 Oct and a statement of 18 Oct are the same cycle, and the
    statement is used (CY-I13). The typed row is kept, for the audit trail, and is no
    longer read.
  - **Uploading after typing:** the preview says *You typed ₹28,640 due on 17 Oct for this
    card. This statement says ₹28,640 on 18 Oct and will be used in its place.* When the
    figures differ, it says by how much, in words. It never asks the person to choose,
    because the statement is the document.
  - **Typing after uploading:** the close shows the statement's figure, with no input, and
    *From its statement of 18 Oct*. There is nothing to type, so there is nothing to
    duplicate.
  - **The opening, typed:** a typed due has no printed previous balance, so its cycle opens
    from the cycle before (§2.1). A first typed cycle is left out, as §3 says.
- **Statements out of order** (November uploaded before October) are fine. Windows are
  worked out from all of a card's statements whenever the close is read; nothing is stored
  per window.

## 6. The schema (proposed; not applied)

On `public.account`:

- **`cycle_ends`**: `month_end` (default) or `statement`. A database check refuses
  `statement` on anything but a card (CY-I8).
**Who may change it:** whoever may change the account. That is an owner or a partner for
any card, and a contributor for their own (`ledger-income.md` §1a; the owner, 20 November
2026). It is audited like any column of `account`, by the trigger the table already has.

**A change applies to every month, both ways, at any time** (the owner, 20 November 2026:
only demo data exists, so old-data correction is not considered now). Spent is derived,
never stored, so a switch simply works every month out again under the new rule. Balances
already recorded are kept whichever rule is in force; each rule reads the ones it needs.

### 6.1 Deferred: protecting closed months when real households switch

**A launch blocker** (the owner, 23 November 2026): `commercial-launch.md` section 11 requires it before the first real, non-demo household. Once it is built, the import's *Use the statement date* applies from the first open month.

Written down so it is not lost, and **not built now**. It is also in `docs/later.md`.
Before real households use the app, a switch should leave months already closed as they
were. That needs:

- a `cycle_from` month;
- a trigger refusing a start before the last month-end close;
- switching back allowed only until a statement under the rule is in use;
- the first statement window opening from the later of its previous-balance date and the
  last month-end due, so no day is counted twice.

The example the owner asked for, kept for that day: a card billed on the 17th, closed at
month end with dues of ₹15,000 on 30 September and ₹24,000 on 31 October, switched on 20
November.

- November's window would run from 1 to 17 November, opening at the 31 October due, not
  from 18 October.
- December's window would be one full cycle, 18 November to 17 December.
- Switching back would be refused once the 17 November statement was in use.

**LI-I26 is unchanged.** Type and currency stay fixed once an account has history. The
cycle is not part of that rule.

```sql
-- Family Finance Buddy — a card's cycle: month end (as today) or its statement date
-- (docs/design/card-cycles.md).
--
-- FOR REVIEW. Not applied. Shown before any screen is built on it (CLAUDE.md).
-- `account` already has row-level security, its grants, the second-factor policy and its
-- audit trigger, so nothing about access changes: whoever may update an account may set this.
-- A household with no card on its statement date sees no difference anywhere (CY-I1).

alter table public.account
  add column cycle_ends text not null default 'month_end'
    check (cycle_ends in ('month_end', 'statement'));

alter table public.account
  add constraint account_cycle_only_for_a_card
    check (cycle_ends = 'month_end' or type = 'card');

comment on column public.account.cycle_ends is
  'When a card''s month closes: at month end (default) or on its statement date. Always month_end for a bank account.';
-- A switch applies to every month, both ways (the owner, 20 November 2026: demo data only for now).
-- Protecting closed months on a switch is deferred: card-cycles.md 6.1 and docs/later.md.

-- The export lists `account` already; its two new columns are added to the complete backup's Accounts sheet
-- (and to the report's Accounts sheet as "Bill closes": "Month end" or "On its statement date"), in the same change.
-- A pgTAP file beside this one proves: a bank account cannot be set to statement, and a contributor can set it
-- on their own card and not on another's.

-- ═══════════════════════════════════════════════ account_balance: a card cycle's EMI figures (§4a)
-- Stored with a card's due: the amount converted to EMI plans in the cycle, and the principal of the instalments
-- billed in it. Zero for a bank account, and for a card cycle with no EMI. Typed or from the statement, as the due is.

alter table public.account_balance
  add column emi_converted_minor bigint not null default 0 check (emi_converted_minor >= 0),
  add column emi_principal_minor bigint not null default 0 check (emi_principal_minor >= 0);

comment on column public.account_balance.emi_converted_minor is
  'For a card due: what was converted to EMI plans in the cycle ending on this date. Counted as spent in that cycle (card-cycles.md 4a).';
comment on column public.account_balance.emi_principal_minor is
  'For a card due: the principal of the EMI instalments billed in the cycle. Paid to loans, not spent; their interest and GST are spent.';

-- ═══════════════════════════════════════════════ liability: a card's EMI plans as a debt (§4a)
-- One debt per card, kind credit_card, linked to the card account; its outstanding follows the card's statements.
-- liability already has its audit trigger, RLS, grants and second-factor policy.

alter table public.liability
  add column card_account_id uuid;

alter table public.liability
  add constraint liability_card_account_in_household_fkey
    foreign key (household_id, card_account_id) references public.account (household_id, id) on delete restrict,
  add constraint liability_card_account_only_for_credit_card
    check (card_account_id is null or kind = 'credit_card');

create unique index liability_one_emi_debt_per_card
  on public.liability (card_account_id) where card_account_id is not null;

-- CY-I17: a card debt's instalments are counted from the card's statements, never as loan payments too.
create or replace function app.loan_payment_not_on_a_card_debt()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if exists (select 1 from public.liability l where l.id = new.liability_id and l.card_account_id is not null) then
    raise exception 'This debt''s instalments come from its card''s statements, so a payment is not typed against it.'
      using errcode = '23514';
  end if;
  return new;
end; $fn$;
create trigger loan_payment_not_on_a_card_debt before insert on public.loan_payment
  for each row execute function app.loan_payment_not_on_a_card_debt();

-- ═══════════════════════════════════════════════ close_without_card (the owner's control to close, §2.4)
-- An owner or a partner closed a month without a statement-date card's statement. The card adds nothing to that
-- month until its statement arrives, when the month corrects itself and this row is simply no longer needed.
-- Never deleted: undone by voiding, as a figure relied upon is (the standing rule).

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

create unique index close_without_card_one_live
  on public.close_without_card (account_id, month) where voided_at is null;

create trigger close_without_card_touch_updated_at before update on public.close_without_card
  for each row execute function app.touch_updated_at();
create trigger close_without_card_audit after insert or update or delete on public.close_without_card
  for each row execute function app.audit_row();

-- Only a card that closes on its statement date, and only a month that has ended (the date is passed in by
-- the caller's insert, and checked against IST in a trigger, never read from a clock in the app).
create or replace function app.close_without_card_check()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if not exists (select 1 from public.account a
                  where a.id = new.account_id and a.type = 'card' and a.cycle_ends = 'statement') then
    raise exception 'Only a card whose bill closes on its statement date can be left out of a close.' using errcode = '23514';
  end if;
  if new.month >= date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date then
    raise exception 'A month can be closed only once it has ended.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.account_id, new.month, new.created_by) is distinct from (old.account_id, old.month, old.created_by) then
    raise exception 'A close without a card is voided and made again, never edited.' using errcode = '23514';
  end if;
  return new;
end; $fn$;
create trigger close_without_card_check before insert or update on public.close_without_card
  for each row execute function app.close_without_card_check();

alter table public.close_without_card enable row level security;
alter table public.close_without_card force row level security;
grant select, insert, update on public.close_without_card to authenticated;   -- no delete

-- Read by every member who can read the household's close; written only by an owner or a partner,
-- as only they close a month (spending-capture.md section 9, decision 5).
create policy close_without_card_read on public.close_without_card for select to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'));
create policy close_without_card_write on public.close_without_card for insert to authenticated
  with check (app.household_role(household_id) in ('owner', 'partner'));
create policy close_without_card_void on public.close_without_card for update to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'))
  with check (app.household_role(household_id) in ('owner', 'partner'));
create policy close_without_card_second_factor on public.close_without_card as restrictive for all to authenticated
  using (app.has_second_factor()) with check (app.has_second_factor());

-- In the same migration: a line in reset_demo_household that clears it, and an entry in the export list
-- (the complete backup only; the report shows it as the month card's words). pgTAP: a contributor and a
-- viewer are refused every verb; a bank account and a month-end card are refused; an open month is refused;
-- a second live row for the same card and month is refused; a delete is refused for every role.
```

**The names of the helper functions** (`app.audit_row`, `app.touch_updated_at`,
`app.household_role`, `app.has_second_factor`) are the ones the existing migrations use.
The build checks each against the latest migration before writing the file.

`household_private_close` is the one database function the close reads that counts by
calendar month. It is replaced in **slice 3** (§10), in a migration of its own:

- money into a statement-date card that the caller cannot read (a private refund) is
  counted by the card's window;
- its signature and its "totals only, no account, no date" promise (LI-I31) are unchanged.

## 7. The split, and LI-I23

Today, *saved = invested + paid to loans + change in cash reserve*, to the paisa, and
`gapMinor` is the bug detector (it must be 0).

**Proposed:** a fifth part, **card payments in transit**. It is the sum of transfers whose
out-leg is in this month and whose in-leg is in a statement-date card's next window, less
those whose in-leg is in this month and whose out-leg was in the month before.

```
saved = invested + paid to loans + change in cash reserve + card payments in transit
```

- It is exactly zero for a household with no statement-date card, and for every month in
  which no payment reached a card after its statement date.
- It is shown only when it is not zero, as *Paid to a card, counted in its next cycle
  ₹6,240* (or *…counted from last cycle −₹6,240*).
- `gapMinor` stays, and stays 0.
- Over consecutive months the line telescopes: its sum over any run of months is the
  payments still in transit at the end of the run.

With skipped payments (§4, decided) this line is zero. It is not zero only for a payment
typed by hand as a move, so most households never see it, and spent carries the note
instead.

## 8. On the screen

Words carry every state; nothing is colour alone. No text sits in a fixed height, and
every line wraps at 200% text (`simple-layout.md`). Tokens and icons are as built:

- the caveat marker (a circle with a lowercase *i*) for a note;
- no new icon;
- the calendar mark the close already uses (`conformance.md`, *Needs attention*) for
  *waiting for its statement*.

**Pictures.** `docs/design/card-cycles-boards.html`, and the same boards on the canvas,
each at 375px in Linen and dark (20 November 2026):

| Board | Shows |
|---|---|
| CardSetting | Add an account with the card's *When does this card's bill close?*, and the Accounts rows (§8.1) |
| CloseCardRows | The close, step 1: a card cycle from its statements; waiting; typing the amount due (with EMIs); the first cycle from the previous balance; the first cycle left out; not in this close (§8.2) |
| CloseCardRows200 | The same rows at 200% text, Linen |
| CloseWithoutCard | The owner or partner closing without a card, with its confirmation; a contributor, who can import but not close |
| MonthCardCycle | The closed month by its cycle with the payment-timing note; a card left out; November's EMI conversion under *Paid to loans* (§8.3, §4a) |
| ImportCardPreview | The preview of a card statement: it closes the month and replaces a typed due; a month-end card dated mid-month, offering the switch; an EMI conversion added to debts, ticked (§5, §4a) |

Where a board and this section differ, this section wins.

### 8.1 The setting: Add an account, and the account's row

On **AddAccount**, when *Type* is *Card*, one more field appears after *Whose*:

> **When does this card's bill close?**
> ( At month end ) ( On its statement date )
> *Most cards make their bill mid-month, on the same day each month. Choose "On its
> statement date" and each month closes with that statement, once you import it.*

- It is two ovals, with *At month end* pressed by default. It is not required, because it
  has a default.
- **The Accounts row** of such a card reads: *Card · Meera · bill closes on its statement
  date (17th lately)*. The day is the latest statement's, shown once one exists; before
  that, *bill closes on its statement date*.
- Changing the setting on an existing card says what it does before saving: *Every month
  will be worked out again with this card's statements.*

### 8.2 The close (MonthClose)

Each statement-date card's row in step 1 shows its cycle, not month ends:

| State | What the row says |
|---|---|
| Waiting | **HDFC Regalia ••1188 · Venkatesh** — *Waiting for its statement dated in October (lately the 17th). Import it from Money → Import a statement.* The close's *ready* line counts it among the missing. |
| Ready | *Cycle 18 Sep – 17 Oct · due ₹20,200 → ₹28,640, from its statements.* There are no inputs: the figures are the statements'. |
| First cycle, previous balance printed | *Cycle 18 Oct – 17 Nov · started from the statement's previous balance.* |
| First cycle, none printed | *First cycle left out: there is no earlier statement to start from. From December it is counted in full.* |
| No statement dated this month (§2.4) | *No statement dated in February: this card's spending is in March's close.* |

| Closed without it (§2.4) | *Not in this close: its statement is not imported. Payments to it this month count as spent instead.* There is an *Undo* action for an owner or a partner, which voids the choice. |

**Typing a statement-date due** (decided, 20 November 2026). The row's *Waiting* state offers
*Type the amount due instead*, which opens two underline fields: *Amount due* and
*Statement date*, which must fall in the month. It is recorded as `typed`. The duplicate
rules are in §5: an uploaded statement for the same cycle replaces it, and says so in the
preview. With a statement already in, there is nothing to type.

**Closing without a card** (decided, 20 November 2026). For an owner or a partner, the
footer's status reads *October is waiting for 1 card statement*. *Close October* then
offers two choices:

- *Import a statement*;
- *Close without HDFC Regalia*.

The second asks once: *HDFC Regalia's October cycle will be left out until its statement
is imported. Payments to it this month count as spent instead.* The choices are *Close
without it* and *Cancel*. A contributor sees the waiting line and *Import a statement*
only.

### 8.3 The Money month card, and Last month

- **Under Spent, for a closed month with any statement-date card:** *from balances, 3 of 3
  accounts · 1 card by its cycle (18 Sep – 17 Oct)*. With two cards: *2 cards by their
  cycles*. The cycles are listed in the close.
- **Always, for a closed month with a statement-date card** (decided: payments skipped),
  one caveat line: *A card payment made after a card's statement date counts in this
  month, and comes off the next.*
- **A card bill converted to EMIs** (§4a): under Paid to loans, *Card EMIs: ₹60,000
  converted (now owed), ₹5,000 of instalments paid*.
- **A card left out by the owner** (§2.4): *HDFC Regalia not in this close: its statement
  is not imported.* It goes by itself when the statement arrives.
- **A payment typed by hand as a move** adds the split's fifth line (§7) when it is not
  zero.
- **Waiting:** the footer's status line reads *October is waiting for 1 card statement*,
  with *HDFC Regalia, dated in October* under it. *Import a statement* is offered, and for
  an owner or a partner, *Close October* offers *Close without HDFC Regalia* (§8.2).

### 8.4 Months of cover and the Overview

**Decided by the owner, 23 November 2026: months of cover reads the close.** Each month uses its best source: from balances, then stated, then itemised, and the caveat counts them. It is its own slice, with a test that a month-end-only household's figure equals the close's spent.

**Built, 23 November 2026** (`src/features/overview/useMonthsOfCover.ts`, `coverFigures.ts`, `src/domain/spend-source.ts`): for an owner or a partner, a month closed from balances is read as the close reads it, each currency on its own; a contributor cannot read every account, so their months stay stated or itemised. The caveat's parenthetical for a first cycle left out is not built; it is a `proposed` row in `conformance.md`.

- **Months of cover** (PF-C9) reads each month's spent as the close gives it.
  - A month whose card cycle was left out (§3) reads low, as an itemised-only month does.
    The caveat counts it: *Of the last twelve months: 9 from balances (1 with a card's
    first cycle left out), 3 stated.*
  - With skipped payments, the month-to-month timing nets out over the window and needs
    no caveat.
- **Overview's Saved and Invested lines.** Saved is *came in − spent*, as the close gives
  it. Invested is unchanged: holdings' entries by date (SC-I11), which no cycle touches.
  The month's split there shows the fifth part when it is not zero.

## 9. Worked example: October, with a card billed on the 17th

The example in `ledger-income.md` §4, test LI-I6, is extended to a mid-month card. Figures
are in rupees, with paise in brackets; all are integers in paise in the code.

**The card**, *HDFC Regalia*, closes on its statement date:

- statement of 17 September: due ₹20,200 (2020000);
- statement of 17 October: due ₹28,640 (2864000);
- October's window is 18 Sep to 17 Oct;
- in the window: purchases ₹21,739 (2173900), a payment received on 5 Oct of ₹12,000
  (1200000), and a refund on 10 Oct of ₹1,299 (129900);
- 20200 + 21739 − 12000 − 1299 = 28640.

**The banks**, calendar October:

- HDFC: Salary ₹1,42,000 (14200000) in. Out: into holdings ₹55,000 (5500000), card payments
  of ₹12,000 on 5 Oct and ₹6,240 (624000) on 25 Oct, and spending ₹48,380 (4838000). HDFC is
  up ₹20,380 (2038000).
- SBI: Interest ₹1,250 (125000) in, spending ₹850 (85000), so up ₹400 (40000).

**(a) The payments typed as moves** (possible, not the usual path):

- **left:** HDFC 1,42,000 − 20,380 = **₹1,21,620** (12162000); SBI **₹850**; card 28,640 −
  20,200 + (12,000 + 1,299) = **₹21,739** (2173900). In total, **₹1,44,209** (14420900).
- **own transfers out**, HDFC in October: 12,000 + 6,240 = ₹18,240 (1824000). Each out-leg
  is in HDFC's October. The 25 Oct in-leg is in the card's next window.
- **spent** = 1,44,209 − 18,240 − 55,000 − 1,299 = **₹69,670** (6967000), as in the calendar
  example. That is the banks' 48,380 + 850, plus the card's purchases of 21,739, less the
  1,299 refund.
- came in **₹1,43,250**, so saved **₹73,580** (7358000).
- change in cash reserve = 20,380 + 400 − (28,640 − 20,200) = **₹12,340** (1234000).
- invested ₹55,000, paid to loans ₹0, card payments in transit **₹6,240**.
- 55,000 + 0 + 12,340 + 6,240 = **₹73,580**, so the gap is 0.
- **November:** the 6,240 in-leg falls in the card's window 18 Oct – 17 Nov. November's in
  transit is −6,240 plus any payment made after 17 November. The months telescope.

**(b) The payments skipped** (today's import, and the owner's decision of 20 November):

- The card's money in for the window is only the refund. Its left is 28,640 − 20,200 +
  1,299 = ₹9,739 (973900).
- HDFC's left is unchanged at ₹1,21,620, and there is no own transfer.
- **spent** = 1,21,620 + 850 + 9,739 − 55,000 − 1,299 = **₹75,910** (7591000). That is ₹6,240
  more than (a): the 25 Oct payment, made after the statement date.
- saved = 1,43,250 − 75,910 = **₹67,340** = 55,000 + 0 + 12,340, so the gap is 0.
- **November** reads ₹6,240 less than (a) would, and over the two months spent is the same.

**(c) No card on its statement date:** the household's October is exactly the LI-I6
figures, ₹69,670 from month-end balances (CY-I1).

## 10. Order of work: migrations and slices

Each slice is vertical, has its tests first for anything numeric, and its own pull request.

1. **The migration (§6), for review.**
   - Gate: the pgTAP file passes in CI, the owner has seen the SQL, and no screen reads the
     column yet.
2. **The domain, tests first.**
   - `money-month.ts` gains per-account windows: `MonthAccount` carries `windowFrom` and
     `windowTo` (the calendar month for a bank or a month-end card), and money in,
     transfers, refunds, holding moves and loan payments are counted by each account's
     window. `MonthFigures` gains `paymentsInTransit`.
   - `closeMonth.ts` works out each statement-date card's window from its balances (§2.2,
     §2.4, §3) and reports *waiting*, *first cycle* and *no statement this month*.
   - Gate: CY-I1's test (every existing `money-month` and `closeMonth` test passes
     unchanged with no statement-date card), and the §9 examples (a), (b) and (c) to the
     paisa.
3. **`household_private_close` by window**, in a migration of its own.
   - Gate: its pgTAP shows a private refund on a statement-date card counted in the
     card's window, and LI-I31 still holds.
4. **Import:** `statedBalance.ts` records `due` and `opening` for a statement-date card on
   their own dates, and the preview's line and its *Use the statement date* action.
   - Gate: re-importing a statement changes nothing; a month-end card records exactly what
     it does today.
5. **Screens:** the setting on AddAccount and the account's row, the close's rows (§8.2),
   the month card's lines (§8.3), and months of cover's caveat.
   - Gate: the CY tests below, axe, and the 200% text check; conformance rows recorded as
     proposed.
6. **Closing without a card, and the duplicate check:**
   - the `close_without_card` table, in its own migration, for review;
   - the close's *Close without* choice and *Undo*;
   - the typed due's fields;
   - the import preview's *replaces what you typed* line.
   - Gate: CY-I13 and CY-I14, and the pgTAP file.
7. **EMI conversions (§4a):**
   - the two `account_balance` columns, in a migration for review;
   - the card parsers recognise a conversion credit, and no longer read it as a refund;
   - the close's card `left` and paid to loans take the two figures;
   - the typed fields;
   - the `liability.card_account_id` link and its loan-payment guard;
   - the preview's ticked *Add … to your debts*;
   - the debt's outstanding kept from each statement.
   - Gate: CY-I15 and CY-I17, with the §4a example to the paisa, a gap of 0, and net worth
     counting the plan once.

## 11. Edits to other documents (all proposed; to apply with the build)

- **`ledger-income.md`, LI-I6:** after *transfers in and holding take-outs*, insert *,
  counted in the account's own window: the calendar month, or, for a card that closes on
  its statement date, its cycle ending in the month (`card-cycles.md` §2.2)*.
- **`ledger-income.md`, LI-I23:** *the split is spent, invested, paid to loans and to cash
  reserve, and the last three add up to saved to the paisa* becomes *the split is spent,
  invested, paid to loans, to cash reserve and, where a card closes on its statement date,
  card payments in transit, and the last four add up to saved to the paisa*.
- **`ledger-income.md` §4, `paid to loans`:** append *, plus a card's EMI principal billed
  less what it converted to EMIs in its cycle (card-cycles.md §4a)*.
- **`ledger-income.md` §4, the closed-month block:** under `left = due at end − due at
  start + money in (card…)`, add the line *for a card that closes on its statement date,
  "start" and "end" are its statements, and its money in is that cycle's
  (card-cycles.md)*.
- **`spending-capture.md` §2, the formula block:** the card line becomes *card left =
  amount due at end − amount due at start + payments made to it, where a card that closes
  on its statement date uses its statements (card-cycles.md §2)*. Add a bullet after
  *Opening is last month's closing*: ***A card can close on its statement date.** Its
  cycle ending in the month stands in for the calendar month, and the month waits for
  that statement (card-cycles.md).*
- **`spending-capture.md` line 239:** `cash reserve = savings and current account balances
  − card dues` becomes *… − card dues (each card's latest due on or before the day: its
  month-end due, or its last statement's)*.
- **`spending-capture.md`, SC-I12:** same change as LI-I23, adding *plus card payments in
  transit*.
- **`statedBalance.ts`, its header comment** (code, slice 4): the sentence *A card whose
  statement is not dated on a month end therefore states nothing; how a statement cycle
  maps to a month is for the owner* becomes *A card that closes on its statement date
  states its due on that date and its previous balance the day before its period;
  otherwise as above (card-cycles.md §5).*
- **`protection-and-flow.md`, PF-C9:** append *A month in which a card's first cycle was
  left out reads low, and the caveat counts it (card-cycles.md §8.4).*
- **`conformance.md`:** three rows, all proposed:
  - the card setting on AddAccount;
  - the close's card row by cycle;
  - the month card's *by its cycle* line and its caveat.

## 12. Questions for the owner

**Answered by the owner, 20 November 2026:**

1. **The first cycle:** *"if previous balance available, yes."* The printed previous
   balance opens the cycle, and the first cycle is left out only without one (§3).
2. **Card payments:** *"keep skipping and show a note."* Plus EMI conversions, now §4a.
3. **Typing a due:** *"yes, typing can be done,"* with a duplicate check against an
   upload (§5).
6. **Waiting for every card:** *"yes, the owner has control to close."* An owner or a
   partner may close without a card's statement, and the month corrects itself when it
   arrives (§2.4).

**Settled by the design, with nothing left to ask:**

5. **A month with no statement dated in it.** Each statement now carries its own opening,
   so a skipped month is recognised when the next statement arrives, and until then the
   owner may close it (§2.4).

**Answered later the same day:**

7. **The statement day:** *"yes, can."* It is learnt from the statements.
8. **The switch in the preview:** *"yes."*
9. **A contributor's own card:** *"yes, ideally it should be as per card; if they give a
   different date, the app is not responsible for incorrect data."*
10. **A bill converted to EMIs:** *"converted amount as spent"* (§4a).

4. **From when, and switching back:** *"no real data is available now, only demo data, so
   we need not consider old-data correction scenarios for now."* A switch applies to every
   month, either way. Protection is deferred (§6.1).

Nothing is open.

## Invariants

**CY-I1 — A household with no card on its statement date has every month's figures exactly as today,** to the paisa. It is asked about card cycles only when it imports a card statement dated off a month end, where the preview offers the switch in one line and nothing changes unless it is chosen (the owner, 23 November 2026). (§0, §5)

**CY-I2 — A statement-date card's money in, transfers in and refunds are counted in its window for the month,** from the day after its previous statement to its statement dated in the month; every other account is counted over the calendar month, and each leg of a transfer in the window of its own account. (§2.2)

**CY-I3 — A month waits for each statement-date card's statement dated in it,** unless a later statement shows that none was dated in that month, or an owner or a partner closed it without that card; the close names the card and the month it waits for. (§2.4, §8.2)

**CY-I4 — A statement-date card's first cycle opens from the statement's printed previous balance when there is one;** otherwise its opening is its closing, it adds nothing to that month, and the close says that its first cycle is left out. (§3)

**CY-I5 — Spent for a month is the banks' and month-end cards' spending over the calendar month plus each statement-date card's purchases over its window ending in the month,** less refunds, own transfers out, money into holdings and paid to loans, each counted once. (§2.2)

**CY-I6 — Saved equals invested plus paid to loans plus the change in cash reserve plus card payments in transit, to the paisa;** the last is zero with no statement-date card and with card payments skipped, is shown only when it is not zero, and its sum over consecutive months is what is still in transit at the end. (§4, §7)

**CY-I8 — Only a card can close on its statement date;** the database refuses the setting on a bank account. (§6)

**CY-I9 — The close's change in cash reserve and `household_cash_reserve` read the same figure for a statement-date card:** its latest due on or before the month's end. (§2.3)

**CY-I10 — `statedBalances` records a statement-date card's due on its statement date and its previous balance on the day before its period,** from the statement only; every other account's recorded balances are unchanged. (§5)

**CY-I11 — Every cycle state is said in words:** waiting for its statement, its cycle's dates, first cycle started from the previous balance or left out, no statement this month, and payments made after a statement date. (§8)

**CY-I12 — `household_private_close` counts what the caller cannot read on a statement-date card by the card's window,** and still returns no account, member, holding or date. (§6)

**CY-I13 — One cycle, one due:** for a statement-date card, a statement's due dated in a month is used over a typed one dated in the same month, whatever day each is dated; the typed row is kept and no longer read, and the import preview says it replaces what was typed. (§5)

**CY-I14 — A month closed without a card leaves that card's cycle out until its statement is imported, and then counts it without anything being reopened;** only an owner or a partner can close without a card, and the choice is voided, never deleted. (§2.4, §6)

**CY-I15 — An amount converted to EMIs counts as spent in the cycle it was converted, and its instalments' principal as paid to loans, not spent;** their interest and GST are spent, and the split still adds up to saved to the paisa. (§4a)

**CY-I17 — A card's EMI plans are one debt per card, linked to the card, whose outstanding follows its statements (before + converted − principal billed);** its instalments are counted as paid to loans from the card's statement only, and the database refuses a loan payment typed against it. (§4a, §6)

## Tests

- CY-I1: every existing test of `money-month.ts` and `closeMonth.ts` passes unchanged. A property test with random households of banks and month-end cards gives identical figures before and after the change.
- CY-I2: a refund on a statement-date card dated 10 Oct counts in October's window (18 Sep – 17 Oct); one dated 20 Oct counts in November's. A transfer dated 25 Oct from HDFC counts its out-leg in October and its in-leg in November.
- CY-I3: with no statement dated in October, `closeFigures` returns *missing* naming the card. Adding the 17 Oct statement closes it. With statements on 31 Jan and 1 Mar, whose opening is 31 Jan, February closes with the card adding 0.
- CY-I4: a first statement with a previous balance of ₹20,200 gives its cycle in full. One without gives a card left of 0 and the *first cycle left out* state.
- CY-I5: the §9 example (a) gives spent 6967000 paise, (b) gives 7591000, and (c) gives 6967000 from month-end balances.
- CY-I6: §9 (b) gives in transit 0 and a gap of 0. §9 (a) gives in transit 624000 and a gap of 0. November gives −624000 plus its own. The sum over October and November is the payments still in transit after 17 Nov.
- CY-I8: pgTAP. `cycle_ends = 'statement'` on a savings account is refused.
- CY-I9: for the §9 card, `household_cash_reserve('2026-10-31')` and the close's closing both take 2864000 for the card.
- CY-I10: an ICICI card statement dated 17 Oct, with previous balance 2020000 and due 2864000, records 2020000 on 17 Sep and 2864000 on 17 Oct when the card closes on its statement date, and nothing when it closes at month end.
- CY-I11: each state in §8.2 renders its sentence (text match), with no meaning carried by colour alone (axe), and wraps at 200% text without clipping.
- CY-I12: pgTAP. A partner's private refund of 129900 on the owner's statement-date card, dated 20 Oct, is in November's `household_private_close`, not October's.
- CY-I13: a typed due of 2864000 on 17 Oct, then a statement of 18 Oct with 2864000, leaves October's closing at the statement's figure, keeps the typed row, and the preview's text names both dates. With 2900000 typed, the preview names the difference of 36000. After a statement is imported, the close offers no input for that card.
- CY-I14: pgTAP and domain. A partner closes October without the card. The card's left is 0 and a 25 Oct payment of 624000 is in spent. Adding the 17 Oct statement then gives the §9 (b) figures for October, with no change to the stored choice. A contributor's insert is refused.
- CY-I15: a cycle with a purchase of 6000000, converted in the same cycle (`emi_converted_minor` 6000000), counts 6000000 in spent and −6000000 in paid to loans. The next cycle's instalment, with principal 500000 and interest and GST of 66000, counts 66000 in spent and 500000 in paid to loans. The gap is 0 in both.
- CY-I17: a conversion of 6000000 with the debt ticked makes one `credit_card` debt linked to the card, outstanding 6000000 at the statement date; the next statement, with principal 500000, leaves 5500000. A second conversion on the same card adds to the same debt. A `loan_payment` against it is refused (pgTAP). Net worth counts the card's due once and the debt's 5500000 once.
