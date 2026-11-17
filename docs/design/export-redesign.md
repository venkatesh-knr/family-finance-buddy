# The export and the template, redesigned for people

<!-- invariant-prefix: XR -->

Decided by the owner on 17 November 2026, sheets and fields both (sections 6 and 7). Today, both downloads return the
complete table structure: 17 to 20 sheets, ids, refs, internal codes, voided and archived
rows. The owner's words: "the user will get confused. The report sheet should have only
the fields user will be required to view, and the blank template should have only the
fields he can understand and add data."

Both **sheets and fields** are redesigned. Two sample workbooks show the result, built
from the demo household's export of 17 November 2026:

- `docs/drafts/samples/family-finance-buddy-report-demo-household-2026-11-17-fixed-axes.xlsx` (the report, with its charts)
- `docs/drafts/samples/family-finance-buddy-template-demo-household.xlsx` (the template)

The samples are the target output: the build matches their sheets, headers, order, number formats and charts.

## 1. Three files, each for one job

Today, one shape does three jobs, and none of them well for a person. Blueprint §14 makes
the full export "identical in shape to the upload template" so that the round trip can be
tested. That stays true of the backup, and only of the backup.

| File | For | Shape | Where |
|---|---|---|---|
| **Report** | Reading and keeping your figures | 7 to 10 friendly sheets, friendly headers, no technical columns, only live records | Reports → *Download a report* (the default) |
| **Template** | Adding data in bulk | 8 sheets of the things people add, plus How to fill and Lists. Every column is one a person knows; dropdowns from the household's own lists | Reports → *Download the template* |
| **Complete backup** | Restoring, moving to another app, the round trip (§14) | Exactly today's file: every entity, every column, ids and refs | Settings → *Data* → *Download a complete backup*, with a line saying it is technical and complete |

**Nothing is lost.** The backup keeps everything the export holds today, and it can still
be uploaded. The report and the template are views built on top of it.

## 2. The report

### Sheets

| Sheet | Shown when | Comes from |
|---|---|---|
| Read me | always | the household, the date, what each sheet is, what is not in the file and why, privacy |
| Summary | always | formulas over the other sheets: investments by type, spending by month against the plan, protection |
| Spending | any expense | `expense_txn`, not voided |
| Money in | any credit | `credit_entry`, not voided (ledger-income) |
| Monthly plan | any budget | `budget`, monthly and yearly side by side per category |
| Investments | any active holding | `holding`, its instrument, the latest reading |
| Purchases and sales | any lot or disposal | `lot` and `disposal`, newest first |
| Value history | any reading of a holding held today | `reading`, by investment, oldest first |
| Deposits | any deposit or bond with terms | `deposit_terms` (and its latest renewal) |
| Insurance | any policy in force | `insurance_policy`, active |
| Loans | any active liability | `liability`, active |
| Property | any active property | `property` |
| Accounts | any account | `account` and its last closing balance |

**Not in the report:**

- Deposit renewals, bond ratings, gold rates, property work and valuations, PPF accounts
  and payments, recurring rules, categories as a table, and the import log.

They are history and machinery, not figures a person reads. **A sheet with nothing in it
is left out**, and Read me says it is "not in this file: nothing recorded yet".

### Fields

| Sheet | Columns | Left out |
|---|---|---|
| Spending | Date · Month · Who · Category · Paid to · How paid · Amount · Currency · Note · Private | `id`, `ref`, `member_id`, `category_id`, `visibility` as a code, `voided_at`, and voided rows |
| Money in | Date · What it is · Whose · Into account · From · Amount · Currency · Private | ids, `source`, rule and batch fields |
| Monthly plan | Category · Per month · Per year · Currency · Financial year | ids, `cadence` and `period` as codes |
| Investments | Name · Type · Whose · Units · Invested · Latest value · Value as at · **Gain** (formula) · **Gain %** (formula) · Kept for · Held abroad · Currency | `id`, `ref`, `instrument_id`, `visibility`, `folio_last4`, the `stated_*` fields, `status`, `archived_at`, `symbol`, `isin`, `exposure_currency`, `tax_asset_class`, `price_source`, `price_external_id`, and archived rows. *Type* merges `kind`, `scheme` and `retirement_type` into one word: *Fixed deposit (FD)*, *EPF*, *Mutual fund*. |
| Purchases and sales | Date · Investment · Whose · What happened (Bought, Sold, Bonus units, Split, Redeemed, Matured, Gift received, Gift given, Transfer in, Transfer out, ESOP) · Units · Amount · Currency · Note | ids, `ref`, `kind` as a code, `source_batch_id`, `source_hash` |
| Value history | Investment · Whose · Date · Units · Value · Currency · How (Typed, From a statement, Fetched price) · Note | ids, `ref`, `source` as a code, and readings of archived holdings |
| Deposits | Deposit · Bank · Principal · Interest rate · Started · Matures · Interest added · Account (••4521) · Currency | `holding_id`, `ref`, `coupon_frequency`, `rating`, `auto_renew`, `renewal_rate_pct`, `repay_mode` (each shown only for a bond, in a Bonds block, when one exists) |
| Insurance | Policy · Type · Insurer · Policy no. (••9012) · Covers · Cover · Premium · Paid · Next renewal · Currency | ids, the linked holding's id, `status`, `lapsed_at`, `premiums_end_on` (shown as *Premiums end* only when set) |
| Loans | Loan · Type · Whose · EMI · Paid · Outstanding · As on · Paid so far (from loan payments) | ids, `status`, `closed_at` |
| Property | Property · Type · Whose · Bought on · Price paid · Stamp duty · Registration · **Total cost** (formula) · Your share · You live in it · Currency | ids, the linked loan's id, `visibility`, `status`, `archived_at` |
| Accounts | Account · Type · Whose · Balance · As on | ids, `is_foreign`, `opened_on`, `status` |

### How it reads

- **Every code is a word:** `upi` → UPI, `term_life` → Term life, `half_yearly` →
  Half-yearly, `TRUE` → Yes. A blank means none, never `FALSE`.
- **Amounts in Indian grouping:** ₹1,42,000, using a number format, so the cell stays a
  number. Dollars as $49.99. Each row keeps its own currency, and totals are per
  currency (the Summary says so).
- **Dates** show as 31 Oct 2026, and stay date cells.
- **Headers:** forest with cream text (Linen). The first row is frozen, with filters on.
  Column widths fit their content.
- **Totals and gains are formulas**, so a person who edits a figure sees the gain change.
- **The demo household** says *Sample figures* on Read me and on Summary, as the app's
  sample bar does.
- **Privacy:** the file is written under the reader's own access. Their private entries
  are in it and marked *Private: Yes*. Other members' private entries are not, as on
  screen. *Summary* adds only what the file holds, and says that a closed or stated month
  has its own figure in the app.
- **Never in the file:** a full account, card or policy number (last four only, as
  stored), and no member's email.

### Charts (added 17 November 2026, at the owner's request)

Native Excel charts. Each reads its sheet's own cells, so a figure edited in the file
moves the chart.

| Sheet | Chart | Form, and why |
|---|---|---|
| Summary | **Investments by type: invested and latest value** | Horizontal bars, two per type. *Invested* is the grey context and *Latest value* is green. Names stay readable, and the gap between the two bars is the gain. |
| Summary | **Spending by month, against the plan** | Green columns for spent, with a value on each, and a grey dashed line for the monthly plan on the same axis. One axis, never two. |
| Spending | **Spent by category** | Ranked horizontal bars, largest first, beside a small *By category* table that the chart reads (`SUMIFS` over the list) |
| Investments | **Gain on each investment** | Bars from zero: green above, coral below for a loss, with the figure on each bar and its minus sign. Names sit at the axis's edge, so a loss bar never covers them. |

**No chart on** Monthly plan (it is in the Summary's spending chart), Purchases and sales,
Value history, Deposits, Insurance or Property. Each is a short list read row by row,
and a chart would repeat the table. Value history may earn a line chart once a household
has a year of values for an investment.

**Rules:**

- Rupee charts only. Other currencies are never added in.
- Colours for marks: green `#0B7D5E`, coral `#C0432F` and grey `#7B857F`. These are the
  Linen accent, loss and muted colours, made bright enough to read as colour in a chart.
  The pair passed the colour-blind and contrast checks.
- A legend appears only where there are two series. Every chart's title names its
  currency.
- **A ranked bar chart lists its first item at the top**, so its category axis is
  reversed, and its value axis is then set to cross at the far end. That keeps the
  figures along the bottom, clear of the title, which Excel otherwise draws them over.
  Every chart title is set not to overlay the plot.

## 3. The template

### Sheets

| Sheet | For | Becomes, on upload |
|---|---|---|
| How to fill | five steps, what each sheet is for, and what upload does and never does | (not read) |
| Spending | expenses | `expense_txn` |
| Money in | salary, business income, interest, rent, dividends, refunds | `credit_entry` |
| Monthly plan | a plan per category | `budget` (one row per cadence filled) |
| Investments | funds, shares, gold, deposits, EPF, NPS, PPF, schemes | `holding` with its instrument; *Latest value* as a reading |
| Purchases and sales | each buy, sell, bonus, split, redemption, maturity, gift or transfer | `lot` (Bought, Bonus units, Split, Gift received, Transfer in, ESOP) or `disposal` (Sold, Redeemed, Matured, Gift given, Transfer out) |
| Deposits | an FD's or RD's terms, by the name on Investments | `deposit_terms` |
| Insurance | policies | `insurance_policy` |
| Loans | loans | `liability` |
| Property | property | `property` |
| Lists | the household's members, categories and accounts, and every choice list | (not read; read-only, and the dropdowns' source) |

**Dropped from the template:**

- **Categories.** New categories are made in the app, where nature and *essential* are
  explained.
- **Past values (readings), deposit renewals, PPF accounts and payments, and Property work
  and valuations.** Each is added in the app, or from a statement. The template's
  *Latest value* covers today's value. Past values were removed from the template on 17
  November 2026: few people have them to hand at setup, and the sheet's purpose was not
  clear.

The **complete backup** still accepts all of them, for anyone who needs to.

### Fields

| Sheet | Columns (* needed, ▾ a list) | Mapped on upload to |
|---|---|---|
| Spending | Date* · Amount* · Currency ▾ · Category* ▾ · Who* ▾ · Paid to · How paid ▾ · From account ▾ · Note · Private ▾ | `txn_date`, `amount`, `currency` (empty = INR), `category_id` by name, `member_id` by name, `payee`, `method` (word → code), `account_id` by name, `note`, `visibility` (Yes → personal) |
| Money in | Date* · Amount* · Currency ▾ · What it is* ▾ · Whose* ▾ · Into account ▾ · From · Private ▾ | `credit_date`, `amount`, `currency`, `category` (word → code), `member_id`, `account_id`, `payer`, `visibility` (empty = personal, as income starts private) |
| Monthly plan | Category* ▾ · Per month · Per year · Financial year* ▾ | one `budget` row for each of Per month and Per year that is filled |
| Investments | Name* · Type* ▾ · Whose* ▾ · Units · Amount invested · Bought on · Latest value · Value as on · Kept for ▾ · Held outside India ▾ · Currency ▾ | the instrument (`name`, plus `kind`, `scheme` and `retirement_type` from *Type*), the holding (`quantity`, `cost`, `opened_on`, `earmark`, `is_foreign_asset`), and a reading when *Latest value* is filled |
| Purchases and sales | Date* · Investment* ▾ · What happened* ▾ · Units* · Amount · Currency ▾ · Note | the holding by *Name (Whose)*; a `lot` with `acquired_on`, `quantity`, `cost` and `kind`, or a `disposal` with `disposed_on`, `quantity`, `proceeds` and `kind`, from the word. Amount includes charges and stamp duty, which are folded into a lot's cost (the eCAS rule). Empty for a bonus or a split. |
| Deposits | Deposit* · Bank · Principal* · Interest rate %* · Start date* · Maturity date* · Interest added ▾ · Account last 4 | `deposit_terms` of the holding with that name |
| Insurance | Policy* · Type* ▾ · Insurer · Policy no. last 4 · Covers ▾ · Cover amount · Premium* · Paid* ▾ · Next renewal | `insurance_policy` |
| Loans | Loan* · Type* ▾ · Whose ▾ · EMI* · Paid* ▾ · Outstanding · Outstanding as on | `liability` |
| Property | Property* · Type* ▾ · Whose* ▾ · Bought on · Price paid · Stamp duty · Registration · Your share % · You live in it ▾ | `property` |

**Never asked:**

- **Identifiers:** `id`, `ref` (see the row key below) and every `*_id` (names are picked
  from lists).
- **Status:** `status`, `archived_at`, `voided_at`, `closed_at`, `lapsed_at`. Closing and
  removing are done in the app, and an upload never deletes.
- **Internals:** `sort_order`, `exposure_currency`, `tax_asset_class`, `price_source`,
  `price_external_id`, `isin`, `symbol`, the `stated_*` fields, `source_batch_id`,
  `source_hash`, and `nature` and `is_essential`.

### The row key: corrections without a *ref*

Decision 2 of the upload (`docs/decisions.md`) made `ref` the way a corrected file finds
the rows it added before. That is a column people did not understand. Instead:

- **Column A on every data sheet is hidden** and pre-filled with a key: `SP-0001`,
  `SP-0002` and so on, 300 rows a sheet.
- The upload treats the key as the row's `ref`, prefixed with the template's own id so
  that two downloads never collide.
- A person never sees or types it. Uploading the corrected file again updates the same
  rows, and nothing is added twice.
- Row 2 of every sheet is the **example**, in grey italic, keyed `EXAMPLE`. It is never
  uploaded.
- A row whose visible cells are all empty is skipped, so the pre-filled keys do nothing.
- A person who copies rows between two downloaded templates can repeat a key. The preview
  flags the duplicate before anything is written.

### Naming an investment from another sheet

*Purchases and sales* names an investment as **Name (Whose)**, as the
app shows it: *Demo Flexi Cap Fund (Venkatesh)*. The dropdown lists the household's
investments. A new investment on this file's Investments sheet can be named the same
way, so the dropdown **warns rather than refuses**. If two holdings have the same name and
owner, the preview stops and asks for one of them to be renamed in the app, rather than
guessing.

### How it reads

- **Words in, codes out:** the reader maps each choice word to its code (*Fixed deposit
  (FD)* → `kind = deposit`, `scheme = fd`), with one table per list, kept beside the
  export's entity list and tested against it.
- **Dropdowns** come from the Lists sheet, which the app fills from the household when it
  makes the file: members, active categories, accounts and investments. Lists is protected, and its
  help line says new ones are added in the app.
- **Needed columns** have a darker header with an asterisk, and every header has a comment
  saying what to type.
- **Checks in the cell:**
  - a date is a date;
  - an amount is more than 0;
  - a percentage is 0 to 100;
  - a last four is exactly four characters, and its message says never the full number.
- **Amounts** take Indian grouping or plain numbers. An empty currency is INR.
- **Template version 3.** The reader takes version 2 (the backup's shape) and version 3
  (this shape), and tells them apart by the About or How to fill sheet. The complete
  backup stays version 2.

## 4. What the build changes

1. `src/domain/export/`:
   - A **report writer** beside the existing export. It uses the same entity reads,
     under the same row-level security, and writes the sheets and fields above, with
     words for codes and number formats.
   - A **template writer** for version 3, with the household's lists.
   - The existing writer, renamed **complete backup**, unchanged.
2. The template reader takes version 3 and maps its words and names to the rows
   `public.apply_template` already accepts. **The database function does not change.**
3. Reports screen:
   - *Download a report* is the main action.
   - *Download the template* sits beside it.
   - *Upload* is unchanged.
   - Settings → Data: *Download a complete backup*, with one line saying it is complete,
     technical, and the file to keep for a restore.
4. `templateEntities.test.ts`: every entity in the export list is either in the template
   or named in the template's "added in the app" list. New entities (accounts, credits,
   loan payments, stated spend) must take a side when they are added.

## 5. Invariants and tests

**XR-I1 — The report shows a person's figures, not the database.** No header in it ends `id`, `_id` or `ref`; no cell holds a code from a code list (`upi`, `term_life`, `TRUE`); no voided or archived row appears. Each code list has one mapping table, tested against the schema's check constraints. (§2)

**XR-I2 — Read me lists exactly the sheets that are in the file, and every left-out sheet as "nothing recorded yet".** A sheet with no rows is not written. (§2)

**XR-I3 — The report's *Gain*, *Gain %* and *Total cost* cells are formulas, and the Summary is built from `SUMIFS` over the other sheets,** so its totals equal the sums of the sheets, per currency, and a figure edited in the file moves them. (§2)

**XR-I4 — Each chart reads cells on its own sheet; none holds an embedded number.** The Summary charts carry rupee rows only, and currencies are never added. (§2, Charts)

**XR-I5 — A ranked bar chart lists its first item at the top with its figures along the bottom, and no chart title overlays its plot.** Its category axis is reversed and its value axis crosses at the far end; a value label shows the value alone; a loss is a coral bar with a minus sign in its label. (§2, Charts)

**XR-I6 — The report opens in Excel without a repair prompt:** its parts list (content types, drawings, charts and their relationships) is complete and consistent. (§2, Charts)

**XR-I7 — The template has exactly the sheets and headers of section 3, with a list validation on every ▾ column,** the Lists sheet protected, and a comment on every header. (§3)

**XR-I8 — A *Purchases and sales* row of *Sold* becomes a disposal and one of *Bought* becomes a lot;** a bonus with no amount is accepted; a name that matches two holdings stops the preview and names both. (§3)

**XR-I9 — A filled version 3 template uploads to the same rows as the equivalent version 2 rows, and uploading it twice changes nothing the second time.** The row key, prefixed with the template's own id, is the ref. (§3)

**XR-I10 — The example row and any row whose visible cells are all empty are never uploaded.** (§3)

**XR-I11 — A contributor's report holds only what a contributor can read, and a contributor is not offered the template.** The policies already decide the first. (§2, §4)

**XR-I12 — The complete backup is byte-for-byte today's export** (template version 2), and upload still accepts it. (§1)

### Tests

- XR-I1: unit, over the report writer's sheets for a household that holds one of everything, including a voided expense, an archived holding and a code in every list: no header matches `/(^|_)(id|ref)$/i`, no cell equals a code value, none of the voided or archived rows is present; and for each mapping table, every value the schema's check constraint allows has a word and no word repeats.
- XR-I2: unit: a household with no insurance and no property gets neither sheet, and Read me names both under "not in this file: nothing recorded yet" and every sheet it did write.
- XR-I3: unit: the *Gain*, *Gain %* and *Total cost* cells have a formula and no cached constant of their own; the Summary's cells are `SUMIFS` over named sheet ranges; recomputing them from the sheets' values equals the household's per-currency sums.
- XR-I4: unit over the finished buffer: every series reference in `xl/charts/chart*.xml` is a range on the sheet the chart is drawn on, and no series carries a literal.
- XR-I5: unit over the chart XML: each ranked bar chart has `orientation maxMin` on its category axis and `crosses max` on its value axis, every title has `overlay 0`, every data label has the value shown and no series or category name, and the loss points are `#C0432F`.
- XR-I6: unit: unzip the buffer and check that every part is listed in `[Content_Types].xml`, every relationship target exists, and every drawing's chart is related.
- XR-I7: unit: the template's sheets and headers equal the lists in section 3, each ▾ column has a list validation pointing at the Lists sheet (the Investment column warns, and does not stop), and each header has a comment.
- XR-I8: reader unit tests, then pgTAP through `public.apply_template` where the rows land: a *Sold* row, a *Bought* row, a bonus with no amount, and a name matching two holdings.
- XR-I9: a version 3 workbook and the equivalent version 2 rows produce the same rows through the reader; the second upload reports every row unchanged.
- XR-I10: reader unit: the EXAMPLE row and a row of pre-filled keys with nothing visible are skipped.
- XR-I11: e2e: a contributor's report has no sheet that holds another member's row, and the Reports screen offers a contributor no template.
- XR-I12: unit: the complete backup written for a stored fixture household equals a stored fixture file, byte for byte; the version 2 file is accepted by the reader.

## 6. Departure, decided

| What | The prototype | The app | Why | Status |
|---|---|---|---|---|
| Export and template | one workbook shape for export, template and backup: every entity, every column | three files. A report (friendly sheets and fields, live records, formulas). A template (8 sheets of the things people add, words and lists, a hidden row key). A complete backup (today's shape, for restore and the round trip). | People were shown the database. The owner asked, on 17 November 2026, for a report with only what a person views and a template with only what a person can understand and add. | decided |

## 7. Decided by the owner, 17 November 2026

- **Purchases and sales** have a sheet in both the template and the report. A statement
  (eCAS) upload in the app still adds them for most people; the sheet is for what a
  statement does not cover.
- **Value history** has a sheet in the report only. It was briefly in the template too, and
  the owner removed it there the same day.
