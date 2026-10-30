import { useState } from 'react';
import { EARMARK_LABELS } from '../../domain/earmark.ts';
import { DemoBadge } from '../../app/household.tsx';
import { hashFor } from '../../app/route.ts';
import { daysBetween, formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { quantityToNumeric } from '../../lib/quantity.ts';
import { updateDisposal, updateLot } from '../../repo/lots.ts';
import type { HouseholdKind } from '../../repo/types.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { Amount, Button, Caveat, Card, EyeIcon, Pill, RowAction, Unit } from '../../ui/primitives.tsx';
import { CostAndGains } from './CostAndGains.tsx';
import { EditHolding } from './EditHolding.tsx';
import { FixedIncome } from './FixedIncome.tsx';
import { splitFundName } from './fundName.ts';
import { daysPhrase } from './fixedIncomeRows.ts';
import { barTerm } from './rowFact.ts';
import { RetirementCards, RetirementValue } from './RetirementDetail.tsx';
import { usePpf } from './usePpf.ts';
import { kindColour } from '../../ui/labels.ts';
import { ArchiveHolding, CurrencyOptions, FetchPrice, MissingMonths, QuotedValue, RecordReading } from './holdingParts.tsx';
import type { FixedFacts, FixedIncomeFacts } from './useFixedIncomeFacts.ts';
import type { useHoldings } from './useHoldings.ts';

type Hook = ReturnType<typeof useHoldings>;

/**
 * One holding, on its own screen, in the shape of its kind (docs/design/holdings.md, HD-I6;
 * docs/design/vibrant-canvas.html, the deposit and the fund boards).
 *
 * A deposit or a bond shows its terms: principal, rate, when it began and ends and how far through it is, what
 * the term pays and the interest so far, and for a bond the next coupon. It shows no units, no purchases or sales
 * and no realised figure: "1 units" and "0 purchases, 0 sales" on an FD were the bug this fixes. A fund or a share
 * shows units, cost, return, realised, the peak and its transactions.
 *
 * On a phone the screen opens with its own bar, "‹ Holdings", the privacy switch and Edit, in place of the app's
 * header; a wide screen keeps the header and has the back link and Edit above the identity. Archive is a visible
 * button, named for the holding, and not behind an overflow: that keeps it one tap from the holding and in the
 * accessibility tree, which was the reason the old cards had no overflow.
 */
export function HoldingDetail({
  hook,
  holdingId,
  privacy,
  onTogglePrivacy,
  householdKind,
  canWrite,
  fixed,
}: {
  hook: Hook;
  holdingId: string;
  privacy: boolean;
  onTogglePrivacy: () => void;
  householdKind: HouseholdKind | null;
  canWrite: boolean;
  fixed: FixedIncomeFacts;
}) {
  const { listing, rows, today, record, recordLot, recordSale, reload, taxRules, year, setYear } = hook;
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const row = rows.find((r) => r.holding.id === holdingId);
  // A PPF is worked out from its account, its payments and the notified rate, read only while one is on screen. A hook, so before the
  // early returns.
  const ppfData = usePpf(listing?.household.id ?? null, row?.holding.instrument.retirementType === 'ppf');
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
  const isRetirement = kind === 'retirement';
  const name = splitFundName(holding.instrument.name);
  const facts = fixed.get(holdingId);
  // Paid out, or sold out: left out of the totals from the day it was, as net worth leaves it out.
  const ended = hook.paidOut.has(holdingId) || row.unitsHeld === 0n;

  const editAction = canWrite && (
    <RowAction
      icon="edit"
      label={editing ? `Cancel editing ${holding.instrument.name}` : `Edit ${holding.instrument.name}`}
      expanded={editing}
      onClick={() => {
        setEditing((was) => !was);
      }}
    />
  );

  const archive = canWrite && (
    <ArchiveHolding
      row={row}
      button
      confirming={archiving}
      onConfirmingChange={setArchiving}
      onDone={async () => {
        await reload();
        window.location.hash = hashFor('holdings');
      }}
    />
  );

  /** What the money is for: the earmark, with what it does to the FIRE corpus. */
  const purpose = (
    <section className="card" aria-label="Purpose">
      <div className="purpose-row">
        <span className="min-w-0">
          <span className="label block">Earmarked for</span>
          <span className="purpose-value">
            {holding.earmark === 'none' ? (
              <span className="note">Nothing in particular.</span>
            ) : (
              EARMARK_LABELS[holding.earmark]
            )}
          </span>
        </span>
        {canWrite && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              setEditing(true);
              window.scrollTo({ top: 0 });
            }}
          >
            Change
          </button>
        )}
      </div>
      {holding.earmark !== 'none' && (
        <p className="note mt-2">
          {holding.earmark === 'retirement'
            ? 'Counted toward the FIRE corpus.'
            : holding.earmark === 'emergency'
              ? 'Counts toward emergency cover. Left out of the FIRE corpus.'
              : 'Left out of the FIRE corpus.'}
        </p>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-4.5">
      {/* A phone's bar, in place of the app's header; a wide screen has the back link and Edit below it. */}
      <header className="screen-bar hide-wide inset-safe-top inset-safe-x">
        <a className="screen-bar-back" href={hashFor('holdings')}>
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
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span>Holdings</span>
        </a>
        <span className="screen-bar-end holding-bar-end">
          {householdKind !== null && <DemoBadge kind={householdKind} />}
          <button
            type="button"
            className="iconbtn"
            aria-pressed={privacy}
            aria-label={privacy ? 'Amounts hidden. Show them.' : 'Amounts shown. Hide them.'}
            onClick={onTogglePrivacy}
          >
            <EyeIcon crossed={privacy} />
          </button>
          {editAction}
        </span>
      </header>
      <div className="hide-narrow-flex">
        <BackBar>{editAction}</BackBar>
      </div>

      <section className="flex items-center gap-3" aria-label="Identity">
        <AssetTile kind={kind} />
        <span className="min-w-0">
          <h2 className="detail-name" title={holding.instrument.name}>
            {name.title}
          </h2>
          {name.detail !== null && <span className="note block">{name.detail}</span>}
          <span className="note block">
            {isFixed && facts?.institution != null && <>{facts.institution} · </>}
            <span className="detail-member">{holding.member.displayName}</span>
            {facts?.last4 != null && ` · …${facts.last4}`}
          </span>
        </span>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        {isFixed && <Pill tone="neutral">{kind === 'deposit' ? 'Fixed deposit' : 'Bond'}</Pill>}
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
          // Reloaded first and closed after, so the form stays on "Saving…" until the screen has what was saved.
          // Closing it first left the old earmark and terms showing for as long as the read took.
          onDone={async () => {
            await reload();
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      )}

      {/* The value card: the latest recorded reading, the figure net worth counts (HD-I1), in full. */}
      <section className="card card-lift" aria-label="Value">
        <h2 className="label">{ended ? 'Last reading' : 'In net worth'}</h2>
        <div
          className="figure mt-1"
          data-testid="detail-value"
          title={latest === null ? undefined : (exactTitle(latest.amountMinor, currency, privacy) ?? undefined)}
        >
          {latest === null ? (
            <Unit>none yet</Unit>
          ) : (
            <Amount value={money(latest.amountMinor, currency)} privacy={privacy} />
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

        {isFixed && facts !== undefined && !ended && (
          <WorkedOut
            facts={facts}
            latest={latest === null ? null : { date: latest.date, amount: money(latest.amountMinor, currency) }}
            today={today}
            privacy={privacy}
            canWrite={canWrite}
            onRecord={async (amount) => {
              await record({
                householdId: listing.household.id,
                holdingId: holding.id,
                date: today,
                quantity: '1',
                amount,
                source: 'manual',
                note: 'Worked out from the terms',
              });
              fixed.reload();
            }}
          />
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

        {isRetirement && (
          <RetirementValue
            row={row}
            listing={listing}
            ppf={ppfData}
            today={today}
            privacy={privacy}
            canWrite={canWrite}
            record={record}
            onChanged={async () => {
              await reload();
            }}
          />
        )}

        {canWrite && !isFixed && !isRetirement && (
          <div className="value-actions">
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
            {holding.instrument.priceExternalId !== null && (
              <FetchPrice externalId={holding.instrument.priceExternalId} onFetch={hook.refreshOne} />
            )}
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
      </section>

      {isFixed ? (
        <FixedIncome
          listing={listing}
          privacy={privacy}
          canWrite={canWrite}
          only={holdingId}
          layout={({ term, buttons, forms }) => (
            <>
              <Card
                title="Term"
                aside={facts === undefined ? undefined : <DaysToGo facts={facts} />}
              >
                {facts !== undefined && (
                  <TermProgress
                    start={barTerm(facts.position, facts.view, today).start}
                    end={barTerm(facts.position, facts.view, today).end}
                    today={today}
                    colour={kindColour(kind)}
                  />
                )}
                {term}
              </Card>
              {purpose}
              {/* What else a deposit can do, with Archive beside it, as the board draws the pair. */}
              <div className="flex flex-wrap items-center gap-2">
                {buttons}
                {archive}
              </div>
              {forms}
            </>
          )}
          onChanged={() => {
            fixed.reload();
            void reload();
          }}
        />
      ) : isRetirement ? (
        <RetirementCards
          row={row}
          listing={listing}
          ppf={ppfData}
          today={today}
          privacy={privacy}
          canWrite={canWrite}
          record={record}
          onChanged={async () => {
            await reload();
          }}
        >
          {purpose}
          <div>{archive}</div>
        </RetirementCards>
      ) : (
        <>
          <Card title="Position">
            <CostAndGains
              part="position"
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
            {/* The peak is last, as the board draws it: a fact about the year, after the figures about the position. */}
            <div className="peak-row">
              <span className="label">
                Peak {peak.year}
                {peak.isProvisional && peak.peak !== null && <span className="note"> · provisional</span>}
              </span>
              <span className="tabular-nums" style={{ color: 'var(--ink)' }}>
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
              </span>
              <label className="peak-for">
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
            </div>
          </Card>
          <section className="card transactions-card" aria-label="Transactions">
            <CostAndGains
              part="transactions"
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
          </section>
          {purpose}
          <div>{archive}</div>
        </>
      )}
    </div>
  );
}

function BackBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <a className="back-link" href={hashFor('holdings')}>
        <span aria-hidden="true">←</span> Holdings
      </a>
      {children}
    </div>
  );
}

/** How many days a deposit or bond has to go, at the right of the Term title. */
function DaysToGo({ facts }: { facts: FixedFacts }) {
  const { view } = facts;
  // Days to go while there are some; once it has paid out, or if it cannot be valued, the figures are still the terms'.
  if (!view.ok || view.matured || view.daysToMaturity === null) return <span className="note">worked out from the terms</span>;
  return <span className="note tabular-nums">{daysPhrase(view.daysToMaturity)}</span>;
}

/**
 * What a deposit or bond is worth today, worked out from its terms, and how to make that the reading.
 *
 * It is not in net worth until it is recorded: the figure above is the latest reading, and this is the day's value
 * from the terms, with what the two differ by. "Record as today's reading" writes the day's value as an ordinary
 * reading, which is how a deposit comes to be in net worth, the line over time and the month close without any of
 * them learning about terms. A projected renewal is an estimate and is not offered as a reading.
 */
function WorkedOut({
  facts,
  latest,
  today,
  privacy,
  canWrite,
  onRecord,
}: {
  facts: FixedFacts;
  latest: { date: string; amount: Money } | null;
  today: string;
  privacy: boolean;
  canWrite: boolean;
  onRecord: (amount: Money) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { view } = facts;

  if (!view.ok || view.matured) return null;
  const projected = view.kind === 'deposit' && view.projected;
  const same = latest !== null && latest.date === today && latest.amount.minor === view.value.minor;
  const change = latest === null ? view.value.minor : view.value.minor - latest.amount.minor;
  const label = view.kind === 'bond' && view.repay === 'payout' ? 'Value at par' : 'Worked out today';

  return (
    <div className="worked-out">
      <p className="worked-out-line">
        <span>{label}</span>
        <span className="tabular-nums">{formatMoney(view.value, { privacy })}</span>
      </p>
      {!same && (
        <p className="worked-out-line worked-out-sub">
          <span>
            not in net worth until recorded
            <Caveat tone="info" label="Why this is not in net worth yet">
              Net worth counts the latest reading, not the figure worked out from the terms. Record it as
              today&rsquo;s reading and it is counted from today.
            </Caveat>
          </span>
          {latest !== null && (
            <span className="tabular-nums">
              {change < 0n ? '−' : change > 0n ? '+' : ''}
              {formatMoney(money(change < 0n ? -change : change, view.value.currency), { privacy })}
            </span>
          )}
        </p>
      )}
      {canWrite &&
        (projected ? (
          <p className="note">A projection is not offered as a reading.</p>
        ) : recorded || same ? (
          // The confirmation is a statement and not a greyed-out control: at the opacity of a disabled button it
          // measured under 3:1, on the one line that says the save worked.
          <p className="note" role="status">
            Recorded as today’s reading
          </p>
        ) : (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem(null);
              onRecord(view.value)
                .then(() => {
                  setRecorded(true);
                })
                .catch((error: unknown) => {
                  setProblem(error instanceof Error ? error.message : 'Could not record that.');
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            Record as today’s reading
          </Button>
        ))}
      {problem !== null && (
        <p className="note" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** How far through its term a deposit or bond is: a bar with a tick for today, and the dates under it. */
function TermProgress({ start, end, today, colour }: { start: string; end: string; today: string; colour: string }) {
  const total = Math.max(daysBetween(start, end), 1);
  const done = Math.min(Math.max(daysBetween(start, today), 0), total);
  const percent = Math.round((done / total) * 100);
  return (
    <div className="mb-3.5" data-testid="term-progress">
      <div className="track term-track" role="img" aria-label={`${String(percent)} per cent of the term has passed`}>
        <i style={{ width: `${String(percent)}%`, background: colour }} />
        <b className="term-tick" style={{ left: `${String(percent)}%` }} />
      </div>
      <p className="note mt-1 flex justify-between gap-2 tabular-nums">
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
