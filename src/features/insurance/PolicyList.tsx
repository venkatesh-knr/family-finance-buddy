import { useCallback, useState } from 'react';
import { annualise } from '../../domain/annual-expense.ts';
import type { RenewalDue } from '../../domain/protection.ts';
import { daysBetween, formatIsoDate, formatShortDate, type IsoDate } from '../../lib/dates.ts';
import { updatePolicy } from '../../repo/planning.ts';
import type { Holding, InsurancePolicy } from '../../repo/types.ts';
import { hashFor } from '../../app/route.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { Amount, Button, Pill } from '../../ui/primitives.tsx';
import type { PolicyFacts } from './insuranceFacts.ts';
import { isHybrid } from './labels.ts';
import { DateField } from './DateField.tsx';
import { MoneyField } from './MoneyField.tsx';
import { NewPolicy, PolicyDetails } from './PolicyForms.tsx';
import { policyGroups, renewalPillText } from './policyGroups.ts';
import type { Money } from '../../lib/money.ts';
import { HybridLine } from './HybridLine.tsx';

type Member = { id: string; displayName: string; isArchived: boolean };

/**
 * The policies, grouped as the board draws them: Life, Health, With a surrender value, and Other for what the board
 * has no group for. One row each: the tile, the name, the insurer and whose it is and when it renews, the cover and
 * the yearly premium. Health has no suggested figure, only what is in force.
 *
 * A row is the way in to changing a policy (for a role that can change one): it opens the figures that can be
 * edited in place, the details behind them, and the lapse. A policy has a cover and no value, so the figure on its
 * row is what it pays if it is claimed and is never added to net worth, the allocation or the FIRE corpus (PF-C3);
 * a savings policy's surrender value is a holding's, and the row links to the holding that carries it.
 */
export function PolicyList({
  policies,
  factsOf,
  renewals,
  members,
  holdings,
  base,
  householdId,
  today,
  privacy,
  editable,
  onChanged,
  onProblem,
}: {
  policies: readonly InsurancePolicy[];
  factsOf: (id: string) => PolicyFacts | undefined;
  renewals: readonly RenewalDue[];
  members: readonly Member[];
  holdings: readonly Holding[];
  base: string;
  householdId: string;
  /** Today in IST, to say whether a renewal is close enough to leave its year out. */
  today: IsoDate;
  privacy: boolean;
  editable: boolean;
  onChanged: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const groups = policyGroups(policies);

  return (
    <section aria-label="Policies" className="flex flex-col gap-3">
      <div className="policy-head">
        <h2 className="policy-title">Policies</h2>
        <span className="policy-count tabular-nums">{policies.length}</span>
        <span className="flex-1" />
        {editable && (
          <Button
            type="button"
            aria-expanded={adding}
            onClick={() => {
              setAdding((was) => !was);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="mr-1.5 inline-block align-text-bottom"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add a policy
          </Button>
        )}
      </div>

      {editable && adding && (
        <NewPolicy
          householdId={householdId}
          base={base}
          holdings={holdings}
          members={members}
          onAdded={async () => {
            await onChanged();
            setAdding(false);
          }}
        />
      )}

      {policies.length === 0 && <p className="note">No policies recorded yet.</p>}

      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="policy-group">
            {group.label}
            {group.key === 'health' && <span className="note"> · no suggested figure</span>}
          </h3>
          <ul className="policy-card">
            {group.policies.map((policy) => (
              <PolicyRow
                key={policy.id}
                policy={policy}
                facts={factsOf(policy.id)}
                renewal={renewals.find((due) => due.id === policy.id) ?? null}
                memberName={members.find((m) => m.id === policy.memberId)?.displayName ?? null}
                today={today}
                holdings={holdings}
                members={members}
                privacy={privacy}
                editable={editable}
                onChanged={onChanged}
                onProblem={onProblem}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** A renewal in the coming year is written without its year; one further off, or past, keeps it. */
function renewsSoon(renewalOn: IsoDate, today: IsoDate): boolean {
  const days = daysBetween(today, renewalOn);
  return days >= 0 && days <= 365;
}

function PolicyRow({
  policy,
  facts,
  renewal,
  memberName,
  today,
  holdings,
  members,
  privacy,
  editable,
  onChanged,
  onProblem,
}: {
  policy: InsurancePolicy;
  facts: PolicyFacts | undefined;
  renewal: RenewalDue | null;
  memberName: string | null;
  today: IsoDate;
  holdings: readonly Holding[];
  members: readonly Member[];
  privacy: boolean;
  editable: boolean;
  onChanged: () => Promise<void>;
  onProblem: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const currency = policy.premium?.currency ?? policy.cover?.currency ?? 'INR';
  const hybrid = isHybrid(policy.kind);
  const yearly: Money | null = policy.premium === null ? null : annualise(policy.premium, policy.cadence);

  const save = useCallback(
    async (patch: Parameters<typeof updatePolicy>[1]) => {
      onProblem(null);
      await updatePolicy(policy.id, patch);
      await onChanged();
    },
    [policy.id, onChanged, onProblem],
  );

  const name = (
    <>
      <span className="policy-name">{policy.name}</span>
      {policy.isLapsed && <Pill tone="due">Lapsed</Pill>}
      {renewal !== null && <Pill tone="warn">{renewalPillText(renewal)}</Pill>}
    </>
  );

  // Who and when, as the board draws the line; a savings policy's line says its cover and premium as well, since
  // its right-hand figure is the surrender value.
  const line = (
    <>
      {policy.insurer !== null && <>{policy.insurer} · </>}
      <span className="policy-member">{memberName ?? 'The household'}</span>
      {policy.isLapsed ? (
        policy.lapsedOn !== null && <> · lapsed {formatIsoDate(policy.lapsedOn)}</>
      ) : policy.renewalOn === null ? (
        <> · renewal not recorded</>
      ) : (
        <> · renews {renewsSoon(policy.renewalOn, today) ? formatShortDate(policy.renewalOn) : formatIsoDate(policy.renewalOn)}</>
      )}
      {hybrid && policy.cover !== null && (
        <>
          {' '}
          · cover <Amount value={policy.cover} privacy={privacy} compact />
        </>
      )}
      {hybrid && yearly !== null && (
        <>
          {' '}
          · <Amount value={yearly} privacy={privacy} compact /> a year
        </>
      )}
    </>
  );

  return (
    <li className={policy.isLapsed ? 'policy-item policy-lapsed' : 'policy-item'}>
      <div className="policy-row">
        <AssetTile kind="insurance" muted={policy.isLapsed} />
        <span className="policy-text">
          {editable ? (
            <button
              type="button"
              className="policy-open"
              aria-expanded={open}
              aria-label={[policy.name, policy.isLapsed ? 'lapsed' : null, renewal === null ? null : renewalPillText(renewal)]
                .filter((part) => part !== null)
                .join(', ')}
              onClick={() => {
                setOpen((was) => !was);
              }}
            >
              <span className="policy-line">{name}</span>
            </button>
          ) : (
            <span className="policy-line">{name}</span>
          )}
          <span className="policy-sub">{line}</span>
        </span>

        <span className="policy-figures">
          {hybrid ? (
            <>
              <span className="policy-cover num">
                {facts?.surrenderValue != null ? (
                  <Amount value={facts.surrenderValue} privacy={privacy} />
                ) : (
                  <span className="note">not valued</span>
                )}
              </span>
              {policy.linkedHoldingId !== null ? (
                <a className="policy-link" href={hashFor('holding', { id: policy.linkedHoldingId })}>
                  surrender value ›
                </a>
              ) : (
                <span className="note">no holding linked</span>
              )}
            </>
          ) : (
            <>
              <span className="policy-cover num">
                {policy.cover === null ? (
                  <span className="note">cover not recorded</span>
                ) : (
                  <Amount value={policy.cover} privacy={privacy} compact />
                )}
              </span>
              <span className="policy-yearly">
                {policy.isLapsed ? (
                  'not in force'
                ) : yearly === null ? (
                  ''
                ) : (
                  <>
                    <span className="num">
                      <Amount value={yearly} privacy={privacy} />
                    </span>{' '}
                    a year
                  </>
                )}
              </span>
            </>
          )}
        </span>
      </div>

      {facts !== undefined && policy.linkedHoldingId !== null && <HybridLine facts={facts} privacy={privacy} />}

      {editable && open && (
        <div className="inset-form policy-editor" role="group" aria-label={`Edit ${policy.name}`}>
          <div className="flex flex-wrap items-end gap-2.5">
            <MoneyField
              label="Cover"
              current={policy.cover}
              currency={currency}
              privacy={privacy}
              editable={!policy.isLapsed}
              onSave={(next) => save({ cover: next })}
              onProblem={onProblem}
            />
            <MoneyField
              label={`Premium / ${policy.cadence.replace(/_/g, ' ')}`}
              current={policy.premium}
              currency={currency}
              privacy={privacy}
              editable={!policy.isLapsed}
              onSave={(next) => (next === null ? Promise.resolve() : save({ premium: next }))}
              onProblem={onProblem}
            />
            <DateField
              label="Renews"
              value={policy.renewalOn}
              editable={!policy.isLapsed}
              onSave={(next) => save({ renewalOn: next })}
              onProblem={onProblem}
            />
          </div>
          <PolicyDetails
            bare
            policy={policy}
            holdings={holdings}
            members={members}
            onSave={async (patch) => {
              await save(patch);
              setOpen(false);
            }}
            onCancel={() => {
              setOpen(false);
            }}
          />
          <div className="mt-3.5">
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                void save({ lapsed: !policy.isLapsed }).catch((error: unknown) => {
                  onProblem(error instanceof Error ? error.message : 'Could not save that.');
                });
              }}
            >
              {policy.isLapsed ? `Reinstate ${policy.name}` : `Lapse ${policy.name}`}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
