/**
 * The sales behind the figures, one stacked row each.
 *
 * A row is the tile of the thing sold, its name and its gain with the sign written out, and under them when it was
 * sold, how long it was held and which term that made it. A stacked row rather than a table: the prototype's table
 * had six columns, and at phone width a fund named "… (formerly …)" took one word per line while Class and Gain
 * scrolled out of sight — the two columns this page is for. Name and gain share the top line so the figure is
 * never a scroll away.
 *
 * Every sale in the year is listed, including the ones the netter will not place. A foreign holding, a matured gold
 * bond or an unclassified fund is shown with the reason it is not in the figures, because a sale that quietly
 * vanishes from a tax page because the arithmetic cannot handle it yet is the failure this screen exists to avoid.
 */

import type { ExclusionReason } from '../../domain/capital-gains.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { taxClassLabel } from '../../ui/labels.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { hashFor } from '../../app/route.ts';
import { Notice, Pill } from '../../ui/primitives.tsx';
import { MutedNote } from '../../ui/MutedNote.tsx';
import { signed } from './GainsCard.tsx';
import { heldText, shortDate, termWords } from './saleLine.ts';
import type { TaxLot } from './taxLots.ts';

/** Why a sale that is listed is not in the figures, in a few words. */
const WHY: Record<ExclusionReason, (lot: TaxLot) => string> = {
  'unclassified-asset': () =>
    'its tax asset class is not set — set it by editing the holding on Holdings',
  'no-rule-for-date': () => 'no holding-period rule covers this date; earlier regimes are not loaded',
  'currency-mismatch': (lot) =>
    `recorded in ${lot.parcel.gain.currency}, which is not rupees — a data problem for an Indian holding`,
  'needs-prescribed-rate': () =>
    'a foreign holding needs the SBI prescribed exchange rate for the month of sale, which is not stored yet',
  'debt-fund-not-modelled': () =>
    'a debt fund’s treatment depends on when it was bought, which the rules here do not model yet',
  'property-election': () =>
    'property carries an election between 12.5% and 20% with indexation, which is not modelled',
  'possibly-exempt': () =>
    'gold disposed at maturity — a Sovereign Gold Bond redeemed with the RBI is exempt, so it is left out; check with your CA',
  'not-a-sale': () => 'recorded as a gift or a transfer, which is not a sale',
};

/** How many sales these are. A sale FIFO-matched to two purchases is two parcels and one sale. */
const salesIn = (lots: readonly TaxLot[]): number => new Set(lots.map((lot) => lot.parcel.disposalId)).size;

export function SalesCard({
  lots,
  heading,
  whose,
  privacy,
}: {
  lots: readonly TaxLot[];
  /** "Sales this year", or the year when an earlier one is chosen. */
  heading: string;
  /** Whose sales, for the sentence that says there are none. */
  whose: string;
  privacy: boolean;
}) {
  const unplaced = lots.filter((lot) => !lot.placement.placed);
  const leftOut = salesIn(unplaced);
  // Amber only where the person can put it right: a class that is not set is set on the holding. A foreign
  // holding or a debt fund is a limit of the page, and is said quietly.
  const mendable = unplaced.some((lot) => !lot.placement.placed && lot.placement.reason === 'unclassified-asset');
  const names = unplaced.flatMap((lot) =>
    lot.placement.placed
      ? []
      : [`${lot.holdingName} · sold ${formatIsoDate(lot.parcel.disposedOn)} — ${WHY[lot.placement.reason](lot)}`],
  );
  const leftOutText = (
    <>
      {leftOut} {leftOut === 1 ? 'sale is' : 'sales are'} listed below but not in the figures above. Each says why.
      Nothing was guessed at.
    </>
  );

  return (
    <>
      {unplaced.length > 0 &&
        (mendable ? (
          <Notice names={names} namesLabel="Which sales">
            {leftOutText}
          </Notice>
        ) : (
          <MutedNote names={names} namesLabel="Which sales">
            {leftOutText}
          </MutedNote>
        ))}

      <section className="card" aria-label={heading}>
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="card-title font-sans">{heading}</h2>
          <span className="note tabular-nums">{salesIn(lots)}</span>
        </header>

        {lots.length === 0 ? (
          <p className="note mt-3">
            Nothing was sold by {whose} in this tax year, so there is nothing to net. A sale recorded on Holdings
            appears here.
          </p>
        ) : (
          <ul aria-label="Sales in this tax year" className="tax-sales">
            {lots.map((lot) => {
              const term = termWords(lot);
              return (
                <li key={`${lot.parcel.lotId}-${lot.parcel.disposalId}`} className="tax-sale">
                  <AssetTile kind={lot.kind} compact />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      {/* To the holding, where the purchases it was made from are listed. */}
                      <a className="tax-sale-name" href={hashFor('holding', { id: lot.holdingId })}>
                        {lot.holdingName}
                      </a>
                      <span
                        className={
                          lot.parcel.gain.minor > 0n
                            ? 'tax-sale-gain pos'
                            : lot.parcel.gain.minor < 0n
                              ? 'tax-sale-gain neg'
                              : 'tax-sale-gain'
                        }
                      >
                        {signed(lot.parcel.gain, privacy)}
                      </span>
                    </span>
                    <span className="note tabular-nums block">
                      sold {shortDate(lot.parcel.disposedOn)} · held {heldText(lot.parcel.acquiredOn, lot.parcel.disposedOn)}
                      {term !== null && <> · {term}</>}
                    </span>
                    {term === null && (
                      <span className="mt-1 block">
                        <LeftOut lot={lot} />
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/** Why a sale is not in the figures, as a pill — a data problem is `due`, a known limitation neutral. */
function LeftOut({ lot }: { lot: TaxLot }) {
  const label = lot.assetClass === null ? '' : taxClassLabel(lot.assetClass);
  const term = lot.term === null ? '' : lot.term === 'long' ? 'long term' : 'short term';

  switch (lot.placement.placed ? null : lot.placement.reason) {
    case 'unclassified-asset':
      return <Pill tone="due">Class not set</Pill>;
    case 'no-rule-for-date':
      return <Pill tone="due">No rule for this date</Pill>;
    case 'currency-mismatch':
      return <Pill tone="due">Not in rupees</Pill>;
    case 'needs-prescribed-rate':
      return <Pill tone="neutral">{`${label} · ${term} · needs the prescribed rate`}</Pill>;
    case 'debt-fund-not-modelled':
      return <Pill tone="neutral">Debt fund · not netted</Pill>;
    case 'property-election':
      return <Pill tone="neutral">{`Property · ${term} · election needed`}</Pill>;
    case 'possibly-exempt':
      return <Pill tone="neutral">{`${label} · at maturity · left out`}</Pill>;
    case 'not-a-sale':
      return <Pill tone="neutral">Gift or transfer · not a sale</Pill>;
    default:
      return null;
  }
}
