/**
 * The plan: what the household intends to spend, and what that implies.
 *
 * This is the workbook's Expense sheet, replaced. The order of the cards is the
 * order of that sheet's argument — what things cost, what is already committed,
 * what those add to in a year, and what that means for retiring. The headline
 * figure sits at the top because it is the one anybody actually came for, and
 * every number below it is shown so the headline can be checked rather than
 * believed.
 */

import { useCallback, useMemo, useState } from 'react';
import { formatMoney, money, parseAmountToMinor } from '../../lib/money.ts';
import type {
  CommitmentCadence,
  LiabilityKind,
  PlanListing,
  PolicyKind,
} from '../../repo/types.ts';
import { COMMITMENT_CADENCES, LIABILITY_KINDS, POLICY_KINDS } from '../../repo/types.ts';
import { canPlan } from '../../repo/planning.ts';
import { JoinHousehold } from '../household/JoinHousehold.tsx';
import { Button, Card, Field, Pill, Problem } from '../../ui/primitives.tsx';
import { usePlan, type CategoryPlan } from './usePlan.ts';

const MULTIPLIERS = [25, 30, 50];

export function PlanScreen({
  privacy,
  householdId,
}: {
  privacy: boolean;
  householdId: string | null;
}) {
  const plan = usePlan(householdId);

  if (plan.loading) return <p className="note py-4.5">Loading…</p>;
  if (plan.noHousehold) return <JoinHousehold onJoined={plan.reload} />;
  if (plan.problem !== null && plan.listing === null) return <Problem>{plan.problem}</Problem>;
  if (plan.listing === null) return null;

  const editable = canPlan(plan.listing.viewer.role);

  return (
    <div className="flex flex-col gap-4.5">
      <AnnualSummary plan={plan} privacy={privacy} />
      <FireCard plan={plan} privacy={privacy} />
      <Categories plan={plan} privacy={privacy} editable={editable} />
      <Commitments plan={plan} privacy={privacy} editable={editable} />

      {!editable && (
        <p className="note">
          Your role is <strong>{plan.listing.viewer.role}</strong>, which can read the plan but not
          set it. Recording what was spent and deciding what to spend are different rights, and the
          database enforces the difference rather than this screen.
        </p>
      )}
    </div>
  );
}

/** The headline, with the arithmetic beside it rather than behind it. */
function AnnualSummary({
  plan,
  privacy,
}: {
  plan: ReturnType<typeof usePlan>;
  privacy: boolean;
}) {
  const { annual, fy } = plan;

  if (annual === null) {
    return (
      <Card title="Annual expense">
        <Problem>
          The plan mixes currencies, so there is no single total. Convert each figure at its own
          date first.
        </Problem>
      </Card>
    );
  }

  return (
    <Card
      title="Annual expense"
      aside={<span className="note">FY {fy}–{String((fy + 1) % 100).padStart(2, '0')}</span>}
    >
      <p className="num" style={{ color: 'var(--ink)', fontSize: '28px', lineHeight: 1.15 }}>
        {formatMoney(annual.total, { privacy })}
      </p>

      <dl className="mt-3.5 flex flex-wrap gap-x-9 gap-y-2.5">
        <Figure label="Categories" amount={annual.bySource.category} privacy={privacy} />
        <Figure label="Loans" amount={annual.bySource.liability} privacy={privacy} />
        <Figure label="Policies" amount={annual.bySource.policy} privacy={privacy} />
        <Figure label="Compulsory" amount={annual.compulsory} privacy={privacy} />
      </dl>

      {annual.unplanned.length > 0 && (
        <p
          className="mt-3.5 rounded px-2.5 py-2 text-caption"
          style={{ background: 'var(--coral-soft)', color: 'var(--coral)' }}
        >
          <span aria-hidden="true">▲</span>{' '}
          {annual.unplanned.length === 1
            ? '1 category has no planned figure'
            : `${String(annual.unplanned.length)} categories have no planned figure`}
          , so this total is a floor rather than an estimate:{' '}
          <span className="num">{annual.unplanned.join(', ')}</span>
        </p>
      )}

      <p className="note mt-3.5">
        Monthly figures are counted twelve times, yearly once. Loans and policies are counted
        because they leave the account like anything else — a plan that omitted them would understate
        the year and, through it, everything built on it.
      </p>
    </Card>
  );
}

function Figure({
  label,
  amount,
  privacy,
}: {
  label: string;
  amount: { minor: bigint; currency: string };
  privacy: boolean;
}) {
  return (
    <div>
      <dt className="micro-label">{label}</dt>
      <dd className="num" style={{ color: 'var(--ink-2)' }}>
        {formatMoney(amount, { privacy })}
      </dd>
    </div>
  );
}

/**
 * The target, and what it becomes as prices rise.
 *
 * A retirement number is about a year — the one you are aiming at — so that
 * year leads and the ladder supports it. Showing every year of a projection as
 * a table of equal rows says none of them matters more than the others, which
 * is false: one of them is the answer and the rest are context.
 *
 * The horizon and the multiple are both the reader's to choose. Twenty-five
 * times is the four-percent rule and six per cent is a guess about India;
 * neither is a fact, and an app that hard-codes them is quietly asserting they
 * are.
 */
function FireCard({ plan, privacy }: { plan: ReturnType<typeof usePlan>; privacy: boolean }) {
  const {
    ladder,
    multiplier,
    setMultiplier,
    inflationPct,
    setInflationPct,
    yearsAhead,
    setYearsAhead,
    annual,
  } = plan;
  const [everyYear, setEveryYear] = useState(false);

  if (annual === null) return null;

  const target = ladder[ladder.length - 1];
  const baseYear = ladder[0]?.year ?? 0;

  // Milestones rather than a row per year: the first, the last, and every
  // fifth in between. A long projection is otherwise a wall of numbers that
  // differ from their neighbours by six per cent and from the point by more.
  const shown = everyYear
    ? ladder
    : ladder.filter(
        (step, index) => index === 0 || index === ladder.length - 1 || (step.year - baseYear) % 5 === 0,
      );

  return (
    <Card
      title="FIRE target"
      aside={
        <label className="flex items-center gap-2">
          <span className="micro-label">Retiring in</span>
          <input
            className="field field-num w-[62px]"
            inputMode="numeric"
            value={String(yearsAhead)}
            onChange={(event) => {
              const next = Number(event.target.value.replace(/\D/g, ''));
              // Bounded at sixty: beyond that the compounding dominates and the
              // figure stops being a plan and becomes a curiosity.
              if (Number.isFinite(next)) setYearsAhead(Math.min(60, next));
            }}
          />
          <span className="note">years</span>
        </label>
      }
    >
      {target !== undefined && (
        <div className="mb-4.5">
          <p className="num" style={{ color: 'var(--ink)', fontSize: '28px', lineHeight: 1.15 }}>
            {formatMoney(target.target, { privacy })}
          </p>
          <p className="note">
            what {multiplier}× your spending would cost in <strong>{target.year}</strong>, if prices
            rise {inflationPct}% a year
          </p>
        </div>
      )}

      <div className="mb-3.5 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="micro-label">Multiple of annual spending</span>
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="segmented" role="group" aria-label="Multiplier">
              {MULTIPLIERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={multiplier === option}
                  onClick={() => {
                    setMultiplier(option);
                  }}
                >
                  {option}×
                </button>
              ))}
            </span>
            <input
              className="field field-num w-[76px]"
              inputMode="decimal"
              aria-label="Custom multiple"
              value={String(multiplier)}
              onChange={(event) => {
                const next = Number(event.target.value.replace(/[^\d.]/g, ''));
                if (Number.isFinite(next) && next > 0) setMultiplier(next);
              }}
            />
            <span className="note">× — or any figure you prefer</span>
          </span>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="micro-label">Inflation</span>
          <span className="flex items-center gap-2">
            <input
              className="field field-num w-[62px]"
              inputMode="decimal"
              value={String(inflationPct)}
              onChange={(event) => {
                const next = Number(event.target.value.replace(/[^\d.]/g, ''));
                if (Number.isFinite(next)) setInflationPct(next);
              }}
            />
            <span className="note">% a year</span>
          </span>
        </label>
      </div>

      <div className="scroll-x">
        <table className="w-full border-collapse text-cell">
          <thead>
            <tr>
              <th
                scope="col"
                className="micro-label px-2.5 py-2 text-left"
                style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}
              >
                Year
              </th>
              <th
                scope="col"
                className="micro-label px-2.5 py-2 text-right"
                style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}
              >
                Target at {multiplier}×
              </th>
            </tr>
          </thead>
          <tbody className="row-separated">
            {shown.map((step) => {
              const isTarget = step.year === target?.year;
              const isToday = step.year === baseYear;
              return (
                <tr key={step.year}>
                  <td
                    className="num px-2.5 py-2"
                    style={{ color: isTarget || isToday ? 'var(--ink)' : 'var(--muted)' }}
                  >
                    {step.year}
                    {isToday && <span className="note"> · today</span>}
                    {isTarget && !isToday && <span className="note"> · your target</span>}
                  </td>
                  <td
                    className="num px-2.5 py-2 text-right"
                    style={{ color: 'var(--ink)', fontWeight: isTarget ? 600 : 400 }}
                  >
                    {formatMoney(step.target, { privacy })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {ladder.length > 3 && (
        <button
          type="button"
          className="note mt-2.5 underline"
          onClick={() => {
            setEveryYear((on) => !on);
          }}
        >
          {everyYear ? 'Show milestones only' : `Show all ${String(ladder.length)} years`}
        </button>
      )}

      <p className="note mt-3">
        Each year is the one before it plus {inflationPct}%, compounded, and the ladder starts at
        this year rather than at whenever it was last set up — which is how a target quietly stops
        being enough. Which multiple is right is a judgement about risk, so the app shows what you
        ask for and recommends nothing.
      </p>
    </Card>
  );
}

function Categories({
  plan,
  privacy,
  editable,
}: {
  plan: ReturnType<typeof usePlan>;
  privacy: boolean;
  editable: boolean;
}) {
  const { rows, listing } = plan;
  const [showArchived, setShowArchived] = useState(false);

  const visible = useMemo(
    () => rows.filter((row) => showArchived || !row.isArchived),
    [rows, showArchived],
  );

  // Grouped by nature, because that is the workbook's primary split and the
  // one that means something: what the household must spend, and what it
  // chooses to.
  const groups = useMemo(
    () => [
      { nature: 'fixed' as const, label: 'Compulsory', rows: visible.filter((r) => r.nature === 'fixed') },
      { nature: 'variable' as const, label: 'As needed', rows: visible.filter((r) => r.nature === 'variable') },
    ],
    [visible],
  );

  const plannedCount = rows.filter((r) => r.monthly !== null || r.yearly !== null).length;

  if (listing === null) return null;

  return (
    <Card
      title="Categories"
      collapsible
      // Folded to begin with once the list is long enough to push everything
      // else off the screen. Three dozen rows above the loans card means the
      // loans card is never seen.
      defaultOpen={rows.length <= 12}
      summary={
        rows.length === 0
          ? 'None yet.'
          : `${String(rows.length)} categories, ${String(plannedCount)} with a planned figure.`
      }
      aside={
        <button
          type="button"
          className="note underline"
          onClick={() => {
            setShowArchived((on) => !on);
          }}
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
      }
    >
      {rows.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="note">
            No categories yet. The workbook&rsquo;s list is a starting point — add, rename, reorder
            and archive them freely afterwards.
          </p>
          {editable && (
            <Button
              type="button"
              onClick={() => {
                void plan.seed();
              }}
            >
              Start from the standard list
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4.5">
          {groups.map((group) =>
            group.rows.length === 0 ? null : (
              <div key={group.nature} className="flex flex-col gap-2.5">
                <span className="micro-label">
                  {group.label} · {group.rows.length}
                </span>
                {group.rows.map((row) => (
                  <CategoryRow
                    key={row.categoryId}
                    row={row}
                    currency={listing.household.baseCurrency}
                    privacy={privacy}
                    editable={editable}
                    onSave={plan.saveBudget}
                    onArchive={plan.setArchived}
                  />
                ))}
              </div>
            ),
          )}
        </div>
      )}

      {editable && rows.length > 0 && <NewCategory onAdd={plan.createCategory} />}
    </Card>
  );
}

function CategoryRow({
  row,
  currency,
  privacy,
  editable,
  onSave,
  onArchive,
}: {
  row: CategoryPlan;
  currency: string;
  privacy: boolean;
  editable: boolean;
  onSave: (categoryId: string, cadence: 'monthly' | 'yearly', planned: bigint) => Promise<void>;
  onArchive: (categoryId: string, archived: boolean) => Promise<void>;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2.5 rounded px-2.5 py-2"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        opacity: row.isArchived ? 0.55 : 1,
      }}
    >
      <span className="min-w-[150px] flex-1" style={{ color: 'var(--ink)' }}>
        {row.name}
      </span>

      <Pill tone={row.nature === 'fixed' ? 'own' : 'neutral'}>
        {row.nature === 'fixed' ? 'compulsory' : 'as needed'}
      </Pill>

      <BudgetField
        label="Monthly"
        current={row.monthly?.planned ?? null}
        currency={currency}
        privacy={privacy}
        editable={editable && !row.isArchived}
        onSave={(minor) => onSave(row.categoryId, 'monthly', minor)}
      />
      <BudgetField
        label="Yearly"
        current={row.yearly?.planned ?? null}
        currency={currency}
        privacy={privacy}
        editable={editable && !row.isArchived}
        onSave={(minor) => onSave(row.categoryId, 'yearly', minor)}
      />

      {editable && (
        <button
          type="button"
          className="note underline"
          onClick={() => {
            void onArchive(row.categoryId, !row.isArchived);
          }}
        >
          {row.isArchived ? 'Restore' : 'Archive'}
        </button>
      )}
    </div>
  );
}

/**
 * One planned figure, edited in place.
 *
 * Blank means unplanned rather than zero, and the two are shown differently:
 * an empty field says nobody has decided, a zero says somebody decided nothing.
 * The annual total treats them differently too.
 */
function BudgetField({
  label,
  current,
  currency,
  privacy,
  editable,
  onSave,
}: {
  label: string;
  current: { minor: bigint; currency: string } | null;
  currency: string;
  privacy: boolean;
  editable: boolean;
  onSave: (minor: bigint) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = current === null ? '' : (Number(current.minor) / 100).toString();

  const commit = useCallback(async () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === '' || text === shown) return;

    setBusy(true);
    try {
      await onSave(parseAmountToMinor(text, currency));
    } catch {
      // The field returns to the stored value; the row above says what failed.
    } finally {
      setBusy(false);
    }
  }, [draft, shown, onSave, currency]);

  if (!editable) {
    return (
      <span className="w-[112px] shrink-0">
        <span className="micro-label">{label}</span>
        <span className="num block" style={{ color: 'var(--ink-2)' }}>
          {current === null ? <span className="note">—</span> : formatMoney(current, { privacy })}
        </span>
      </span>
    );
  }

  return (
    <label className="flex w-[112px] shrink-0 flex-col gap-1">
      <span className="micro-label">{label}</span>
      <input
        className="field field-num"
        inputMode="decimal"
        placeholder="—"
        disabled={busy}
        value={draft ?? shown}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
}

function NewCategory({
  onAdd,
}: {
  onAdd: (name: string, nature: 'fixed' | 'variable') => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [nature, setNature] = useState<'fixed' | 'variable'>('variable');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-3.5 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          setBusy(true);
          try {
            await onAdd(name, nature);
            setName('');
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <div className="w-full sm:w-auto sm:min-w-[170px] sm:flex-1">
        <Field
          label="New category"
          placeholder="Something you spend on"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <label className="flex w-full flex-col gap-1.5 sm:w-[150px] sm:shrink-0">
        <span className="micro-label">Nature</span>
        <select
          className="field"
          value={nature}
          onChange={(event) => {
            setNature(event.target.value as 'fixed' | 'variable');
          }}
        >
          <option value="fixed">compulsory</option>
          <option value="variable">as needed</option>
        </select>
      </label>
      <Button type="submit" disabled={busy || name.trim() === ''}>
        Add
      </Button>
    </form>
  );
}

function Commitments({
  plan,
  privacy,
  editable,
}: {
  plan: ReturnType<typeof usePlan>;
  privacy: boolean;
  editable: boolean;
}) {
  const { listing } = plan;
  if (listing === null) return null;

  const count = listing.liabilities.length + listing.policies.length;

  return (
    <Card
      title="Loans and policies"
      collapsible
      defaultOpen={count <= 8}
      summary={count === 0 ? 'None yet.' : `${String(count)} recorded.`}
    >
      <p className="note mb-3">
        These leave the account like any other spending and count toward the year. What makes a loan
        reduce net worth and a policy not — principal, cover, renewal — belongs with the screen that
        answers that question, and is not recorded here yet.
      </p>

      {listing.liabilities.length === 0 && listing.policies.length === 0 ? (
        <p className="note">Nothing recorded yet.</p>
      ) : (
        <ul className="row-separated">
          {listing.liabilities.map((liability) => (
            <CommitmentRow
              key={liability.id}
              name={liability.name}
              kind={liability.kind.replace(/_/g, ' ')}
              amount={liability.instalment}
              cadence={liability.cadence}
              inactive={liability.isClosed}
              privacy={privacy}
            />
          ))}
          {listing.policies.map((policy) => (
            <CommitmentRow
              key={policy.id}
              name={policy.name}
              kind={policy.kind.replace(/_/g, ' ')}
              amount={policy.premium}
              cadence={policy.cadence}
              inactive={policy.isLapsed}
              privacy={privacy}
            />
          ))}
        </ul>
      )}

      {editable && <NewCommitment plan={plan} />}
    </Card>
  );
}

function CommitmentRow({
  name,
  kind,
  amount,
  cadence,
  inactive,
  privacy,
}: {
  name: string;
  kind: string;
  amount: { minor: bigint; currency: string } | null;
  cadence: CommitmentCadence;
  inactive: boolean;
  privacy: boolean;
}) {
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2.5 py-2.5"
      style={inactive ? { opacity: 0.55 } : undefined}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span style={{ color: 'var(--ink)' }}>{name}</span>
        <Pill tone="neutral">{kind}</Pill>
        {inactive && <Pill tone="due">not counted</Pill>}
      </span>
      <span className="num" style={{ color: 'var(--ink)' }}>
        {amount === null ? <span className="note">not set</span> : formatMoney(amount, { privacy })}
        <span className="note"> / {cadence.replace(/_/g, ' ')}</span>
      </span>
    </li>
  );
}

function NewCommitment({ plan }: { plan: ReturnType<typeof usePlan> }) {
  const { listing } = plan;
  const [what, setWhat] = useState<'liability' | 'policy'>('liability');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('home_loan');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<CommitmentCadence>('yearly');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kinds = what === 'liability' ? LIABILITY_KINDS : POLICY_KINDS;

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (listing === null) return;
      setProblem(null);

      let minor: bigint;
      try {
        minor = parseAmountToMinor(amount, listing.household.baseCurrency);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'That is not an amount.');
        return;
      }

      setBusy(true);
      try {
        const common = {
          householdId: listing.household.id,
          name,
          cadence,
        };
        if (what === 'liability') {
          await plan.createLiability({
            ...common,
            kind: kind as LiabilityKind,
            instalment: money(minor, listing.household.baseCurrency),
          });
        } else {
          await plan.createPolicy({
            ...common,
            kind: kind as PolicyKind,
            premium: money(minor, listing.household.baseCurrency),
          });
        }
        setName('');
        setAmount('');
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not add that.');
      } finally {
        setBusy(false);
      }
    },
    [amount, cadence, kind, listing, name, plan, what],
  );

  return (
    <form
      className="mt-3.5 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <label className="flex w-full flex-col gap-1.5 sm:w-[130px] sm:shrink-0">
        <span className="micro-label">Add</span>
        <select
          className="field"
          value={what}
          onChange={(event) => {
            const next = event.target.value as 'liability' | 'policy';
            setWhat(next);
            setKind(next === 'liability' ? 'home_loan' : 'health');
          }}
        >
          <option value="liability">a loan</option>
          <option value="policy">a policy</option>
        </select>
      </label>

      <div className="w-full sm:w-auto sm:min-w-[160px] sm:flex-1">
        <Field
          label="Name"
          placeholder={what === 'liability' ? 'Home loan' : 'Health cover'}
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <label className="flex w-full flex-col gap-1.5 sm:w-[150px] sm:shrink-0">
        <span className="micro-label">Kind</span>
        <select
          className="field"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
          }}
        >
          {kinds.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>

      <div className="w-full sm:w-[130px] sm:shrink-0">
        <Field
          label="Amount"
          numeric
          inputMode="decimal"
          placeholder="0.00"
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>

      <label className="flex w-full flex-col gap-1.5 sm:w-[140px] sm:shrink-0">
        <span className="micro-label">Every</span>
        <select
          className="field"
          value={cadence}
          onChange={(event) => {
            setCadence(event.target.value as CommitmentCadence);
          }}
        >
          {COMMITMENT_CADENCES.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" disabled={busy || name.trim() === '' || amount.trim() === ''}>
        Add
      </Button>

      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

export type { PlanListing };
