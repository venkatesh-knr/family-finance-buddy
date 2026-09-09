-- Family Finance Buddy — tax rules as dated rows.
--
-- "Tax rules — slabs, rates, thresholds, holding periods — are dated rows in
-- `tax_rule`, not constants in code. A Budget change is a data edit. Prior
-- years recompute on the rules that applied then."
--
-- The lots work stopped exactly here. `src/domain/lots.ts` derives a parcel
-- with a held period in days and deliberately declines to say whether that is
-- long or short term, because the threshold has moved and will move again and
-- a prior year has to recompute on the rule that applied then. This is the
-- table it was waiting for.
--
-- ── whose table this is ─────────────────────────────────────────────────
--
-- Nobody's. Every other table here is household data behind a policy; this is
-- the Income Tax Act, which is the same for every household and belongs to
-- none of them. So: readable by any authenticated member, writable by no
-- client at all. There is no insert, update or delete grant, and no policy
-- that would permit one.
--
-- That makes a Budget change a migration rather than a form, which is the
-- right trade. A household that could edit its own tax rates would be able to
-- compute a figure it likes rather than the one the law gives, and the app's
-- whole claim is that the numbers can be checked. A migration is reviewable,
-- versioned and applies identically to everyone.
--
-- No audit trigger, and this is the one table where that is right: the audit
-- invariant covers "every table holding household data", and this holds none.
-- Its history is the migration history.
--
-- ── what is seeded, and what deliberately is not ────────────────────────
--
-- Only the regime introduced on 23 July 2024, which is what docs/blueprint.md
-- §686 tabulates. Earlier years are NOT seeded, and their absence is the
-- point: with no row covering a date, the classifier returns nothing and the
-- screen says it cannot determine the treatment. That is the correct
-- behaviour. Silently applying today's rates to a 2019 sale would produce a
-- confident, wrong, and entirely plausible-looking number — the exact failure
-- this app exists not to commit. Earlier regimes get added when somebody
-- needs them, from a source, in their own migration.

create table public.tax_rule (
  id              uuid        primary key default gen_random_uuid(),

  -- 'IN' and 'US' are the two this app models. Not an enum: a jurisdiction is
  -- a fact about the world, and a check constraint here would need a migration
  -- to add one anyway.
  jurisdiction    text        not null check (jurisdiction ~ '^[A-Z]{2}$'),

  -- The kinds from §232. Only holding_period and cg_rate are seeded here; the
  -- rest exist so the slab and surcharge work lands in this table rather than
  -- inventing a second one beside it.
  kind            text        not null
                              check (kind in ('slab', 'surcharge', 'cess', 'rebate',
                                              'deduction_cap', 'cg_rate', 'holding_period',
                                              'exemption')),

  -- 'old' or 'new' where a rule differs by regime; null where it does not.
  -- Capital gains rates do not differ by regime, so these rows carry null
  -- rather than two identical copies.
  regime          text        check (regime is null or regime in ('old', 'new')),

  -- What the rule is about. Null for rules that are not asset-specific.
  asset_class     text        check (asset_class is null or asset_class in (
                                'listed_equity', 'equity_fund', 'debt_fund',
                                'gold', 'foreign_equity', 'unlisted_equity', 'property')),

  -- The band this rule covers, in minor units of the jurisdiction's currency.
  -- Null band_to means "and above". Used by slabs and by exemption
  -- allowances; null on a holding_period row, which has no band.
  band_from_minor bigint      check (band_from_minor is null or band_from_minor >= 0),
  band_to_minor   bigint      check (band_to_minor is null or band_to_minor >= 0),

  -- A percentage, as numeric so 12.5 is exactly 12.5. Null on a
  -- holding_period row, which carries months instead.
  rate_pct        numeric(6, 3) check (rate_pct is null or (rate_pct >= 0 and rate_pct <= 100)),

  -- Months after which a holding is long-term. Null on every other kind.
  months          smallint    check (months is null or months > 0),

  -- Which side of the holding period a cg_rate applies to. Long-term and
  -- short-term rates differ for the same asset class in the same year, so
  -- without this they are two rows nothing but the prose tells apart.
  term            text        check (term is null or term in ('long', 'short')),

  -- The dates the rule applied between. effective_to null means "still in
  -- force". This pair is the whole point of the table.
  effective_from  date        not null,
  effective_to    date,

  -- Where the figure came from, so a wrong rate can be traced to a source
  -- rather than argued about. A section number, a Finance Act, a circular.
  authority       text        not null,

  created_at      timestamptz not null default now(),

  constraint tax_rule_period_ordered
    check (effective_to is null or effective_to >= effective_from),
  constraint tax_rule_band_ordered
    check (band_to_minor is null or band_from_minor is null or band_to_minor >= band_from_minor),

  -- A holding_period row carries months and no rate; every other kind is the
  -- other way round. Stated as a constraint because a holding period of "12.5
  -- percent" is the kind of row that reads fine and computes nonsense.
  constraint tax_rule_shape_matches_kind
    check (
      (kind = 'holding_period' and months is not null and rate_pct is null)
      or (kind <> 'holding_period' and months is null)
    ),

  -- A capital-gains rate says which term it is for; nothing else does.
  constraint tax_rule_term_only_on_cg_rate
    check ((kind = 'cg_rate') = (term is not null))
);

comment on column public.tax_rule.term is
  'long or short, on a cg_rate row. The same asset class carries different rates on either side of its holding period.';

comment on table public.tax_rule is
  'Tax rules as dated rows. Read-only to every client: a Budget change is a migration, so the figures can be checked rather than trusted.';
comment on column public.tax_rule.effective_to is
  'Null means still in force. A prior year recomputes on the row that covered it, which is what makes recomputing a prior year trustworthy.';
comment on column public.tax_rule.authority is
  'Where the figure comes from. A rate nobody can trace is a rate nobody should rely on.';

-- Looked up by jurisdiction, kind, asset class and date, every time.
create index tax_rule_lookup_idx
  on public.tax_rule (jurisdiction, kind, asset_class, effective_from desc);

alter table public.tax_rule enable row level security;

revoke all on public.tax_rule from public, anon, authenticated;

-- Select only. No insert, no update, no delete — for anybody.
grant select on public.tax_rule to authenticated;

create policy tax_rule_readable
  on public.tax_rule
  for select
  to authenticated
  using (true);

comment on policy tax_rule_readable on public.tax_rule is
  'The Act is the same for every household. Readable by any member; writable by no client, because a household that could edit its own rates could compute the figure it wanted.';

-- Restrictive, matching every other table: the publishable key ships in the
-- bundle, so a password alone must not read household-adjacent data. Tax rules
-- are public knowledge, but a session that has not completed its second factor
-- has no business making requests at all.
create policy require_second_factor
  on public.tax_rule
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor());

-- ────────────────────────────────── which rule applies to a holding

-- An instrument's tax treatment is not derivable from its kind. A mutual fund
-- is equity or debt depending on what it holds; an ETF may be either, and a
-- gold ETF is neither. Getting it wrong changes the holding period, the rate
-- and the answer, so it is asked rather than guessed.
--
-- Nullable, and null means "not classified". The app then declines to say
-- whether a gain is long or short term, which is the honest answer — better
-- than a default that is right for most instruments and silently wrong for
-- the rest.
alter table public.instrument
  add column tax_asset_class text
    check (tax_asset_class is null or tax_asset_class in (
      'listed_equity', 'equity_fund', 'debt_fund',
      'gold', 'foreign_equity', 'unlisted_equity', 'property'));

comment on column public.instrument.tax_asset_class is
  'Which capital-gains rules apply. Null means unclassified, and the app then declines to classify a gain rather than guessing — a fund''s treatment depends on what it holds, not on what kind of wrapper it is.';

-- ─────────────────────────────────────────────── the rules themselves

-- docs/blueprint.md §686, the regime from 23 July 2024. Sources named in
-- `authority` so every figure can be traced.
--
-- Nothing before that date is seeded. See the note at the top: a missing rule
-- produces a refusal, and a refusal is a better answer than a plausible wrong
-- one.

insert into public.tax_rule
  (jurisdiction, kind, asset_class, months, rate_pct, term, band_from_minor, band_to_minor,
   effective_from, effective_to, authority)
values
  -- Holding periods. Twelve months for listed equity and equity funds,
  -- twenty-four for everything else — the simplification the July 2024 Budget
  -- made, and the reason a US ETF and an Indian one are treated differently.
  ('IN', 'holding_period', 'listed_equity',   12, null, null, null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 2(42A)'),
  ('IN', 'holding_period', 'equity_fund',     12, null, null, null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 2(42A)'),
  ('IN', 'holding_period', 'gold',            24, null, null, null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 2(42A)'),
  ('IN', 'holding_period', 'foreign_equity',  24, null, null, null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 2(42A)'),
  ('IN', 'holding_period', 'unlisted_equity', 24, null, null, null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 2(42A)'),
  ('IN', 'holding_period', 'property',        24, null, null, null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 2(42A)'),

  -- Long-term rates. 12.5% across the board, without indexation.
  ('IN', 'cg_rate', 'listed_equity',   null, 12.5, 'long', null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 112A — long term'),
  ('IN', 'cg_rate', 'equity_fund',     null, 12.5, 'long', null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 112A — long term'),
  ('IN', 'cg_rate', 'gold',            null, 12.5, 'long', null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 112 — long term'),
  ('IN', 'cg_rate', 'foreign_equity',  null, 12.5, 'long', null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 112 — long term'),
  ('IN', 'cg_rate', 'unlisted_equity', null, 12.5, 'long', null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 112 — long term'),
  ('IN', 'cg_rate', 'property',        null, 12.5, 'long', null, null, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 112 — long term'),

  -- The equity allowance: the first ₹1.25 lakh of long-term equity gains in a
  -- year. An allowance that expires unused, which is why it is a band and not
  -- a rate.
  ('IN', 'exemption', 'listed_equity', null, null, null, 0, 12500000, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 112A — annual exemption'),
  ('IN', 'exemption', 'equity_fund',   null, null, null, 0, 12500000, date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 112A — annual exemption');

-- Short-term rates are deliberately absent for every class except equity.
-- Everywhere else short-term gain is taxed at the taxpayer's slab, which is
-- not a capital-gains rate at all — it is the slab rows, which this migration
-- does not seed. A cg_rate row of "slab" would be a rate that is not a number.
insert into public.tax_rule
  (jurisdiction, kind, asset_class, rate_pct, term, effective_from, effective_to, authority)
values
  ('IN', 'cg_rate', 'listed_equity', 20, 'short', date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 111A — short term'),
  ('IN', 'cg_rate', 'equity_fund',   20, 'short', date '2024-07-23', null, 'Finance (No. 2) Act 2024, s. 111A — short term');
