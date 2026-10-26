# Property (build plan step 6): the cost basis and a proposed schema, for review

Nothing here is built except the pure cost-basis function (`src/domain/property.ts`, 26 known-answer tests). The
schema below is a **proposal**: no migration exists yet, as the plan asks ("migration shown for review before any
screen"). It becomes `docs/design/property.md` and a migration once the five questions at the end are answered.

## What is built

`propertyCostBasis` takes the purchase cost, stamp duty, registration and dated improvements, and returns the cost
of the whole property and the household's share of it.

- Purchase + stamp duty + registration + **capital** improvements. A repair is recorded and **not** counted, and the
  result says how much was left out so a screen can show it.
- `asOf` counts the work done on or before the sale day, the day itself included.
- A share is a percentage to two decimal places, taken in integer arithmetic and rounded once, half a paisa upward,
  on the share and not on its parts.
- It refuses amounts in two currencies, a negative amount, and a share outside (0, 100].
- It is the **unindexed** cost. The 20% with indexation election for a property bought before 23 July 2024 needs a
  cost inflation index per year, which is a `tax_rule` row and belongs to the tax engine. This function keeps the
  parts dated and apart, which is what indexation will need.

## Proposed schema

Differences from the blueprint's one `property` table are marked **(differs)** and are question 1 and 2.

```
property
  id, household_id, member_id          -- who holds it; member_id as on holding
  kind        land | plot | apartment | house | commercial
  label       text                      -- "House", "Land 1"
  currency    ISO code                  -- every amount carries one; a property abroad is its own
  purchase_date, purchase_cost_minor, stamp_duty_minor, registration_minor
  co_owner_share_pct numeric(5,2)       -- the household's share, 100 when it owns all of it
  is_self_occupied boolean
  linked_liability_id                   -- the home loan; equity = value - outstanding
  visibility  household | personal      -- as holding (question 3)
  archived_at, created_by, created_at, updated_at

property_improvement
  id, property_id, household_id, date, description, amount_minor, is_capital
  voided_at                             -- never deleted

property_valuation                      -- (differs) append-only, dated; replaces current_value_minor / valued_on
  id, property_id, household_id, as_of_date, value_minor, currency,
  basis  own_estimate | circle_rate | broker | registered
  note
```

In the migration, as for every table with household data: `enable` and `force row level security`, explicit grants
(select, insert, update; no delete), the audit trigger in the same migration, and a pgTAP test proving each policy
denies. Policies do access only: no rule about cost basis or staleness lives in one.

## Why a valuation table and not one column

The blueprint has `current_value_minor` and `valued_on` on the property. That overwrites yesterday's figure, and
"yesterday's net worth must not change" (CLAUDE.md, prices and rates are dated rows, appended, never updated). With
dated valuations, net worth reads the latest at or before the day asked, the history chart can draw a property, and
"stale" is computed (today minus the latest `as_of_date`) and never stored. The blueprint's own wording: the app
"flags a valuation that has gone stale rather than quietly carrying a four-year-old figure into your net worth".

## Net worth, FIRE, loans

- Net worth counts the household's **share** of the latest valuation, less the household's share of the linked loan's
  outstanding balance. The loan stays on FIRE where it lives today.
- An owned home is **not** in the FIRE corpus (your answer of October 2026). A property that is not self-occupied
  (land, a let flat) is the open point: question 4.

## Not in the first migration

Rent, tenant, annual property tax (the house-property head of the Tax screen) and the sale itself (a disposal with
the indexation election, reinvestment clocks and TDS). They arrive with the Tax slice that reads them, so the first
migration holds nothing that has no reader. The tenant's name is personal detail and would need reads audited.

## Questions for you

1. **Valuations as dated rows** (above) instead of the blueprint's one column? *My recommendation: yes.*
2. **The household's share** (`co_owner_share_pct`): net worth and cost basis use the share, never the whole.
   Co-owners outside the household are not modelled. *Recommendation: yes.*
3. **Private property.** Should a member be able to hold a property as `personal`, as with holdings and expenses
   (visible to them alone), or is property always the household's? *Recommendation: same as holdings, so the one
   rule applies everywhere; the contributor and viewer narrowing is a standing rule for every new table.*
4. **A property that is not self-occupied** (land, a let flat): in the FIRE corpus or out? A plot is not money you
   can spend; a let flat earns rent that does count towards retirement. *Recommendation: out for now, with the
   option to include a let property when rent is built.*
5. **How old is stale?** *Recommendation: 12 months, a setting per household like the other thresholds, and the
   figure still counts but carries the mark.*
