import { useCallback, useMemo, useState } from 'react';
import { latestValuationPerHolding } from '../../domain/networth.ts';
import { formatIsoDate, type IsoDate } from '../../lib/dates.ts';
import { money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import {
  addPolicy,
  canPlan,
  setCoverDependencyYears,
  updatePolicy,
  type PolicyDetail,
} from '../../repo/planning.ts';
import {
  COMMITMENT_CADENCES,
  POLICY_KINDS,
  type CommitmentCadence,
  type Holding,
  type InsurancePolicy,
  type PolicyKind,
} from '../../repo/types.ts';
import { Absent, Amount, Button, Card, Caveat, Field, Pill, Problem, RowAction } from '../../ui/primitives.tsx';
import { DraftNumber } from '../plan/DraftNumber.tsx';
import { usePlan } from '../plan/usePlan.ts';
import { useOverviewData } from '../overview/useOverviewData.ts';
import { insuranceFacts, type InsuranceFacts, type PolicyFacts } from './insuranceFacts.ts';
import { isHybrid, policyKindLabel } from './labels.ts';
import { DateField } from './DateField.tsx';
import { MoneyField } from './MoneyField.tsx';

/**
 * Insurance (docs/design/protection-and-flow.md §1 and §5).
 *
 * One question beyond storage: is the household under-covered? The answer is a stated calculation with
 * every input on the face of the screen, and never a recommendation: a number that looks like advice
 * will be read as advice, and the app is not licensed to give it. Health cover has no suggested figure at
 * all, only what is in force.
 *
 * A policy has a cover and no value. Cover is read here and nowhere near net worth, allocation or FIRE
 * (PF-C3), and a ULIP's surrender value is a holding's, carried on the holding it cites.
 */
export function InsuranceScreen({ privacy, householdId }: { privacy: boolean; householdId: string | null }) {
  const plan = usePlan(householdId);
  const data = useOverviewData({ householdId, displayCurrency: '', scope: 'household' });
  const [problem, setProblem] = useState<string | null>(null);

  const listing = plan.listing;
  const editable = listing !== null && canPlan(listing.viewer.role);

  const surrenderValues = useMemo(() => {
    const map = new Map<string, Money>();
    for (const [id, reading] of latestValuationPerHolding(data.valuations)) map.set(id, reading.amount);
    return map;
  }, [data.valuations]);

  const facts = useMemo<InsuranceFacts | null>(() => {
    if (listing === null) return null;
    return insuranceFacts({
      policies: listing.policies,
      liabilities: listing.liabilities,
      surrenderValues,
      annual: plan.annual,
      years: listing.household.coverDependencyYears,
      liquid: data.fire.liquid.ok ? data.fire.liquid.amount : null,
      base: listing.household.baseCurrency,
      rates: data.rates,
      today: plan.today,
    });
  }, [listing, plan.annual, plan.today, surrenderValues, data.fire.liquid, data.rates]);

  const refresh = useCallback(async () => {
    plan.reload();
    await data.load();
  }, [plan, data]);

  // Only before there is anything to show. A save reloads in the background and swaps the figures in place:
  // unmounting every row and the open editor on each edit threw away the focus a person had just moved.
  if ((plan.loading && plan.listing === null) || (data.loading && data.listing === null)) {
    return <p className="note px-4.5 py-4.5">Loading…</p>;
  }
  if (plan.noHousehold || data.noHousehold) return null;
  if (plan.problem !== null || data.problem !== null || listing === null || facts === null) {
    return <Problem>{plan.problem ?? data.problem ?? 'Could not read the policies.'}</Problem>;
  }

  const base = listing.household.baseCurrency;

  return (
    <div className="flex flex-col gap-4.5">
      <CoverGap
        facts={facts}
        years={listing.household.coverDependencyYears}
        base={base}
        privacy={privacy}
        editable={editable}
        onYears={async (years) => {
          setProblem(null);
          try {
            await setCoverDependencyYears(listing.household.id, years);
            await refresh();
          } catch (error) {
            setProblem(error instanceof Error ? error.message : 'Could not save that.');
          }
        }}
      />

      {problem !== null && <Problem>{problem}</Problem>}

      <Card
        title="Policies"
        aside={
          <Caveat tone="info" label="What cover is, and what it is not">
            A policy has a cover and no value. The cover is what it pays out if it is claimed; it is not
            money the household owns and is never added to net worth, the allocation or the FIRE corpus.
            A ULIP or an endowment also has a surrender value, which is a holding&rsquo;s and is carried on
            the holding the policy cites.
          </Caveat>
        }
      >
        {listing.policies.length === 0 ? (
          <p className="note">No policies recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {listing.policies.map((policy) => (
              <PolicyRow
                key={policy.id}
                policy={policy}
                facts={facts.byPolicy.get(policy.id)}
                memberName={listing.members.find((m) => m.id === policy.memberId)?.displayName ?? null}
                holdings={data.listing?.holdings ?? []}
                members={listing.members}
                privacy={privacy}
                editable={editable}
                onChanged={refresh}
                onProblem={setProblem}
              />
            ))}
          </div>
        )}

        {editable && (
          <NewPolicy
            householdId={listing.household.id}
            base={base}
            holdings={data.listing?.holdings ?? []}
            members={listing.members}
            onAdded={refresh}
          />
        )}
      </Card>

      <HealthCover facts={facts} members={listing.members} privacy={privacy} />
    </div>
  );
}

/**
 * Health cover is a list and has no suggested figure (protection-and-flow.md section 5): what is in force,
 * by whose it is, with its renewal and the sum insured. A floater is the household's. Any "recommended
 * health cover" would be invented, so there is none.
 */
function HealthCover({
  facts,
  members,
  privacy,
}: {
  facts: InsuranceFacts;
  members: readonly { id: string; displayName: string }[];
  privacy: boolean;
}) {
  if (facts.healthByMember.length === 0) return null;
  return (
    <Card title="Health cover in force" aside={<span className="note">no suggested figure</span>}>
      <div className="flex flex-col gap-3.5" data-testid="health-cover">
        {facts.healthByMember.map((group) => (
          <section key={group.memberId ?? 'household'}>
            <p className="label">
              {group.memberId === null
                ? 'The household (a floater)'
                : (members.find((m) => m.id === group.memberId)?.displayName ?? 'A member')}
            </p>
            <ul className="row-separated mt-1">
              {group.policies.map((policy) => (
                <li key={policy.id} className="flex flex-wrap items-baseline justify-between gap-2.5 py-2">
                  <span>
                    {policy.name}
                    {policy.insurer !== null && <span className="note"> · {policy.insurer}</span>}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span>
                      {policy.cover === null ? (
                        <span className="note">cover not recorded</span>
                      ) : (
                        <span className="num">
                          <Amount value={policy.cover} privacy={privacy} compact />
                        </span>
                      )}
                    </span>
                    <span className="note">
                      {policy.renewalOn === null ? 'renewal not recorded' : `renews ${formatIsoDate(policy.renewalOn)}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

function CoverGap({
  facts,
  years,
  base,
  privacy,
  editable,
  onYears,
}: {
  facts: InsuranceFacts;
  years: number;
  base: string;
  privacy: boolean;
  editable: boolean;
  onYears: (years: number) => Promise<void>;
}) {
  const gap = facts.gap;
  const notes = facts.notes;

  return (
    <Card
      lift
      title="Is the household covered?"
      aside={
        <Caveat tone="info" label="What this calculation is">
          A stated calculation from the figures on this card, every one of them the household&rsquo;s own.
          It is not a recommendation: the app does not know how old the children are or when the mortgage
          ends, and is not licensed to say how much cover to buy. Change any figure and it changes.
        </Caveat>
      }
    >
      {gap === null ? (
        <Absent label="Why there is no cover gap">
          {facts.gapRefusedBecause === null ? 'Nothing to work out yet.' : `There is no figure yet: ${facts.gapRefusedBecause}`}
        </Absent>
      ) : (
        <div data-testid="cover-gap">
          <dl className="flex flex-col gap-2.5">
            <Row label="What is still owed on loans" value={gap.liabilities} privacy={privacy} />
            <div className="flex items-baseline justify-between gap-2.5">
              <dt className="note min-w-0">
                What the household spends in a year{facts.annualForCover !== null && (
                  <>
                    {' '}
                    (<Amount value={facts.annualForCover} privacy={privacy} compact />, without loan instalments)
                  </>
                )}, over{' '}
                {editable && !privacy ? (
                  <DraftNumber
                    className="field field-num inline-field"
                    ariaLabel="Years of dependency"
                    value={years}
                    range={{ min: 0, max: 50, integer: true }}
                    onSave={(next) => {
                      void onYears(next);
                    }}
                  />
                ) : (
                  <strong>{String(years)}</strong>
                )}{' '}
                years
              </dt>
              <dd className="num shrink-0">
                <Amount value={gap.expensesOverYears} privacy={privacy} compact />
              </dd>
            </div>
            <Row label="Less money that could be had in an emergency" value={gap.liquidCorpus} privacy={privacy} negative />
            <Row label="Suggested cover, by this arithmetic" value={gap.suggested} privacy={privacy} strong />
            {facts.termCount === 0 ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2.5">
                <dt className="note">Term cover in force</dt>
                <dd className="note">none recorded</dd>
              </div>
            ) : (
              <Row label="Term cover in force" value={gap.termCover} privacy={privacy} />
            )}
          </dl>

          <p className="mt-3.5" data-testid="cover-gap-result">
            {gap.short.minor > 0n ? (
              <>
                <strong>Short by </strong>
                <span className="num">
                  <Amount value={gap.short} privacy={privacy} compact />
                </span>
                <span className="note"> on these figures.</span>
              </>
            ) : (
              <span className="note">The cover in force is not below what this arithmetic gives.</span>
            )}
          </p>
        </div>
      )}

      {notes.map((note) => (
        <p key={note} className="note mt-2.5">
          {note}
        </p>
      ))}

      <p className="note mt-2.5">
        In {base}. The years of expenses are the household&rsquo;s own setting (ten until changed). A loan&rsquo;s
        instalments are left out of the year&rsquo;s expenses because what is still owed on it is already in the sum
        {facts.instalmentsLeftOut !== null && facts.instalmentsLeftOut.minor > 0n && (
          <>
            {' '}
            (<Amount value={facts.instalmentsLeftOut} privacy={privacy} compact /> a year)
          </>
        )}. Other members&rsquo; private holdings are not in the money that could be had. Health cover has no
        suggested figure: what is in force is below, with its renewal.
      </p>
    </Card>
  );
}

function Row({
  label,
  value,
  privacy,
  negative = false,
  strong = false,
}: {
  label: string;
  value: Money;
  privacy: boolean;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2.5">
      <dt className={strong ? 'min-w-0' : 'note min-w-0'} style={strong ? { color: 'var(--ink)', fontWeight: 600 } : undefined}>
        {label}
      </dt>
      <dd className="num shrink-0" style={strong ? { color: 'var(--ink)', fontWeight: 600 } : undefined}>
        {negative && !privacy ? '−' : ''}
        <Amount value={value} privacy={privacy} compact />
      </dd>
    </div>
  );
}

function PolicyRow({
  policy,
  facts,
  memberName,
  holdings,
  members,
  privacy,
  editable,
  onChanged,
  onProblem,
}: {
  policy: InsurancePolicy;
  facts: PolicyFacts | undefined;
  memberName: string | null;
  holdings: readonly Holding[];
  members: readonly { id: string; displayName: string; isArchived: boolean }[];
  privacy: boolean;
  editable: boolean;
  onChanged: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const currency = policy.premium?.currency ?? policy.cover?.currency ?? 'INR';

  const save = useCallback(
    async (patch: Parameters<typeof updatePolicy>[1]) => {
      onProblem(null);
      await updatePolicy(policy.id, patch);
      await onChanged();
    },
    [policy.id, onChanged, onProblem],
  );

  return (
    <div>
      <div className="edit-row">
        <span className="edit-row-name">
          <span style={{ color: 'var(--ink)' }}>{policy.name}</span>
          <Pill tone="neutral">{policyKindLabel(policy.kind)}</Pill>
          {policy.insurer !== null && <span className="note">{policy.insurer}</span>}
          {policy.policyLast4 !== null && <span className="note">…{policy.policyLast4}</span>}
          {memberName !== null && <span className="note">{memberName}</span>}
          {/* Said in a word: dimming a row says it in opacity alone. */}
          {policy.isLapsed && <Pill tone="warn">lapsed</Pill>}
        </span>

        <span className="edit-row-fields">
          <MoneyField
            label="Cover"
            current={policy.cover}
            currency={currency}
            privacy={privacy}
            editable={editable && !policy.isLapsed}
            onSave={(next) => save({ cover: next })}
            onProblem={onProblem}
          />
          <MoneyField
            label={`Premium / ${policy.cadence.replace(/_/g, ' ')}`}
            current={policy.premium}
            currency={currency}
            privacy={privacy}
            editable={editable && !policy.isLapsed}
            onSave={(next) => (next === null ? Promise.resolve() : save({ premium: next }))}
            onProblem={onProblem}
          />
          <DateField
            label="Renews"
            value={policy.renewalOn}
            editable={editable && !policy.isLapsed}
            onSave={(next) => save({ renewalOn: next })}
            onProblem={onProblem}
          />
        </span>

        {editable && (
          <span className="edit-row-act flex">
            <RowAction
              icon="edit"
              label={`Edit ${policy.name}`}
              expanded={editing}
              onClick={() => {
                setEditing((open) => !open);
              }}
            />
            <RowAction
              icon={policy.isLapsed ? 'restore' : 'archive'}
              label={policy.isLapsed ? `Reinstate ${policy.name}` : `Lapse ${policy.name}`}
              onClick={() => {
                void save({ lapsed: !policy.isLapsed }).catch(report(onProblem));
              }}
            />
          </span>
        )}
      </div>

      {facts !== undefined && policy.linkedHoldingId !== null && (
        <HybridLine facts={facts} privacy={privacy} />
      )}

      {editing && (
        <PolicyDetails
          policy={policy}
          holdings={holdings}
          members={members}
          onSave={async (patch) => {
            await save(patch);
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function report(onProblem: (message: string | null) => void): (error: unknown) => void {
  return (error) => {
    onProblem(error instanceof Error ? error.message : 'Could not save that.');
  };
}

/** What has been paid in against what it would pay out today: both facts, set side by side and not editorialised. */
function HybridLine({ facts, privacy }: { facts: PolicyFacts; privacy: boolean }) {
  if (facts.paidIn === null || facts.surrenderValue === null || facts.behind === null) {
    return (
      <p className="note mt-1.5 px-1">
        {facts.surrenderValue === null
          ? 'The holding that carries its surrender value has not been valued yet.'
          : 'Add when the policy started and its premium to see what has fallen due.'}
      </p>
    );
  }
  const behind = facts.behind.minor;
  return (
    <p className="note mt-1.5 px-1" data-testid="surrender-gap">
      Premiums due so far <Amount value={facts.paidIn} privacy={privacy} compact /> (counted from when it began, and
      stopping at a lapse or the end of the premium term, so it is what fell due and not a record of what was paid); it would pay out{' '}
      <Amount value={facts.surrenderValue} privacy={privacy} compact /> today
      {behind > 0n ? (
        <>
          : the household is <Amount value={facts.behind} privacy={privacy} compact /> behind the premiums that have fallen due.
        </>
      ) : (
        <>
          : <Amount value={money(-behind, facts.behind.currency)} privacy={privacy} compact /> ahead of the premiums that
          have fallen due.
        </>
      )}
    </p>
  );
}

function holdingOptions(holdings: readonly Holding[]): { id: string; label: string }[] {
  return holdings
    .filter((h) => !h.isArchived)
    .map((h) => ({ id: h.id, label: `${h.instrument.name} · ${h.member.displayName}` }));
}

/** The details of a policy that are not figures: everything else the table has. */
function PolicyDetails({
  policy,
  holdings,
  members,
  onSave,
  onCancel,
}: {
  policy: InsurancePolicy;
  holdings: readonly Holding[];
  members: readonly { id: string; displayName: string; isArchived: boolean }[];
  onSave: (patch: Parameters<typeof updatePolicy>[1]) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(policy.name);
  const [kind, setKind] = useState<PolicyKind>(policy.kind);
  const [cadence, setCadence] = useState<CommitmentCadence>(policy.cadence);
  const [insurer, setInsurer] = useState(policy.insurer ?? '');
  const [last4, setLast4] = useState(policy.policyLast4 ?? '');
  const [startedOn, setStartedOn] = useState<string>(policy.startedOn ?? '');
  const [premiumsEndOn, setPremiumsEndOn] = useState<string>(policy.premiumsEndOn ?? '');
  const [note, setNote] = useState(policy.note ?? '');
  const [linked, setLinked] = useState(policy.linkedHoldingId ?? '');
  const [memberId, setMemberId] = useState(policy.memberId ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setProblem(null);
    setBusy(true);
    try {
      await onSave({
        name,
        kind,
        cadence,
        insurer: insurer.trim() === '' ? null : insurer,
        policyLast4: last4.trim() === '' ? null : last4,
        startedOn: startedOn === '' ? null : (startedOn as IsoDate),
        premiumsEndOn: premiumsEndOn === '' ? null : (premiumsEndOn as IsoDate),
        note: note.trim() === '' ? null : note,
        // A surrender value belongs to a hybrid policy: changing the kind away from one lets go of the
        // holding here, where the reason can be said, and not by a constraint with a code.
        linkedHoldingId: isHybrid(kind) && linked !== '' ? linked : null,
        memberId: memberId === '' ? null : memberId,
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inset-form mt-2.5">
      <PolicyFields
        values={{ name, kind, cadence, insurer, last4, startedOn, premiumsEndOn, note, linked, memberId }}
        set={{
          setName,
          setKind,
          setCadence,
          setInsurer,
          setLast4,
          setStartedOn,
          setPremiumsEndOn,
          setNote,
          setLinked,
          setMemberId,
        }}
        holdings={holdings}
        members={members}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy || name.trim() === ''} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <button type="button" className="note underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {problem !== null && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}
    </div>
  );
}

interface FieldValues {
  name: string;
  kind: PolicyKind;
  cadence: CommitmentCadence;
  insurer: string;
  last4: string;
  startedOn: string;
  premiumsEndOn: string;
  note: string;
  linked: string;
  memberId: string;
}

function PolicyFields({
  values,
  set,
  holdings,
  members,
  onlyDetails = false,
}: {
  values: FieldValues;
  set: {
    setName: (v: string) => void;
    setKind: (v: PolicyKind) => void;
    setCadence: (v: CommitmentCadence) => void;
    setInsurer: (v: string) => void;
    setLast4: (v: string) => void;
    setStartedOn: (v: string) => void;
    setPremiumsEndOn: (v: string) => void;
    setNote: (v: string) => void;
    setLinked: (v: string) => void;
    setMemberId: (v: string) => void;
  };
  holdings: readonly Holding[];
  members: readonly { id: string; displayName: string; isArchived: boolean }[];
  /** The add form already has the name, kind and cadence above its fold, so the fold leaves them out. */
  onlyDetails?: boolean;
}) {
  const options = holdingOptions(holdings);
  return (
    <div className="flex flex-wrap items-end gap-2.5">
      {!onlyDetails && (
        <>
          <div className="w-full sm:w-auto sm:min-w-[170px] sm:flex-1">
            <Field
              label="Name"
              value={values.name}
              onChange={(event) => {
                set.setName(event.target.value);
              }}
            />
          </div>
          <label className="flex w-full flex-col gap-1.5 sm:w-[160px] sm:shrink-0">
            <span className="label">Kind</span>
            <select
              className="field"
              value={values.kind}
              onChange={(event) => {
                set.setKind(event.target.value as PolicyKind);
              }}
            >
              {POLICY_KINDS.map((option) => (
                <option key={option} value={option}>
                  {policyKindLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-full flex-col gap-1.5 sm:w-[140px] sm:shrink-0">
            <span className="label">Premium every</span>
            <select
              className="field"
              value={values.cadence}
              onChange={(event) => {
                set.setCadence(event.target.value as CommitmentCadence);
              }}
            >
              {COMMITMENT_CADENCES.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="w-full sm:w-[170px] sm:shrink-0">
        <Field
          label="Insurer"
          value={values.insurer}
          onChange={(event) => {
            set.setInsurer(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[150px] sm:shrink-0">
        <Field
          label="Policy number, last four"
          maxLength={4}
          hint="Only the last four are kept"
          value={values.last4}
          onChange={(event) => {
            set.setLast4(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[150px] sm:shrink-0">
        <Field
          label="Started"
          type="date"
          value={values.startedOn}
          onChange={(event) => {
            set.setStartedOn(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[170px] sm:shrink-0">
        <Field
          label="Last premium due"
          type="date"
          hint="Blank if premiums have no end"
          value={values.premiumsEndOn}
          onChange={(event) => {
            set.setPremiumsEndOn(event.target.value);
          }}
        />
      </div>
      <label className="flex w-full flex-col gap-1.5 sm:w-[170px] sm:shrink-0">
        <span className="label">Whose</span>
        <select
          className="field"
          value={values.memberId}
          onChange={(event) => {
            set.setMemberId(event.target.value);
          }}
        >
          <option value="">The household</option>
          {members
            .filter((m) => !m.isArchived)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
        </select>
      </label>
      <div className="w-full sm:w-[260px] sm:shrink-0">
        <Field
          label="Note"
          maxLength={500}
          value={values.note}
          onChange={(event) => {
            set.setNote(event.target.value);
          }}
        />
      </div>
      {isHybrid(values.kind) && (
        <label className="flex w-full flex-col gap-1.5 sm:w-[260px] sm:shrink-0">
          <span className="label">Holding that carries its surrender value</span>
          <select
            className="field"
            value={values.linked}
            onChange={(event) => {
              set.setLinked(event.target.value);
            }}
          >
            <option value="">None yet</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function NewPolicy({
  householdId,
  base,
  holdings,
  members,
  onAdded,
}: {
  householdId: string;
  base: string;
  holdings: readonly Holding[];
  members: readonly { id: string; displayName: string; isArchived: boolean }[];
  onAdded: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PolicyKind>('health');
  const [cadence, setCadence] = useState<CommitmentCadence>('yearly');
  const [premium, setPremium] = useState('');
  const [cover, setCover] = useState('');
  const [insurer, setInsurer] = useState('');
  const [last4, setLast4] = useState('');
  const [startedOn, setStartedOn] = useState('');
  const [premiumsEndOn, setPremiumsEndOn] = useState('');
  const [note, setNote] = useState('');
  const [renewalOn, setRenewalOn] = useState('');
  const [linked, setLinked] = useState('');
  const [memberId, setMemberId] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setProblem(null);

    let premiumMinor: bigint;
    let coverMoney: Money | null = null;
    try {
      premiumMinor = parseAmountToMinor(premium, base);
      if (cover.trim() !== '') coverMoney = money(parseAmountToMinor(cover, base), base);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That is not an amount.');
      return;
    }

    setBusy(true);
    try {
      const detail: PolicyDetail = {
        insurer: insurer.trim() === '' ? null : insurer,
        policyLast4: last4.trim() === '' ? null : last4,
        cover: coverMoney,
        startedOn: startedOn === '' ? null : (startedOn as IsoDate),
        premiumsEndOn: premiumsEndOn === '' ? null : (premiumsEndOn as IsoDate),
        note: note.trim() === '' ? null : note,
        renewalOn: renewalOn === '' ? null : (renewalOn as IsoDate),
        linkedHoldingId: isHybrid(kind) && linked !== '' ? linked : null,
        memberId: memberId === '' ? null : memberId,
      };
      await addPolicy({
        householdId,
        name,
        kind,
        premium: money(premiumMinor, base),
        cadence,
        ...detail,
      });
      setName('');
      setPremium('');
      setCover('');
      setInsurer('');
      setLast4('');
      setStartedOn('');
      setPremiumsEndOn('');
      setNote('');
      setRenewalOn('');
      setLinked('');
      setMemberId('');
      await onAdded();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not add that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form mt-3.5"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <p className="label mb-2.5">Add a policy</p>
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="w-full sm:w-auto sm:min-w-[170px] sm:flex-1">
          <Field
            label="Name"
            placeholder="Family health"
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <label className="flex w-full flex-col gap-1.5 sm:w-[160px] sm:shrink-0">
          <span className="label">Kind</span>
          <select
            className="field"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as PolicyKind);
            }}
          >
            {POLICY_KINDS.map((option) => (
              <option key={option} value={option}>
                {policyKindLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <div className="w-full sm:w-[130px] sm:shrink-0">
          <Field
            label={`Premium (${base})`}
            numeric
            inputMode="decimal"
            placeholder="0.00"
            required
            value={premium}
            onChange={(event) => {
              setPremium(event.target.value);
            }}
          />
        </div>
        <label className="flex w-full flex-col gap-1.5 sm:w-[140px] sm:shrink-0">
          <span className="label">Every</span>
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
        <Button type="submit" disabled={busy || name.trim() === '' || premium.trim() === ''}>
          Add
        </Button>
      </div>

      {/*
        Every column the table has is offered, and none is required beyond the three above: a form that
        never offered a field makes data that cannot be repaired later (detail-level.md §5). They are
        folded, because most people need the name, the kind and the premium.
      */}
      <details className="mt-3">
        <summary className="notice-toggle">More details</summary>
        <div className="mt-3 flex flex-wrap items-end gap-2.5">
          <div className="w-full sm:w-[150px] sm:shrink-0">
            <Field
              label={`Cover (${base})`}
              numeric
              inputMode="decimal"
              placeholder="not recorded"
              hint="What it pays if claimed"
              value={cover}
              onChange={(event) => {
                setCover(event.target.value);
              }}
            />
          </div>
          <div className="w-full sm:w-[150px] sm:shrink-0">
            <Field
              label="Renews on"
              type="date"
              value={renewalOn}
              onChange={(event) => {
                setRenewalOn(event.target.value);
              }}
            />
          </div>
        </div>
        <div className="mt-2.5">
          <PolicyFields
            values={{ name, kind, cadence, insurer, last4, startedOn, premiumsEndOn, note, linked, memberId }}
            set={{
              setName,
              setKind,
              setCadence,
              setInsurer,
              setLast4,
              setStartedOn,
              setPremiumsEndOn,
              setNote,
              setLinked,
              setMemberId,
            }}
            holdings={holdings}
            members={members}
            onlyDetails
          />
        </div>
      </details>

      {problem !== null && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}
