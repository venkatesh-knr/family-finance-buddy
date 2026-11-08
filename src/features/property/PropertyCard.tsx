/**
 * One property: what it is, what it cost, what it is thought to be worth and how old that is, and, behind a
 * disclosure, how the cost is made up, the valuations, the work done on it, and the controls to change any of it.
 *
 * Every figure comes from `propertyFacts` (and so from `src/domain/property.ts`); nothing is worked out here. The
 * whole property's figures are the ones a person knows (the price on the deed); where the household holds only a
 * share, its share is said on a line of its own, and it is the share that every total counts.
 */

import { useState } from 'react';
import { formatIsoDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney } from '../../lib/money.ts';
import { archiveProperty, voidPropertyImprovement } from '../../repo/property.ts';
import type { PropertyListing } from '../../repo/types.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { Button, Caveat, Disclosure, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { ImprovementForm, PropertyForm, ValuationForm } from './PropertyForms.tsx';
import type { PropertyFacts } from './propertyFacts.ts';
import { BASIS_LABEL, KIND_LABEL, monthYear, monthsPhrase } from './propertyLabels.ts';

export function PropertyCard({
  facts,
  listing,
  today,
  privacy,
  editable,
  onChanged,
}: {
  facts: PropertyFacts;
  listing: PropertyListing;
  today: IsoDate;
  privacy: boolean;
  editable: boolean;
  onChanged: () => Promise<void>;
}) {
  const { property, cost, value, age, loan, equity } = facts;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const money = (amount: Parameters<typeof formatMoney>[0]) => formatMoney(amount, { privacy });
  const partOnly = property.sharePct !== '100';

  const run = async (action: () => Promise<void>) => {
    setProblem(null);
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not do that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card flex flex-col gap-3" aria-label={property.label}>
      <header className="flex flex-wrap items-center gap-3">
        <AssetTile kind="property" />
        <span className="min-w-0 flex-1">
          <h3 className="detail-name">{property.label}</h3>
          <span className="note block">
            {KIND_LABEL[property.kind]} · {property.isSelfOccupied ? 'lived in' : 'held'} ·{' '}
            <span className="detail-member">{property.member.displayName}</span> · bought{' '}
            {monthYear(property.purchaseDate)}
          </span>
        </span>
        {/* Their own line on a phone: beside the name they leave it a word wide. */}
        <span className="flex basis-full flex-wrap items-center gap-2 sm:basis-auto">
          {partOnly && <Pill tone="own">{property.sharePct}% share</Pill>}
          {age?.stale === true && <Pill tone="warn">Valuation {monthsPhrase(age.months)} old</Pill>}
          {value === null && <Pill tone="neutral">Not valued</Pill>}
        </span>
      </header>

      {cost.ok ? (
        <dl className="term-stats">
          <Stat label="Price paid">{money(cost.purchaseCost)}</Stat>
          <Stat label="Duty and registration">
            {money({ minor: cost.stampDuty.minor + cost.registration.minor, currency: property.currency })}
          </Stat>
          <Stat label="Capital work">
            {cost.capitalImprovements.minor === 0n ? <span className="note">none</span> : money(cost.capitalImprovements)}
          </Stat>
          <Stat label={partOnly ? 'Cost basis, whole property' : 'Cost basis'}>{money(cost.whole)}</Stat>
        </dl>
      ) : (
        <Problem>
          The cost could not be worked out:{' '}
          {cost.reason === 'mixed-currency'
            ? 'its figures are in more than one currency'
            : cost.reason === 'invalid-share'
              ? 'the household’s share is not a percentage above 0 and up to 100'
              : 'one of its figures is negative'}.
          Correct it under Details.
        </Problem>
      )}

      <div className="worked-out">
        {value === null ? (
          <p className="worked-out-line">
            <span>Not valued yet</span>
            <span className="note">record what it is thought to be worth, under Details</span>
          </p>
        ) : (
          <>
            <p className="worked-out-line">
              <span>Valued at</span>
              <span className="tabular-nums">{money(value.whole)}</span>
            </p>
            <p className="worked-out-line worked-out-sub">
              <span>
                {BASIS_LABEL[value.basis]} · {formatIsoDate(value.asOf)}
                {age !== null && <> · {monthsPhrase(age.months)} ago</>}
              </span>
            </p>
          </>
        )}
        {partOnly && cost.ok && (
          <p className="worked-out-line">
            <span>The household’s {property.sharePct}%</span>
            <span className="tabular-nums">
              {value === null ? <span className="note">cost basis {money(cost.share)}</span> : <>{money(value.share)}<span className="note"> · cost basis {money(cost.share)}</span></>}
            </span>
          </p>
        )}
        {loan !== null && (
          <p className="worked-out-line">
            <span>
              Equity after {loan.name}
              <Caveat tone="info" label="How equity is worked out">
                The household’s share of the value, less the household’s share of what is outstanding on the loan: a
                half share of a property carries half of what is owed on it.
              </Caveat>
            </span>
            <span className="tabular-nums">
              {equity !== null ? (
                money(equity)
              ) : (
                <span className="note">
                  {facts.equityWhy === 'no-balance'
                    ? 'the loan has no balance recorded'
                    : facts.equityWhy === 'no-value'
                      ? 'needs a valuation'
                      : 'the loan is in another currency'}
                </span>
              )}
            </span>
          </p>
        )}
      </div>

      <Disclosure
        open={open}
        onToggle={() => {
          setOpen((was) => !was);
        }}
      >
        Details
      </Disclosure>

      {open && (
        <div className="flex flex-col gap-4">
          {problem !== null && <Problem>{problem}</Problem>}

          {editing && editable ? (
            <PropertyForm
              listing={listing}
              existing={property}
              today={today}
              onDone={async () => {
                await onChanged();
                setEditing(false);
              }}
              onCancel={() => {
                setEditing(false);
              }}
            />
          ) : null}

          {cost.ok && (
            <section aria-label="How the cost is made up">
              <h4 className="label">How the cost is made up</h4>
              <dl className="mt-1.5 flex flex-col gap-1">
                {(
                  [
                    ['Price paid', cost.purchaseCost],
                    ['Stamp duty', cost.stampDuty],
                    ['Registration', cost.registration],
                    ['Capital work counted', cost.capitalImprovements],
                  ] as const
                ).map(([label, amount]) => (
                  <div key={label} className="worked-out-line">
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{money(amount)}</dd>
                  </div>
                ))}
                <div className="worked-out-line" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                  <dt>Cost basis</dt>
                  <dd className="tabular-nums">{money(cost.whole)}</dd>
                </div>
              </dl>
              {cost.repairsExcluded.minor > 0n && (
                <p className="note mt-1.5">
                  {money(cost.repairsExcluded)} of repairs are recorded and not counted: a repair does not add to what a
                  property cost.
                </p>
              )}
            </section>
          )}

          <section aria-label="Valuations" className="flex flex-col gap-2.5">
            <h4 className="label">Valuations</h4>
            {facts.valuations.length === 0 ? (
              <p className="note">None recorded.</p>
            ) : (
              <ul className="row-separated">
                {facts.valuations.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span>
                      {formatIsoDate(entry.asOf)} <span className="note">· {BASIS_LABEL[entry.basis]}</span>
                      {entry.note !== null && <span className="note"> · {entry.note}</span>}
                    </span>
                    <span className="tabular-nums">{money(entry.value)}</span>
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <ValuationForm householdId={listing.household.id} property={property} today={today} onDone={onChanged} />
            )}
          </section>

          <section aria-label="Work done" className="flex flex-col gap-2.5">
            <h4 className="label">Work done</h4>
            {facts.work.length + facts.voided.length === 0 ? (
              <p className="note">None recorded.</p>
            ) : (
              <ul className="row-separated">
                {[...facts.work, ...facts.voided]
                  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
                  .map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span style={entry.isVoided ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
                          {formatIsoDate(entry.date)} · {entry.description}
                        </span>
                        <Pill tone={entry.isCapital ? 'ok' : 'neutral'}>{entry.isCapital ? 'Capital' : 'Repair'}</Pill>
                        {entry.isVoided && <Pill tone="due">Voided</Pill>}
                      </span>
                      <span className="flex items-center gap-3">
                        <span
                          className="tabular-nums"
                          style={entry.isVoided ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}
                        >
                          {money(entry.amount)}
                        </span>
                        {editable && !entry.isVoided && (
                          <button
                            type="button"
                            className="quiet-button"
                            disabled={busy}
                            aria-label={`Void ${entry.description}`}
                            onClick={() => {
                              void run(() => voidPropertyImprovement(entry.id));
                            }}
                          >
                            Void
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            {editable && (
              <ImprovementForm householdId={listing.household.id} property={property} today={today} onDone={onChanged} />
            )}
          </section>

          {editable && !editing && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setEditing(true);
                }}
              >
                Correct the details
              </Button>
              {confirmingArchive ? (
                <>
                  <span className="note">Archive {property.label}? It leaves the list and the totals; its history stays.</span>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void run(() => archiveProperty(property.id));
                    }}
                  >
                    Archive it
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      setConfirmingArchive(false);
                    }}
                  >
                    Keep it
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    setConfirmingArchive(true);
                  }}
                >
                  Archive
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
