import { useMemo, useState } from 'react';
import { exactMoney, formatMoney } from '../../lib/money.ts';
import { Amount, Button, Problem } from '../../ui/primitives.tsx';
import { PropertyCard } from './PropertyCard.tsx';
import { PropertyForm } from './PropertyForms.tsx';
import { propertyFacts, type CurrencyTotals } from './propertyFacts.ts';
import { monthsPhrase } from './propertyLabels.ts';
import { usePropertyData } from './usePropertyData.ts';

/**
 * Property (docs/design/prototype.html, the Property view; docs/blueprint.md, Property; docs/decisions.md, Property).
 *
 * What the household owns in land and buildings: what each cost, as the price, the duty and the registration, with the
 * capital work done on it; what each is thought to be worth, on what basis and how long ago; and the equity after its
 * loan. The app never pretends a property is worth a precise number: a valuation is a figure, a date and where it came
 * from, and one that has gone stale says so rather than being carried quietly.
 *
 * Every figure is the household's share of the property, and every total is per currency. The screen reads and writes
 * through the repository and works nothing out itself: `propertyFacts` and `src/domain/property.ts` do. A property is
 * the household's: marking one personal waits for the Profile's private list to know about it (docs/decisions.md).
 */
export function PropertyScreen({ privacy, householdId }: { privacy: boolean; householdId: string | null }) {
  const { listing, loading, problem, noHousehold, today, reload } = usePropertyData(householdId);
  const [adding, setAdding] = useState(false);

  const facts = useMemo(() => (listing === null ? null : propertyFacts(listing, today)), [listing, today]);

  if (loading && listing === null) return <p className="note px-4.5 py-4.5">Loading…</p>;
  if (noHousehold) return null;
  if (problem !== null || listing === null || facts === null) {
    return <Problem>{problem ?? 'Could not read the property.'}</Problem>;
  }

  const canRecord = listing.viewer.canRecord;
  const editableOwn = (memberId: string) => canRecord && (listing.viewer.canFileForOthers || memberId === listing.viewer.memberId);

  return (
    <div className="flex flex-col gap-3">
      {facts.totals.length > 0 && (
        <>
          <h2 className="sr-only">What the property is worth, and cost</h2>
          <div className="stat-cards">
            {facts.totals.map((total) => (
              <ValueCard key={`value-${total.currency}`} total={total} many={facts.totals.length > 1} privacy={privacy} />
            ))}
            {facts.totals.map((total) => (
              <CostCard key={`cost-${total.currency}`} total={total} many={facts.totals.length > 1} privacy={privacy} />
            ))}
            <div className="card stat-card">
              <h3 className="stat-card-label">Oldest valuation</h3>
              <div className="stat-card-value">{facts.oldest === null ? '—' : monthsPhrase(facts.oldest.months)}</div>
              <div className="stat-card-sub">
                {facts.oldest === null
                  ? 'nothing valued yet'
                  : facts.staleCount === 0
                    ? `none older than ${String(listing.staleMonths)} months`
                    : `${String(facts.staleCount)} past ${String(listing.staleMonths)} months`}
              </div>
            </div>
          </div>
          <p className="note">
            The household’s share of each property, and per currency. Counted in net worth, the allocation and the history on
            the Overview, with a loan linked to a property taken at the property’s share.
          </p>
        </>
      )}

      <div className="policy-head">
        <h2 className="policy-title">Property</h2>
        <span className="policy-count tabular-nums">{facts.byProperty.length}</span>
        <span className="flex-1" />
        {canRecord && (
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
            Add a property
          </Button>
        )}
      </div>

      {canRecord && adding && (
        <PropertyForm
          listing={listing}
          today={today}
          onDone={async () => {
            await reload();
            setAdding(false);
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      )}

      {facts.byProperty.length === 0 && (
        <p className="note">
          No property recorded yet. Add one with what it cost: the price, the stamp duty and the registration are what a
          future gain is measured against, and nobody reconstructs them fifteen years later.
        </p>
      )}

      {facts.byProperty.map((entry) => (
        <PropertyCard
          key={entry.property.id}
          facts={entry}
          listing={listing}
          today={today}
          privacy={privacy}
          editable={editableOwn(entry.property.member.id)}
          onChanged={reload}
        />
      ))}
    </div>
  );
}

/** Estimated value in one currency, with the equity after loans where it can be said. */
function ValueCard({ total, many, privacy }: { total: CurrencyTotals; many: boolean; privacy: boolean }) {
  return (
    <div className="card stat-card">
      <h3 className="stat-card-label">Estimated value{many ? ` · ${total.currency}` : ''}</h3>
      <div className="stat-card-value" title={exactMoney(total.value, privacy) ?? undefined}>
        <Amount value={total.value} privacy={privacy} />
      </div>
      <div className="stat-card-sub">
        {total.withLoan === 0
          ? `${String(total.count)} ${total.count === 1 ? 'property' : 'properties'}`
          : total.equity === null
            ? `equity after loans: ${String(total.equityGaps)} ${total.equityGaps === 1 ? 'loan has' : 'loans have'} no balance or value`
            : `equity after loans ${formatMoney(total.equity, { privacy })}`}
        {total.unvalued > 0 && ` · ${String(total.unvalued)} not valued`}
      </div>
    </div>
  );
}

/** What the properties in one currency cost, with the duty and the capital work inside it. */
function CostCard({ total, many, privacy }: { total: CurrencyTotals; many: boolean; privacy: boolean }) {
  return (
    <div className="card stat-card">
      <h3 className="stat-card-label">Cost basis{many ? ` · ${total.currency}` : ''}</h3>
      <div className="stat-card-value" title={exactMoney(total.cost, privacy) ?? undefined}>
        <Amount value={total.cost} privacy={privacy} />
      </div>
      <div className="stat-card-sub">
        duty and registration {formatMoney(total.dutyAndRegistration, { privacy })} · capital work{' '}
        {formatMoney(total.capitalWork, { privacy })}
      </div>
    </div>
  );
}
