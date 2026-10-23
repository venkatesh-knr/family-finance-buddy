/**
 * The forms behind a policy: the details that are not figures, and the form that adds one.
 *
 * Every column the table has is offered, and none is required beyond the three a policy cannot be without: a form
 * that never offered a field makes data that cannot be repaired later (detail-level.md section 5).
 */

import { useState } from 'react';
import type { IsoDate } from '../../lib/dates.ts';
import { money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import { addPolicy, updatePolicy, type PolicyDetail } from '../../repo/planning.ts';
import {
  COMMITMENT_CADENCES,
  POLICY_KINDS,
  type CommitmentCadence,
  type Holding,
  type InsurancePolicy,
  type PolicyKind,
} from '../../repo/types.ts';
import { Button, Field, Problem } from '../../ui/primitives.tsx';
import { isHybrid, policyKindLabel } from './labels.ts';

function holdingOptions(holdings: readonly Holding[]): { id: string; label: string }[] {
  return holdings
    .filter((h) => !h.isArchived)
    .map((h) => ({ id: h.id, label: `${h.instrument.name} · ${h.member.displayName}` }));
}

/** The details of a policy that are not figures: everything else the table has. */
export function PolicyDetails({
  policy,
  holdings,
  members,
  onSave,
  onCancel,
  bare = false,
}: {
  policy: InsurancePolicy;
  holdings: readonly Holding[];
  members: readonly { id: string; displayName: string; isArchived: boolean }[];
  onSave: (patch: Parameters<typeof updatePolicy>[1]) => Promise<void>;
  onCancel: () => void;
  /** Inside a panel that already has the recessed ground, so it does not lay a second one over it. */
  bare?: boolean;
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
    <div className={bare ? 'mt-3.5' : 'inset-form mt-2.5'}>
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

export function NewPolicy({
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
