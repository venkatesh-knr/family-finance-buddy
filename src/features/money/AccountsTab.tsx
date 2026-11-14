/**
 * Money's second tab: the household's accounts (docs/design/ledger-income.md section 1a; the MoneyAccounts and MoneyAccountsEmpty boards).
 *
 * Accounts are optional: a family can start without any, and the tab says what a month is like without them and what adding them gives.
 * With some, the lifted surface is the cash reserve, which comes from a close's balances and so waits for the first close; a soft panel
 * lists the accounts, each with its type, whose it is, who sees it and its last balance; then the button, the archived ones folded, and
 * what is kept. A private account is listed only to its owner, because row-level security returns nothing else.
 *
 * No figure here is worked out. The cash reserve will be the month close's, from balances, with other members' private accounts inside
 * the total through the sum function (LI-I27); until then it says so and shows no number.
 */

import { useEffect, useMemo, useState } from 'react';
import { accountHasHistory } from '../../repo/accounts.ts';
import type { Account } from '../../repo/types.ts';
import { Chevron, Disclosure } from '../../ui/primitives.tsx';
import { AddAccount } from './AddAccount.tsx';
import { accountRow, latestBalances, splitAccounts } from './accountRows.ts';
import { useAccounts } from './useAccounts.ts';

function WhatIsKept() {
  return (
    <section className="card" aria-label="What an account is">
      <h2 className="label mb-2">What is kept</h2>
      <p className="note">
        A name you choose, the type, whose it is and who sees it. The bank and the last four digits are optional. No account number, no bank login, and no link
        to your bank. Balances are typed at the month close, or read from a statement on your phone.
      </p>
    </section>
  );
}

function Lock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function AccountsTab({ householdId, privacy }: { householdId: string | null; privacy: boolean }) {
  const { data, loading, problem, add, change } = useAccounts(householdId);
  // The form: closed, a new account, or one being changed with whether its type and currency are fixed.
  const [form, setForm] = useState<{ account: Account | null; locked: boolean } | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

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

  const row = (account: Account) => {
    const parts = accountRow(account, { members: data.members, viewerMemberId: data.viewer.memberId, balance: latest.get(account.id) ?? null, privacy });
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
          {parts.private && (
            <span className="account-badge">
              <Lock />
            </span>
          )}
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
          <p className="mt-2">After the first month close.</p>
          <p className="note mt-1">It comes from the balances typed at a close, with card dues taken off.</p>
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
                const parts = accountRow(account, { members: data.members, viewerMemberId: data.viewer.memberId, balance: null, privacy });
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
