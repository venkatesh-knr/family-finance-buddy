/**
 * Invested this month: what went into holdings, by class, and what came out.
 *
 * The invested half of the artboard's `MonthMoney` (docs/design/spending-capture.md section 10; docs/design/vibrant-canvas.html).
 * It is worked out from the holdings' own entries by date (`src/domain/invested.ts`, SC-I11) and needs no month close. The other
 * halves of that board, what was saved and what is left in the bank, need income and the account balances, and are not here.
 *
 * Follows the Overview's Mine | Household switch. Another member's private holdings are not readable by this device, so on
 * Household their purchases are not in it, and the card says so.
 */

import { useEffect, useMemo, useState } from 'react';
import { hashFor } from '../../app/route.ts';
import type { Scope } from '../../app/scope.tsx';
import { investedInMonth, type InvestedCurrency } from '../../domain/invested.ts';
import { money } from '../../lib/money.ts';
import { listPpf } from '../../repo/retirement.ts';
import type { DepositRenewal, FixedIncomeTerms, HoldingListing, PpfEntryRow, Uuid } from '../../repo/types.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { ASSET_CLASSES, assetClass } from '../../ui/assetClass.ts';
import { kindLabel } from '../../ui/labels.ts';
import { Amount, Card, Unit } from '../../ui/primitives.tsx';
import { fixedIncomePayouts } from '../holdings/fixedIncomeRows.ts';

const CLASS_ORDER = ASSET_CLASSES.map((c) => c.kind);
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** How far back the month can be stepped. A year and a half is a spending year and the one before it, which is what is compared. */
const MONTHS_BACK = 18;

/** `2026-10` shifted by a number of months, which may be negative. */
function shift(month: string, by: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + by;
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return `${String(y)}-${String(m + 1).padStart(2, '0')}`;
}

function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** "equity, bonds or ETF": the classes with nothing in them, in one line. Names that are acronyms keep their capitals. */
export function nothingInto(kinds: readonly string[]): string | null {
  if (kinds.length === 0) return null;
  const names = kinds.map((kind) => {
    const label = kindLabel(kind);
    return label === label.toUpperCase() ? label : label.toLowerCase();
  });
  const last = names[names.length - 1];
  const list = names.length === 1 ? (last ?? '') : `${names.slice(0, -1).join(', ')} or ${last ?? ''}`;
  return `Nothing into ${list}`;
}

export function InvestedCard({
  listing,
  terms,
  renewals,
  termsFailed,
  today,
  scope,
  mine,
  privacy,
  privateLeftOut,
}: {
  listing: HoldingListing;
  /** The terms of every deposit and bond, or null when they could not be read. */
  terms: readonly FixedIncomeTerms[] | null;
  /** The renewals recorded on those deposits: a payout is the end of the last term. */
  renewals: readonly DepositRenewal[];
  termsFailed: boolean;
  today: string;
  scope: Scope;
  mine: Uuid | null;
  privacy: boolean;
  /** Household scope, with other members' private holdings that this device cannot read. */
  privateLeftOut: boolean;
}) {
  const thisMonth = today.slice(0, 7);
  const [back, setBack] = useState(0);
  const month = shift(thisMonth, -back);

  // PPF payments are read apart from the holdings, as the Close month action reads them, and their failure is said: a PPF whose
  // payments could not be read is not a PPF with none.
  const [ppf, setPpf] = useState<readonly PpfEntryRow[] | null>(null);
  const [ppfFailed, setPpfFailed] = useState(false);
  const householdId = listing.household.id;
  useEffect(() => {
    let live = true;
    listPpf(householdId)
      .then((result) => {
        if (!live) return;
        setPpf(result.entries);
        setPpfFailed(false);
      })
      .catch(() => {
        if (!live) return;
        setPpf(null);
        setPpfFailed(true);
      });
    return () => {
      live = false;
    };
  }, [householdId]);

  const invested = useMemo(() => {
    const held = listing.holdings.filter((h) => scope === 'household' || h.member.id === mine);
    const ids = new Set(held.map((h) => String(h.id)));
    const scopedTerms = (terms ?? []).filter((t) => ids.has(String(t.holdingId)));
    return investedInMonth({
      month,
      classOrder: CLASS_ORDER,
      holdings: held.map((h) => ({ id: String(h.id), kind: h.instrument.kind, openedOn: h.openedOn, costed: h.cost !== null })),
      lots: listing.lots
        .filter((l) => ids.has(String(l.holdingId)))
        .map((l) => ({ holdingId: String(l.holdingId), acquiredOn: l.acquiredOn, cost: l.cost, kind: l.kind })),
      disposals: listing.disposals
        .filter((d) => ids.has(String(d.holdingId)))
        .map((d) => ({ holdingId: String(d.holdingId), disposedOn: d.disposedOn, proceeds: d.proceeds, kind: d.kind })),
      terms: scopedTerms.map((t) => ({ holdingId: String(t.holdingId), start: t.start, principal: t.principal })),
      // A deposit or bond cannot record a sale, so what it paid out is worked out from its terms, as Holdings does.
      payouts: fixedIncomePayouts(scopedTerms, renewals, today).map((p) => ({ holdingId: String(p.holdingId), paidOn: p.paidOn, amount: p.amount })),
      ppfEntries: (ppf ?? [])
        .filter((e) => ids.has(String(e.holdingId)))
        .map((e) => ({ holdingId: String(e.holdingId), date: e.date, amount: e.amount, isVoided: e.isVoided })),
    });
  }, [listing, terms, renewals, ppf, month, scope, mine, today]);

  // The classes this household holds in each currency, so the line of what had nothing in it names only classes that exist here.
  const held = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const h of listing.holdings) {
      if (h.isArchived || (scope === 'mine' && h.member.id !== mine)) continue;
      const kinds = out.get(h.instrument.currency) ?? new Set<string>();
      kinds.add(h.instrument.kind);
      out.set(h.instrument.currency, kinds);
    }
    return out;
  }, [listing, scope, mine]);

  const leftOut = invested.leftOut.lots + invested.leftOut.disposals;
  // Not yet read is not the same as read and empty: until the PPF payments have come, a figure would be one without them.
  const reading = ppf === null && !ppfFailed;
  const unread = [
    termsFailed ? 'deposits and bonds' : null,
    ppfFailed ? 'PPF payments' : null,
  ].filter((x): x is string => x !== null);

  return (
    <Card
      title={`${scope === 'mine' ? 'Your' : 'Household'} investing in ${monthName(month)}`}
      aside={
        <span className="flex items-center gap-2.5">
          <button
            type="button"
            className="disclosure"
            aria-label="An earlier month"
            disabled={back >= MONTHS_BACK}
            onClick={() => {
              setBack((b) => Math.min(b + 1, MONTHS_BACK));
            }}
          >
            Earlier
          </button>
          <button
            type="button"
            className="disclosure"
            aria-label="A later month"
            disabled={back === 0}
            onClick={() => {
              setBack((b) => Math.max(b - 1, 0));
            }}
          >
            Later
          </button>
        </span>
      }
    >
      <div data-testid="invested-card">
        {back === 0 && <p className="note mb-2">Month to date, from the entries recorded so far.</p>}

        {reading ? (
          <p className="note" role="status">
            Reading PPF payments…
          </p>
        ) : invested.currencies.length === 0 ? (
          <p className="note" data-testid="invested-none">
            Nothing was put into holdings or taken out of them in {monthName(month)} {month.slice(0, 4)}.
          </p>
        ) : (
          invested.currencies.map((currency) => (
            <CurrencyBlock
              key={currency.currency}
              currency={currency}
              privacy={privacy}
              several={invested.currencies.length > 1}
              held={held.get(currency.currency) ?? new Set<string>()}
            />
          ))
        )}

        {leftOut > 0 && (
          <p className="note mt-2.5" data-testid="invested-left-out">
            {String(leftOut)} {leftOut === 1 ? 'entry' : 'entries'} not counted: bonus units, splits, gifts, transfers between
            members and ESOP vests are not money put in or taken out.
          </p>
        )}
        {invested.leftOut.holdings > 0 && (
          <p className="note mt-2.5" data-testid="invested-no-purchase">
            {String(invested.leftOut.holdings)} {invested.leftOut.holdings === 1 ? 'holding' : 'holdings'} opened this month{' '}
            {invested.leftOut.holdings === 1 ? 'has' : 'have'} a cost recorded on the holding and no purchase, so nothing is counted for{' '}
            {invested.leftOut.holdings === 1 ? 'it' : 'them'}. Record the purchase on the holding to count it.
          </p>
        )}
        {unread.length > 0 && (
          <p className="note mt-2.5" role="alert">
            {unread.join(' and ')} could not be read, so this may be short. It is not that there are none: the request failed.
            Reload before relying on it.
          </p>
        )}
        {privateLeftOut && (
          <p className="note mt-2.5">Other members&rsquo; private holdings are not here: this device cannot read their purchases.</p>
        )}
        <p className="note mt-2.5">
          Market gains are not investing, and NPS and EPF contributions are not recorded, so neither is counted.
        </p>
      </div>
    </Card>
  );
}

function CurrencyBlock({
  currency,
  privacy,
  several,
  held,
}: {
  currency: InvestedCurrency;
  privacy: boolean;
  several: boolean;
  /** The classes the household holds in this currency. */
  held: ReadonlySet<string>;
}) {
  const folded = nothingInto(CLASS_ORDER.filter((kind) => held.has(kind) && !currency.classes.some((c) => c.kind === kind)));
  return (
    <div className="mb-2" data-testid="invested-currency">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="stat-card-value tabular-nums">
          <Amount value={money(currency.net, currency.currency)} privacy={privacy} />
        </span>
        <Unit>{several ? `net invested, ${currency.currency}` : 'net invested'}</Unit>
      </div>
      <p className="note tabular-nums">
        put in <Amount value={money(currency.putIn, currency.currency)} privacy={privacy} /> · taken out{' '}
        <Amount value={money(currency.takenOut, currency.currency)} privacy={privacy} />
      </p>
      <ul className="alloc-rows mt-2">
        {currency.classes.map((row) => (
          <li key={row.kind} className="alloc-row" data-testid={`invested-class-${row.kind}`}>
            <AssetTile kind={row.kind} compact />
            <span className="min-w-0">
              <a className="alloc-name alloc-link block" href={hashFor('holdings', { kind: row.kind })}>
                {assetClass(row.kind).label}
              </a>
              <span className="alloc-share block">
                {String(row.moves)} {row.moves === 1 ? 'entry' : 'entries'}
                {row.takenOut > 0n && (
                  <>
                    {' '}
                    · in <Amount value={money(row.putIn, currency.currency)} privacy={privacy} /> · out{' '}
                    <Amount value={money(row.takenOut, currency.currency)} privacy={privacy} />
                  </>
                )}
              </span>
            </span>
            <span className="alloc-figures">
              <span className="alloc-value">
                <Amount value={money(row.net, currency.currency)} privacy={privacy} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      {folded !== null && <p className="note mt-1.5">{folded}</p>}
    </div>
  );
}
