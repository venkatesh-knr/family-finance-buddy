# Retirement (build plan step 6): the PPF calculation and a proposed schema, for review

**Status: all eight recommendations were accepted (27 October 2026).** The schema below is now the migration
`supabase/migrations/20261027120000_retirement.sql`, with its policy tests in `supabase/tests/retirement.test.sql`, for review before any
repository code or screen. One departure from the text below: a converted PPF deposit's terms and renewals are **deleted** and not left
unused, for the reason in `docs/decisions.md`. The text below is the proposal as it was put.

Nothing here is built except the pure PPF calculation (`src/domain/ppf.ts`, 20 hand-worked fixtures in
`src/domain/ppf.test.ts`). The schema below is a **proposal**: no migration exists yet, as the plan asks. It becomes
`docs/design/retirement.md` and a migration once the questions at the end are answered.

## What is decided already (`docs/decisions.md`)

- **Retirement is a kind (EPF, NPS and PPF).** PPF moves out of the deposit schemes, by a migration.
- **Interest that accrues but is not credited steps the value at credit** (PF-C11): PPF, SSY, NSC and KVP are marked up
  once, when the bank does, and not every month.
- **A retirement holding is in the FIRE corpus** (`retirement` and `none` earmarks are counted).

## What is built

`ppfBalance` takes an optional opening balance, the payments (a withdrawal is a negative one), the notified rates and a
day, and returns the passbook value, what has accrued and is not yet credited, each credit, and the rate in force.

- Interest for a month is on the **lowest balance between the close of the 5th and the end of the month**, at the rate
  notified for that month, a twelfth of the year's. A payment made on or before the 5th earns that month; one made after
  it earns from the next.
- The twelve months are kept as an exact fraction and **rounded once**, to the nearest rupee, half upward, and credited
  on **31 March**. The value steps then and is not marked up in between; the accrued figure is returned beside it and is
  never in it.
- It refuses, and names, a month with no rate in force, a payment dated before the opening balance, two currencies, a
  balance that would go below nothing, and a rate that is not a percentage.
- Not modelled: the limit on a year's payments, the 15-year term and its extensions, loans, and the rules for taking money
  out (a withdrawal is accepted and taken into the lowest balance, which is all the convention needs).
- An opening balance should be as at a **31 March credit** (or the day the account opened). A passbook balance on any
  other day leaves out interest accrued since the last credit, which only the bank knows, and the app cannot invent it.

## Proposed schema

```
instrument.kind            gains 'retirement'
instrument.retirement_type epf | nps | ppf; required when kind = 'retirement', null otherwise (as scheme is, PF-C5)

EPF   a balance typed from the passbook: an ordinary reading (valuation_snapshot, source manual). No new table.
NPS   units held (holding.quantity) and a NAV typed with them: a reading with quantity and amount. No new table.
PPF   ppf_account   holding_id, institution, account_last4, opening_date, opening_balance_minor, currency
      ppf_entry     id, holding_id, entry_date, amount_minor (a payment is positive, a withdrawal negative), voided_at
      scheme_rate   scheme ('ppf'), effective_from, rate_milli  -- public reference data, appended, never updated,
                    readable by everyone signed in and written by migration only, as tax_rule is
```

As for every table: RLS enabled and forced, explicit grants, no delete, audit triggers in the same migration, a test that
each policy denies, and `ppf_account` and `ppf_entry` as private as the holding they hang off (the property pattern; their
audit rows follow the holding by the `holding_id` rule already in the log's policy).

How a PPF reaches net worth is **the way a deposit does** (`docs/decisions.md`): the row shows the latest *recorded*
reading, the screen works the value out from the entries and the rate, and "Record as today's reading" or Close month
writes it. Close month writes `ppfBalance` as at the month end, which is already the stepped value, so no special rule is
needed for it.

## Questions for you

1. **One kind, with a type?** `retirement` as the one kind and `retirement_type` for EPF, NPS and PPF, so the allocation
   has one Retirement row (the shield tile of `icons.md` section 4) and Holdings has one chip. The alternative is three
   kinds and three rows. *Recommendation: one kind with a type.*
2. **PPF from entries and a rate, or typed like EPF?** Computing it is what the blueprint promises ("type the terms once")
   and the part that is built and tested. Typing a balance from the passbook once a year is simpler and needs no rate
   table, and gives up the computed balance. *Recommendation: computed, with a passbook reading to reconcile against once
   a year.*
3. **The notified rate.** A `scheme_rate` table with the government's rate by quarter, seeded with **7.1% from 1 April
   2020**, which is what I believe is in force and what the 2020 notification set. I have not verified it against the
   current notification or your passbook, so **please check it against your own PPF statement before it is relied on**.
   A change would be a migration that appends a row. *Recommendation: yes, with the screen saying the rate in force and
   since when.*
4. **Existing PPF deposits.** The deposit schemes include `ppf` today. If the live household holds any, the migration
   converts each to a retirement holding of type `ppf`, takes its latest reading as the opening balance at that reading's
   date, and leaves its terms and renewal rows where they are, unused. How many are there, and are their readings
   passbook balances? *Recommendation: convert, and check the opening balance against the passbook.*
5. **A hue for retirement.** The shield tile is periwinkle in `icons.md`, which is Mutual funds' hue (`--c1`), the same
   collision property had with Equity. A new token `--c9`. *Recommendation: lime, light `#5F8A1E`, dark `#A3D65C`, to be
   measured against the tile contrast test and replaced by the nearest value that passes.*
6. **NPS NAV.** Typed with the units for now; a driver for the CRA's published NAV would join the price table later, as
   AMFI's does. *Recommendation: typed first.*
7. **EPF between checks.** The blueprint allows employer and employee contributions to accrue as a flagged estimate. That
   is an estimate in a net-worth figure; *recommendation: not in this step*, a passbook reading each quarter instead.
8. **Never liquid.** A retirement holding is in the FIRE corpus and is not available in an emergency: it is left out of
   the liquid corpus the cover gap subtracts, as a locked deposit scheme is. *Recommendation: yes, for all three.*
