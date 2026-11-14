/**
 * Money, with its two tabs: Ledger and Accounts (docs/design/ledger-income.md section 1a, LI-I25).
 *
 * `#/money` is the Ledger and `#/money?tab=accounts` is Accounts, so a tab is an address, Back undoes it, and a link can point at it. Both
 * tabs keep the bar's Money place. The strip is the Holdings tab style (SL-I1): underlined text at 44px, links with `aria-current`. Until
 * the ledger of credits is built, the Ledger tab is the spending screen as it was.
 */

import { hashFor } from '../../app/route.ts';
import { ExpensesScreen } from '../expenses/ExpensesScreen.tsx';
import { AccountsTab } from './AccountsTab.tsx';
import { MoneyIn } from './MoneyIn.tsx';
import { useMoneyLedger } from './useMoneyLedger.ts';

export type MoneyTab = 'ledger' | 'accounts';

/** The tab an address names. Anything but `tab=accounts` is the Ledger, so a typed address is a request and never a grant. */
export function moneyTabOf(params: URLSearchParams): MoneyTab {
  return params.get('tab') === 'accounts' ? 'accounts' : 'ledger';
}

export function MoneyTabs({ current }: { current: MoneyTab }) {
  return (
    <nav className="tabs" aria-label="Money">
      <a className="tab" href={hashFor('money')} aria-current={current === 'ledger' ? 'page' : undefined}>
        Ledger
      </a>
      <a className="tab" href={hashFor('money', { tab: 'accounts' })} aria-current={current === 'accounts' ? 'page' : undefined}>
        Accounts
      </a>
    </nav>
  );
}

/**
 * The Ledger: the spending screen as it was, with money in and money moved listed beside the spending, and *+ Money in* above it.
 * A component of its own so that the credits are read only when this tab is showing.
 */
function LedgerTab({
  privacy,
  householdId,
  displayCurrency,
  recurringMade,
}: {
  privacy: boolean;
  householdId: string | null;
  displayCurrency: string;
  recurringMade: number;
}) {
  const ledger = useMoneyLedger(householdId);
  return (
    <>
      <MoneyIn data={ledger.data} privacy={privacy} onAddAccount={ledger.add} onChangeAccount={ledger.change} onSaved={ledger.reloadMoney} />
      <ExpensesScreen
        privacy={privacy}
        householdId={householdId}
        recurringMade={recurringMade}
        displayCurrency={displayCurrency}
        money={{
          credits: ledger.credits,
          transfers: ledger.transfers,
          accounts: ledger.data?.accounts ?? [],
          status: ledger.moneyStatus,
          onRetry: () => {
            void ledger.reloadMoney();
          },
        }}
      />
    </>
  );
}

export function MoneyScreen({
  tab,
  privacy,
  householdId,
  displayCurrency,
  recurringMade,
}: {
  tab: MoneyTab;
  privacy: boolean;
  householdId: string | null;
  displayCurrency: string;
  recurringMade: number;
}) {
  return (
    <>
      <MoneyTabs current={tab} />
      {tab === 'accounts' ? (
        <AccountsTab householdId={householdId} privacy={privacy} />
      ) : (
        <LedgerTab privacy={privacy} householdId={householdId} displayCurrency={displayCurrency} recurringMade={recurringMade} />
      )}
    </>
  );
}
