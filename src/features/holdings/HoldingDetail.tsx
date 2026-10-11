import { useState } from 'react';
import { EARMARK_LABELS } from '../../domain/earmark.ts';
import { hashFor } from '../../app/route.ts';
import { daysBetween, formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { formatQuantity, quantityToNumeric } from '../../lib/quantity.ts';
import { updateDisposal, updateLot } from '../../repo/lots.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { kindLabel } from '../../ui/labels.ts';
import { Amount, Caveat, Card, Pill, RowAction, Unit } from '../../ui/primitives.tsx';
import { CostAndGains } from './CostAndGains.tsx';
import { EditHolding } from './EditHolding.tsx';
import { FixedIncome } from './FixedIncome.tsx';
import { splitFundName } from './fundName.ts';
import { currentTerm } from './rowFact.ts';
import { ArchiveHolding, CurrencyOptions, MissingMonths, QuotedValue, RecordReading } from './holdingParts.tsx';
import type { FixedIncomeFacts } from './useFixedIncomeFacts.ts';
import type { useHoldings } from './useHoldings.ts';

type Hook = ReturnType<typeof useHoldings>;

/**
 * One holding, on its own screen, in the shape of its kind (docs/design/holdings.md, HD-I6).
 *
 * A deposit or a bond shows its terms: principal, rate, when it began and ends and how far through it is, what
 * the term pays and the interest so far, and for a bond the next coupon. It shows no units, no purchases or sales
 * and no realised figure: "1 units" and "0 purchases, 0 sales" on an FD were the bug this fixes. A fund or a share
 * shows units, cost, return, realised, the peak and its transactions.
 *
 * Edit is an icon in the top bar. Archive is a visible button, named for the holding, and not behind an overflow:
 * that keeps it one tap from the holding and in the accessibility tree, which was the reason the old cards had no
 * overflow.
 */
export function HoldingDetail({
  hook,
  holdingId,
  privacy,
  canWrite,
  fixed,
}: {
  hook: Hook;
  holdingId: string;
  privacy: boolean;
  canWrite: boolean;
  fixed: FixedIncomeFacts;
}) {
  const { listing, rows, today, record, recordLot, recordSale, reload, taxRules, year, setYear } = hook;
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);

  const row = rows.find((r) => r.holding.id === holdingId);
  if (listing === null) return null;

  if (row === undefined) {
    return (
      <div className="flex flex-col gap-4.5">
        <BackBar />
        <Card title="Not here">
          <p className="note">
            That holding is not in this household&rsquo;s list. It may have been archived, or it may be another
            member&rsquo;s private holding.
          </p>
        </Card>
      </div>
    );
  }

  const { holding, latest, peak } = row;
  const currency = holding.instrument.currency;
  const kind = holding.instrument.kind;
  const isFixed = kind === 'deposit' || kind === 'bond';
  const name = splitFundName(holding.instrument.name);
  const facts = fixed.get(holdingId);
  // Paid out, or sold out: left out of the totals from the day it was, as net worth leaves it out.
  const ended = hook.paidOut.has(holdingId) || row.unitsHeld === 0n;

  return (
    <div className="flex flex-col gap-4.5">
      <BackBar>
        {canWrite && (
          <RowAction
            icon="edit"
            label={editing ? `Cancel editing ${holding.instrument.name}` : `Edit ${holding.instrument.name}`}
            expanded={editing}
            onClick={() => {
              setEditing((was) => !was);
            }}
          />
        )}
      </BackBar>

      <section className="flex items-center gap-3" aria-label="Identity">
        <AssetTile kind={kind} />
        <span className="min-w-0">
          <h2 className="detail-name" title={holding.instrument.name}>
            {name.title}
          </h2>
          {name.detail !== null && <span className="note block">{name.detail}</span>}
          <span className="note block">
            {holding.member.displayName} · {kindLabel(kind)}
            {facts?.institution != null && ` · ${facts.institution}`}
            {facts?.last4 != null && ` · …${facts.last4}`}
          </span>
        </span>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        {holding.earmark !== 'none' && <Pill tone="neutral">{EARMARK_LABELS[holding.earmark]}</Pill>}
        {holding.instrument.isForeignAsset && <Pill tone="own">Foreign asset</Pill>}
        {holding.visibility === 'personal' && <Pill tone="own">Private</Pill>}
      </div>

      {canWrite && editing && (
        <EditHolding
          holding={holding}
          isMine={holding.member.id === listing.viewer.memberId}
          hasHistory={
            latest !== null ||
            listing.lots.some((lot) => lot.holdingId === holding.id) ||
            listing.disposals.some((sale) => sale.holdingId === holding.id)
          }
          hasLots={listing.lots.some((lot) => lot.holdingId === holding.id)}
          currencyOptions={<CurrencyOptions />}
          onDone={async () => {
            setEditing(false);
            await reload();
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      )}

      {/* The value card: the latest recorded reading, the figure net worth counts (HD-I1). */}
      <Card lift title={ended ? 'Last reading' : 'In net worth'} aside={<span className="note">latest reading</span>}>
        <div
          className="figure"
          data-testid="detail-value"
          title={latest === null ? undefined : (exactTitle(latest.amountMinor, currency, privacy) ?? undefined)}
        >
          {latest === null ? (
            <Unit>none yet</Unit>
          ) : (
            <Amount value={money(latest.amountMinor, currency)} privacy={privacy} compact />
          )}
        </div>
        {latest !== null && <p className="note mt-1">reading · {formatIsoDate(latest.date)}</p>}
        {/* A holding that has paid out or been sold out is not in net worth: the screen must not say it is. */}
        {ended && (
          <p className="note mt-1">
            {hook.paidOut.has(holdingId)
              ? 'It has paid out, so it is no longer counted in net worth or in the totals.'
              : 'No units are left, so it is no longer counted in net worth or in the totals.'}
          </p>
        )}

        {row.quoted !== null && (
          <QuotedValue
            row={row}
            canWrite={canWrite}
            today={today}
            privacy={privacy}
            onRecord={record}
            listing={listing}
          />
        )}

        {canWrite && !isFixed && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="quiet-button"
              aria-expanded={recording}
              onClick={() => {
                setRecording((was) => !was);
              }}
            >
              {recording ? 'Cancel this reading' : 'Record a value'}
            </button>
          </div>
        )}
        {canWrite && recording && (
          <RecordReading
            listing={listing}
            holdingId={holding.id}
            quantity={quantityToNumeric(row.unitsHeld)}
            currency={currency}
            today={today}
            onRecord={async (valuation) => {
              await record(valuation);
              setRecording(false);
            }}
          />
        )}
      </Card>

      {isFixed ? (
        <Card title="Term" aside={facts === undefined ? undefined : <span className="note">worked out from the terms</span>}>
          {facts !== undefined && (
            <TermProgress
              start={currentTerm(facts.position, today).start}
              end={facts.view.ok && facts.view.kind === 'deposit' && facts.view.nextMaturity !== null ? facts.view.nextMaturity : currentTerm(facts.position, today).end}
              today={today}
            />
          )}
          <FixedIncome
            listing={listing}
            privacy={privacy}
            canWrite={canWrite}
            only={holdingId}
            onChanged={() => {
              fixed.reload();
              void reload();
            }}
          />
        </Card>
      ) : (
        <Card title="Position" aside={<span className="note tabular-nums">{formatQuantity(row.unitsHeld)} units</span>}>
          <dl className="flex flex-wrap gap-x-9 gap-y-2.5">
            <div>
              <dt className="label">
                Peak {peak.year}
                {peak.isProvisional && peak.peak !== null && ' (provisional)'}
              </dt>
              <dd className="tabular-nums" style={{ color: 'var(--ink)' }}>
                {peak.peak === null ? (
                  <Unit>not known</Unit>
                ) : (
                  <>
                    {formatMoney(peak.peak, { privacy })}{' '}
                    {peak.peakDate !== null && <span className="note">{formatIsoDate(peak.peakDate)}</span>}
                    {peak.missingMonths.length > 0 && (
                      <Caveat tone="warn" label={`Why this ${String(peak.year)} peak is a lower bound`}>
                        <MissingMonths months={peak.missingMonths} />
                        Record a reading for each of those months on the holdings that were held.
                      </Caveat>
                    )}
                  </>
                )}
              </dd>
            </div>
            <label className="flex items-center gap-2">
              <span className="label">Peak for</span>
              <select
                className="field w-[92px]"
                value={year}
                onChange={(event) => {
                  setYear(Number(event.target.value));
                }}
              >
                {yearsAround(today).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </dl>
          <CostAndGains
            taxRules={taxRules}
            row={row}
            listing={listing}
            privacy={privacy}
            today={today}
            canWrite={canWrite}
            onLot={recordLot}
            onSale={recordSale}
            onEditLot={async (id, patch) => {
              await updateLot(id, patch);
              await reload();
            }}
            onEditSale={async (id, patch) => {
              await updateDisposal(id, patch);
              await reload();
            }}
          />
        </Card>
      )}

      {/* What the money is for: the earmark, with what it does to the FIRE corpus. */}
      <Card title="Earmarked for">
        <p>{holding.earmark === 'none' ? <span className="note">Nothing in particular.</span> : EARMARK_LABELS[holding.earmark]}</p>
        {holding.earmark !== 'none' && (
          <p className="note mt-1">
            {holding.earmark === 'retirement'
              ? 'Counted toward the FIRE corpus.'
              : holding.earmark === 'emergency'
                ? 'Counts toward emergency cover. Left out of the FIRE corpus.'
                : 'Left out of the FIRE corpus.'}
          </p>
        )}
        {canWrite && (
          <button
            type="button"
            className="quiet-button mt-2.5"
            onClick={() => {
              setEditing(true);
              window.scrollTo({ top: 0 });
            }}
          >
            Change
          </button>
        )}
      </Card>

      {/* A visible button, named for the holding: one tap from the holding and in the accessibility tree. */}
      {canWrite && (
        <ArchiveHolding
          row={row}
          button
          onDone={async () => {
            await reload();
            window.location.hash = hashFor('holdings');
          }}
        />
      )}
    </div>
  );
}

function BackBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <a className="back-link" href={hashFor('holdings')}>
        <span aria-hidden="true">←</span> Holdings
      </a>
      {children}
    </div>
  );
}

/** How far through its term a deposit or bond is: a bar and the dates under it. */
function TermProgress({ start, end, today }: { start: string; end: string; today: string }) {
  const total = Math.max(daysBetween(start, end), 1);
  const done = Math.min(Math.max(daysBetween(start, today), 0), total);
  const percent = Math.round((done / total) * 100);
  return (
    <div className="mb-3" data-testid="term-progress">
      <div className="track" role="img" aria-label={`${String(percent)} per cent of the term has passed`}>
        <i style={{ width: `${String(percent)}%`, background: 'var(--teal)' }} />
      </div>
      <p className="note mt-1 flex justify-between gap-2">
        <span>{formatIsoDate(start)}</span>
        <span>today</span>
        <span>{formatIsoDate(end)}</span>
      </p>
    </div>
  );
}

function yearsAround(today: string): readonly number[] {
  const current = Number(today.slice(0, 4));
  return [current, current - 1, current - 2];
}

function exactTitle(minor: bigint, currency: string, privacy: boolean): string | null {
  return privacy ? null : formatMoney(money(minor, currency));
}
