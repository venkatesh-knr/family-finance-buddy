# DRAFT: how income is captured, so Tax, the monthly view and FIRE each get the figure they need

Not designed, not built, not agreed. A proposal for the owner to react to (13 November 2026), written from the owner's answers: income is recorded **gross, before tax and PF deductions**; the ledger is the one source; income must **not be grown by inflation** and changes only when the person records a new figure; the income field belongs with the **income / expense / savings view for the month**, not on FIRE.

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

## Questions for the owner

1. Is typing **per month, as the payslip reads, with the annual figure shown beneath** the right way round for most people, with Per year as a switch?
2. For FIRE: leave one-offs out of the annual take-home by default, or include their average over the last twelve months?
3. Is "that month's payslip replaces the record for that month" the right way to handle a month that differs, or would you rather the person only adds one-off lines?
4. Should the employer's PF contribution be recorded at all (it never reaches the person), or only the employee's?
5. This needs the Money screen (step 6a) to exist and the rename question settled. Do you want it designed in full (a board, invariants and tests) before 6a starts?
