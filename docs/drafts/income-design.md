# DRAFT: how income is captured, so Tax, the monthly view and FIRE each get the figure they need

Not designed, not built, not agreed. A proposal for the owner to react to (13 November 2026), written from the owner's answers: income is recorded **gross, before tax and PF deductions**; the ledger is the one source; income must **not be grown by inflation** and changes only when the person records a new figure; the income field belongs with the **income / expense / savings view for the month**, not on FIRE.

> **Two options.** The sections from "What the person types" down to "Where it is entered" are **Option A**, my first draft (a payslip-shaped salary record). **Option B**, at the end, is the owner's idea of 13 November 2026 (the money screen as a ledger of credits and debits, the Tax screen typed once a year) and is simpler. The recommendation is **Option B**.

## The three readers want three different figures

| Reader | Needs | Per |
|---|---|---|
| Tax screen | gross salary by head, and the tax already deducted (TDS) | tax year (1 April to 31 March) |
| Income / expense / savings view | take-home: what reached the account after tax, PF and other deductions | month |
| FIRE | take-home for a year, to know what can be saved | year |

If the person typed three figures they would disagree. So the person types **one** thing, in the form they already read it, and the three are worked out.

## What the person types: the payslip, once, monthly

A **salary record** per member, entered the way a payslip reads (per month), with a date it takes effect from:

- Gross per month
- Tax deducted (TDS) per month
- Provident fund, the employee's share, per month
- Other deductions per month (professional tax, insurance through payroll, and so on)
- Shown as the person types: **Take-home ₹X a month**, and beneath it **₹Y a year gross**.

A switch on the amount fields, **Per month | Per year** (the pair of text tabs of `simple-layout.md` section 3), lets someone who knows the annual figure type that; it is divided by twelve and stored as monthly. So "months or years" is a display choice and not two ways of recording.

The record **holds from its effective date until the person adds a newer one** (a raise, a new job). Nothing is indexed, so income is never inflated on its own: a figure changes only when the person updates it.

**One-off income** (a bonus, arrears, interest, rent, freelance, a dividend) is a dated entry with its category, the gross amount, the tax deducted and any other deduction. It lands in the month it is dated and is not repeated.

If one month's payslip differs from the salary record (overtime, a leave deduction), the person records **that month's payslip**, which replaces the record for that month only.

## What is worked out from it

- **Tax screen:** gross salary for the tax year is the sum of the twelve months (the record in force in each, or that month's payslip, plus the one-offs by head), and TDS is the sum of the tax deducted. This replaces the salary box on the Tax card that forgets what was typed. The engine is unchanged.
- **Income / expense / savings for a month:** income is that month's take-home (record in force or that month's payslip, plus one-offs, less their deductions), and **saved = take-home less spent**. The PF the employee pays is money put away through payroll: it is shown on its own line (`spending-capture.md` section 10) and is not in take-home.
- **FIRE:** annual take-home is twelve times the take-home of the record in force today, with no growth. The one-offs are left out unless the person chooses to include the last twelve months' average. FIRE shows the figure with where it came from ("from your salary record of 1 April 2026") and a link to change it there. If none is recorded, FIRE says so and links to the monthly view. FIRE keeps its own separate assumptions, such as a yearly raise, which the person sets and which defaults to none.

## Where it is entered

On the **income / expense / savings view** (the screen the plan calls Money, today Expenses), as a section of that view. Not on FIRE, which only reads it.

## Rules it must follow, which already exist

- Income is **private by default** (blueprint section 20), with a sum function so the household total can include another member's private income without detail.
- Money is integer minor units with a currency; periods are IST months; the tax year is 1 April to 31 March.
- A new table has its audit trigger, row-level security enabled, explicit grants, a denying policy test per verb, and is cleared by `reset_demo_household` and listed in the export, all in the migration that creates it.
- A realised capital gain is **not** income here: it is derived from lots and used in the tax view only, and a sale's proceeds are already counted as money taken out of holdings.

## Option B: the ledger (the owner's idea)

The money screen is a **ledger of credits and debits**, like a bank account's:

- A **debit** is what is spent today. A **credit** is money in, with a category: **Salary**, interest, rent, refund, a dividend and so on. A move between the household's own accounts, a card payment and money into a holding are in neither (`spending-capture.md` SC-I4).
- **Take-home is the credit marked Salary**, as the bank received it, after tax, PF and every other deduction. Nothing about deductions is recorded: the bank has already taken them. A month with a different payslip simply has a different credit, so variable pay needs no special handling.
- The month's view is then **credits less debits**: income, spent and saved, from what actually reached and left the account.
- Typing a salary credit once a month is one line (the amount and the date). A **recurring rule** can post it on the day it usually arrives, at the usual amount, and the person corrects the one month that differs. The recurring rules already built for expenses would be extended to credits.
- **FIRE reads the Salary credits** for annual take-home: the last twelve months added up, or the latest month times twelve (the owner to choose). It is never grown by inflation; it changes when a new credit is different, or when the person records one.
- **The Tax screen gets a gross figure typed by hand, once a year, per member**: the gross salary for the tax year, with the other income and the tax already deducted if the person wants to enter them. It is **stored** per member and tax year, so the Tax card stops forgetting what was typed. The ledger does not feed it, so the two are separate answers to separate questions.

Two cautions:

1. **CTC is not taxable gross.** A cost-to-company figure includes the employer's PF, gratuity and insurance, which are not in taxable salary. The Tax field should ask for the **gross salary on the payslip or Form 16** and say so beside the box, or take CTC and ask for the non-taxable part.
2. The ledger has **no PF line**: the employee's PF is deducted before the credit, so it is not recorded. The "also put away through payroll" line of `spending-capture.md` section 10 would need a typed figure, or be dropped.

## Comparison

| | Option A: payslip-shaped salary record | Option B: ledger of credits and debits |
|---|---|---|
| What the person types | gross, tax, PF and other deductions, monthly, with an effective date | the salary credit each month (or let a recurring rule post it); one yearly gross on the Tax screen |
| Take-home | worked out from the deductions | the credit itself: matches the bank |
| Variable months | a "that month's payslip" override | nothing special: the credit is what it was |
| Tax gross | summed from the record automatically | typed once a year, stored |
| FIRE | twelve times the take-home in force | the Salary credits, trailing twelve months or latest times twelve |
| Two figures that could disagree | none, one source | take-home and gross are separate; the screen can show a plausibility note (take-home times twelve against the gross) and nothing more |
| New tables | salary record, one-off income | credits join the existing entries (with a direction and a category); a small per-year Tax input table |
| Depends on | step 6a | step 6a (accounts and the ledger), which is where it belongs anyway |

## Recommendation

**Option B.** It matches how people check their money (against the bank), needs no payslip arithmetic, handles uneven months, and keeps Tax's gross as its own typed answer. What it gives up is Tax gross derived automatically and the PF figure, and both are small.

## Decided on 13 November 2026

Option B. FIRE's annual take-home is **the highest Salary credit among the months entered, times twelve**. The Tax screen asks for the **gross salary from the payslip**, and the person may correct it later from Form 16. The PF "put away through payroll" line is **dropped**. A recurring salary credit and the money screen's rename are still to be designed: `docs/drafts/ledger-design-prompt.md` is the prompt for that.
