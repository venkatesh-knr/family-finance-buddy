/**
 * Accounts, behind More: the household's accounts (docs/design/ledger-income.md section 1a; the MoneyAccounts and MoneyAccountsEmpty boards).
 *
 * Accounts are optional: a family can start without any, and the screen says what a month is like without them and what adding them gives.
 * With some, the lifted surface is the cash reserve: the total of the balances at the last month-end that has any, a card's due taken off, per
 * currency, with how many accounts it counts and the *Close October* button (a first close is asked for until there is a balance); a soft panel
 * lists the accounts, each with its type, whose it is and its last balance; then the button, the archived ones folded, and
 * what is kept. Every account is the household's: an owner or a partner is listed all of them, a contributor their own.
 *
 * No figure here is worked out. The reserve is the database's sum (`household_cash_reserve`), over every account of the household (LI-I27); a failed or empty read says so and is never a reserve of nothing.
 */

import { useEffect, useMemo, useState } from 'react';
import { formatShortDate } from '../../lib/dates.ts';
import { formatMoney } from '../../lib/money.ts';
import { accountHasHistory } from '../../repo/accounts.ts';
import { todayInIst } from '../../repo/expenses.ts';
import type { Account } from '../../repo/types.ts';
import { Chevron, Disclosure } from '../../ui/primitives.tsx';
import { AddAccount } from './AddAccount.tsx';
import { CloseMonth } from './CloseMonth.tsx';
import { lateStatementDay } from './cardCycleView.ts';
import { accountRow, latestBalances, splitAccounts } from './accountRows.ts';
import { cardEmiDebtLine, syncCardEmiDebts } from './cardEmiDebt.ts';
import { cardCycles, lastBalanceMonth, lastDayOf, monthToClose, monthWord, offersClose } from './closeMonth.ts';
import { useCashReserve } from './useCashReserve.ts';
import { useMoneyLedger } from './useMoneyLedger.ts';

function WhatIsKept() {
  return (
    <section className="card" aria-label="What an account is">
      <h2 className="label mb-2">What is kept</h2>
      <p className="note">
        A name you choose, the type and whose it is. The bank and the last four digits are optional. No account number, no bank login, and no link
        to your bank. Balances are typed at the month close, or read from a statement on your phone.
      </p>
    </section>
  );
}

export function AccountsTab({ householdId, privacy }: { householdId: string | null; privacy: boolean }) {
  // The credits and moves come with the accounts: the close can be opened from here, and it needs them.
  const ledger = useMoneyLedger(householdId);
  const { data, loading, problem, add, change } = ledger;
  // The form: closed, a new account, or one being changed with whether its type and currency are fixed.
  const [form, setForm] = useState<{ account: Account | null; locked: boolean } | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [addingDebt, setAddingDebt] = useState<string | null>(null);
  const today = todayInIst();
  const closeMonthKey = monthToClose(today);
  // The reserve is as at the last day of the last closed month, and is read again when a close writes balances.
  const closedMonth = data === null ? null : lastBalanceMonth({ today, accounts: data.accounts, balances: data.balances });
  const reserve = useCashReserve(data?.household.id ?? null, data?.viewer.role ?? null, closedMonth === null ? null : lastDayOf(closedMonth), data?.balances);

  const latest = useMemo(() => latestBalances(data?.balances ?? []), [data]);
  const split = useMemo(() => splitAccounts(data?.accounts ?? []), [data]);

  // A change of household closes a form that belonged to the other one.
  useEffect(() => {
    setForm(null);
  }, [householdId]);

  if (problem !== null && data === null) {
    return (
      <p role="alert" className="note">
        {problem}
      </p>
    );
  }
  if (loading || data === null) return <p className="note">Loading…</p>;

  const mayAdd = data.viewer.canRecord;
  const none = split.active.length === 0 && split.archived.length === 0;
  const readsHousehold = data.viewer.role === 'owner' || data.viewer.role === 'partner';
  // A month waiting for a card statement is closed only by someone who may close it without the card (card-cycles.md 2.4): anyone else is offered nothing.
  const mayCloseWithout = data !== null && (data.viewer.role === 'owner' || data.viewer.role === 'partner');
  const waitingForCard = data !== null && cardCycles({ month: closeMonthKey, accounts: data.accounts, balances: data.balances, closedWithout: ledger.closesWithout }).some((cycle) => cycle.kind === 'waiting');
  const offer = (waitingForCard ? mayCloseWithout : true) && offersClose({
    month: closeMonthKey,
    accounts: data.accounts,
    balances: data.balances,
    canRecord: data.viewer.canRecord,
    moneyReady: ledger.moneyStatus === 'ready',
    closedWithout: ledger.closesWithout,
  });

  const open = async (account: Account): Promise<void> => {
    // Its type and currency are fixed once it has entries; ask before the form opens, so the first sight of it is right.
    let locked = false;
    try {
      locked = await accountHasHistory(account.id);
    } catch {
      // Not knowing leaves them open; if the account does have history the table refuses the change (LI-I26) and the form shows its message.
      locked = false;
    }
    setForm({ account, locked });
  };

  // A card's EMI plans: added to the household's debts from here, when they were not added at the import (card-cycles.md 4a). Only an owner or a partner reads and writes debts.
  const addToDebts = async (account: Account): Promise<void> => {
    setAddingDebt(account.id);
    try {
      const changed = await syncCardEmiDebts({ householdId: data.household.id, role: data.viewer.role, add: (card) => card.id === account.id });
      setSaid(changed > 0 ? `${account.name} EMI plans are in your debts, as its statements say.` : `${account.name} EMI plans already say what its statements do.`);
      void ledger.reload();
    } catch (error) {
      setSaid(error instanceof Error ? error.message : 'Those EMI plans could not be added to your debts.');
    } finally {
      setAddingDebt(null);
    }
  };

  const row = (account: Account) => {
    const emiLine = readsHousehold && account.type === 'card' ? cardEmiDebtLine(data.balances, account, data.cardDebts, privacy) : null;
    const parts = accountRow(account, { members: data.members, balance: latest.get(account.id) ?? null, privacy, statementDay: lateStatementDay(data.balances, account.id) });
    return (
      <li key={account.id}>
        <button
          type="button"
          className="flat-row w-full text-left"
          disabled={!mayAdd}
          aria-label={`${parts.title}. ${parts.sub}. ${parts.value}, ${parts.note}. Change it.`}
          onClick={() => {
            void open(account);
          }}
        >
          <span className="flat-row-main">
            <span className="flat-row-title">{parts.title}</span>
            <span className="note">{parts.sub}</span>
          </span>
          <span className="flat-row-value tabular-nums">
            <span className={parts.hasBalance ? undefined : 'note'}>{parts.value}</span>
            <span className="note block">{parts.note}</span>
          </span>
          <span className="flat-row-chevron" aria-hidden="true">
            <Chevron />
          </span>
        </button>
        {emiLine !== null && (
          <p className="note mt-1 flex flex-wrap items-center gap-x-3" data-testid="card-emi-line">
            <span>{emiLine.text}</span>
            {(!emiLine.inDebts || emiLine.behind) && mayAdd && (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={addingDebt !== null}
                aria-label={emiLine.inDebts ? `Bring ${parts.title} EMI plans up to date` : `Add ${parts.title} EMI plans to your debts`}
                onClick={() => {
                  void addToDebts(account);
                }}
              >
                {emiLine.inDebts ? 'Bring up to date' : 'Add to your debts'}
              </button>
            )}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      {none ? (
        <section className="card card-lift" aria-label="No accounts yet">
          <span className="label">No accounts yet</span>
          <p className="mt-2">Accounts are optional. Without them, each month is worked out from what you enter, and says so.</p>
          <p className="note mt-2">
            Add the accounts your money passes through to close a month from balances: an exact saved figure, and your cash reserve.
          </p>
        </section>
      ) : (
        <section className="card card-lift" aria-label="Cash reserve">
          <span className="label">Cash reserve</span>
          {!readsHousehold ? (
            <p className="note mt-2">The household’s cash reserve is read by an owner or a partner: it includes accounts you cannot see.</p>
          ) : closedMonth === null ? (
            <>
              <p className="mt-2">After the first month close.</p>
              <p className="note mt-1">It comes from the balances typed at a close, with card dues taken off.</p>
            </>
          ) : reserve.status === 'ready' && reserve.lines.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2" data-testid="cash-reserve">
              {reserve.lines.map((line) => (
                <div key={line.reserve.currency} className="flex flex-col">
                  {line.counted === 0 ? (
                    <p className="note">No balance typed in {line.reserve.currency}.</p>
                  ) : (
                    <p className="figure tabular-nums">{formatMoney(line.reserve, { privacy })}</p>
                  )}
                  <p className="note tabular-nums">
                    from balances at {formatShortDate(lastDayOf(closedMonth))} · {String(line.counted)} of {String(line.total)} {line.total === 1 ? 'account' : 'accounts'} · card dues
                    netted
                  </p>
                </div>
              ))}
            </div>
          ) : reserve.status === 'failed' ? (
            <p className="note mt-2">The cash reserve could not be read just now. Reload to read it again.</p>
          ) : reserve.status === 'ready' ? (
            <p className="note mt-2">No balance typed yet for the accounts in use. It comes from the balances typed at a close.</p>
          ) : (
            <p className="note mt-2">Reading…</p>
          )}
          {ledger.moneyStatus === 'failed' && data.viewer.canRecord && (
            <p className="note mt-3">Close {monthWord(closeMonthKey)} cannot be offered just now: the credits and moves could not be read. Reload to try again.</p>
          )}
          {offer && (
            <button
              type="button"
              className="btn btn-quiet add-pill mt-3"
              onClick={() => {
                setSaid(null);
                setClosing(true);
              }}
            >
              Close {monthWord(closeMonthKey)} · about 2 minutes
            </button>
          )}
          <p className="note mt-2" role="status">
            {said}
          </p>
        </section>
      )}

      {!none && (
        <section className="card" aria-label="Accounts">
          <div className="section-head">
            <h2 className="label">Accounts</h2>
          </div>
          {split.active.length === 0 ? <p className="note">Every account is archived.</p> : <ul className="flat-rows">{split.active.map(row)}</ul>}
        </section>
      )}

      {mayAdd && (
        // The one Add is a full-width outlined pill, as the boards draw it: it is not the primary action of a screen that has a lifted surface.
        <button
          type="button"
          className="btn btn-quiet add-pill"
          onClick={() => {
            setForm({ account: null, locked: false });
          }}
        >
          + Add an account
        </button>
      )}

      {split.archived.length > 0 && (
        <section className="card" aria-label="Archived">
          <Disclosure
            open={archivedOpen}
            onToggle={() => {
              setArchivedOpen((was) => !was);
            }}
          >
            <h2 className="label">Archived · {split.archived.length}</h2>
          </Disclosure>
          {archivedOpen && (
            <ul className="flat-rows mt-2">
              {split.archived.map((account) => {
                const parts = accountRow(account, { members: data.members, balance: null, privacy });
                return (
                  <li key={account.id}>
                    <button
                      type="button"
                      className="flat-row w-full text-left"
                      disabled={!mayAdd}
                      aria-label={`${parts.title}, archived. History kept. Restore it or change it.`}
                      onClick={() => {
                        void open(account);
                      }}
                    >
                      <span className="flat-row-main">
                        <span className="flat-row-title">{parts.title}</span>
                        <span className="note">{parts.sub.split(' · ').slice(0, 2).join(' · ')} · archived</span>
                      </span>
                      <span className="flat-row-value note">history kept</span>
                      <span className="flat-row-chevron" aria-hidden="true">
                        <Chevron />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <WhatIsKept />

      {closing && (
        <CloseMonth
          data={data}
          month={closeMonthKey}
          today={today}
          credits={ledger.credits}
          transfers={ledger.transfers}
          closedWithout={ledger.closesWithout}
          canCloseWithout={data.viewer.role === 'owner' || data.viewer.role === 'partner'}
          onClosedWithoutChanged={() => {
            void ledger.reloadMoney();
          }}
          privacy={privacy}
          onDone={(message) => {
            setClosing(false);
            setSaid(message);
            void ledger.reload();
          }}
          onCancel={() => {
            setClosing(false);
          }}
        />
      )}

      {form !== null && (
        <AddAccount
          data={data}
          editing={form.account}
          locked={form.locked}
          onAdd={add}
          onChange={change}
          onSaved={() => {
            setForm(null);
          }}
          onCancel={() => {
            setForm(null);
          }}
        />
      )}
    </div>
  );
}
