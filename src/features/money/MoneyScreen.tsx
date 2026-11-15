/**
 * Money: quick add, the month, *+ Money in* under it with the close and the way to Accounts, what is expected, and the ledger (docs/design/ledger-income.md
 * sections 1 and 3).
 *
 * One screen, with no tabs. Accounts moved behind More on 15 November 2026 (the owner), at `#/accounts`; this screen asks for the first account
 * with a card, and afterwards keeps one quiet line to manage them (`AccountsNudge`). The money in and money moved are listed beside the spending in
 * the list that was there, and a month is closed from here.
 */

import { ExpensesScreen } from '../expenses/ExpensesScreen.tsx';
import { useState } from 'react';
import { todayInIst } from '../../repo/expenses.ts';
import type { Credit } from '../../repo/types.ts';
import type { IncomeRule } from '../../repo/types.ts';
import { AddCredit } from './AddCredit.tsx';
import { ConfirmAtAmount } from './ConfirmAtAmount.tsx';
import { mayChangeCredit } from './creditForm.ts';
import { ExpectedPanel } from './ExpectedPanel.tsx';
import { MoneyIn } from './MoneyIn.tsx';
import { AccountsAction, AccountsHint } from './AccountsNudge.tsx';
import { accountsNudge } from './accountsNudge.ts';
import { SalaryRuleForm } from './SalaryRuleForm.tsx';
import { CloseMonth } from './CloseMonth.tsx';
import { accountSteps, closeFigures, monthToClose, monthWord, offersClose } from './closeMonth.ts';
import { lastMonthView, type LastMonthView } from './lastMonth.ts';
import { usePrivateClose } from './usePrivateClose.ts';
import { VoidMove } from './VoidMove.tsx';
import type { LedgerLine } from './ledgerLines.ts';
import { expectedRows, ruleHistory, ruleListRows, type RuleDraft } from './ruleForm.ts';
import { useMoneyLedger } from './useMoneyLedger.ts';

export function MoneyScreen({
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
  const [changing, setChanging] = useState<Credit | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // The salary rule form: a new rule from a credit, or one being changed. And the form that confirms an expected credit at another amount.
  const [newRule, setNewRule] = useState<RuleDraft | null>(null);
  const [editingRule, setEditingRule] = useState<IncomeRule | null>(null);
  const [confirming, setConfirming] = useState<{ rule: IncomeRule; dueDate: string } | null>(null);
  // A move being voided: its id and the line that names it.
  const [voidingMove, setVoidingMove] = useState<{ id: string; line: LedgerLine } | null>(null);
  const [closing, setClosing] = useState(false);
  const viewer = ledger.data?.viewer ?? null;
  const nudge = ledger.data === null ? null : accountsNudge({ accounts: ledger.data.accounts, canRecord: ledger.data.viewer.canRecord });
  const today = todayInIst();
  // The prompt from the 1st: Close October, until every account in use has a closing balance on October's last day.
  const closeMonthKey = monthToClose(today);
  // Last month on the month surface, for an owner or a partner: the closed figures, or the open state while nobody has closed it. What another
  // member keeps private is added by the database as totals (usePrivateClose), and until it is read there is no figure.
  const lastPrivate = usePrivateClose(ledger.data?.household.id ?? null, ledger.data?.viewer.role ?? null, closeMonthKey);
  const lastMonth: LastMonthView | null = (() => {
    if (ledger.data === null || !lastPrivate.asks) return null;
    const input = {
      month: closeMonthKey,
      today,
      accounts: ledger.data.accounts,
      balances: ledger.data.balances,
      credits: ledger.credits,
      transfers: ledger.transfers,
      typed: {},
      ...(lastPrivate.unread === null || lastPrivate.unread.length === 0 ? {} : { unreadable: lastPrivate.unread }),
    };
    const waiting = ledger.moneyStatus === 'loading' || (lastPrivate.unread === null && !lastPrivate.failed);
    const failed = ledger.moneyStatus === 'failed' || lastPrivate.failed;
    return lastMonthView({
      month: closeMonthKey,
      close: closeFigures(input),
      readable: accountSteps(input).length,
      hidden: lastPrivate.unread ?? [],
      ...(failed ? { reading: 'failed' as const } : waiting ? { reading: 'loading' as const } : {}),
    });
  })();
  // Not offered until the credits and moves have been read: money in read as nothing would make spent read low.
  const mayClose =
    ledger.data !== null &&
    offersClose({
      month: closeMonthKey,
      accounts: ledger.data.accounts,
      balances: ledger.data.balances,
      canRecord: ledger.data.viewer.canRecord,
      moneyReady: ledger.moneyStatus === 'ready',
    });
  // Only an owner or a partner makes or changes a rule, and so confirms or passes over what it expects: the policies refuse anyone else.
  const mayRule = viewer?.role === 'owner' || viewer?.role === 'partner';
  const expected =
    ledger.data === null
      ? []
      : expectedRows(ledger.rules, {
          accounts: ledger.data.accounts,
          today,
          privacy,
          credits: ledger.credits.map((credit) => ({ ruleId: credit.ruleId, dueDate: credit.dueDate })),
        });
  return (
    <>
      {newRule !== null && ledger.data !== null && (
        <SalaryRuleForm
          data={ledger.data}
          draft={newRule}
          onSaved={() => {
            setNewRule(null);
            setSaid('Rule saved. On payday a credit waits here as Expected.');
            void ledger.reloadMoney();
          }}
          onCancel={() => {
            setNewRule(null);
          }}
        />
      )}
      {editingRule !== null && ledger.data !== null && (
        <SalaryRuleForm
          key={editingRule.id}
          data={ledger.data}
          editing={editingRule}
          history={ruleHistory(
            editingRule,
            ledger.credits.map((credit) => ({ ruleId: credit.ruleId, dueDate: credit.dueDate, amount: credit.amount, isVoided: credit.isVoided })),
            { today, privacy, viewerMemberId: ledger.data?.viewer.memberId ?? '' },
          )}
          onSaved={(outcome) => {
            setEditingRule(null);
            setSaid(
              outcome === 'paused' ? 'Rule paused. It expects nothing until it is resumed.' : outcome === 'archived' ? 'Rule archived.' : outcome === 'resumed' ? 'Rule resumed.' : 'Rule changed.',
            );
            void ledger.reloadMoney();
          }}
          onCancel={() => {
            setEditingRule(null);
          }}
        />
      )}
      {closing && ledger.data !== null && (
        <CloseMonth
          data={ledger.data}
          month={closeMonthKey}
          today={today}
          credits={ledger.credits}
          transfers={ledger.transfers}
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
      {voidingMove !== null && (
        <VoidMove
          key={voidingMove.id}
          id={voidingMove.id}
          line={voidingMove.line}
          onDone={(message) => {
            setVoidingMove(null);
            setSaid(message);
            void ledger.reloadMoney();
          }}
          onCancel={() => {
            setVoidingMove(null);
          }}
        />
      )}
      {confirming !== null && (
        <ConfirmAtAmount
          rule={confirming.rule}
          dueDate={confirming.dueDate}
          privacy={privacy}
          onDone={(message) => {
            setConfirming(null);
            setSaid(message);
            void ledger.reloadMoney();
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
      <ExpensesScreen
        privacy={privacy}
        householdId={householdId}
        recurringMade={recurringMade}
        displayCurrency={displayCurrency}
        money={{
          // Quick add is first on the screen, then the month, and inside the month card three actions side by side: money in, the close, and the way
          // to Accounts (the owner, 15 November 2026). What was done is said under them.
          actions: (
            <>
              <div className="month-actions">
                <MoneyIn
                  data={ledger.data}
                  privacy={privacy}
                  onAddAccount={ledger.add}
                  onChangeAccount={ledger.change}
                  onSaved={() => {
                    setSaid(null);
                    void ledger.reloadMoney();
                  }}
                  onSaid={setSaid}
                  canRepeat={mayRule}
                  onRepeat={(draft) => {
                    setNewRule(draft);
                  }}
                />
                {mayClose && (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    aria-label={`Close ${monthWord(closeMonthKey)} · about 2 minutes`}
                    onClick={() => {
                      setSaid(null);
                      setClosing(true);
                    }}
                  >
                    <span>
                      Close {monthWord(closeMonthKey)}
                      <span className="note block">about 2 minutes</span>
                    </span>
                  </button>
                )}
                <AccountsAction nudge={nudge} />
              </div>
              <AccountsHint nudge={nudge} />
              {/* Always in the page, so that what is put into it is announced; under the buttons, where the person is looking. */}
              <p className="note" role="status">
                {said}
              </p>
            </>
          ),
          lastMonth,
          expected:
            viewer === null ? undefined : (
              <ExpectedPanel
                rows={expected}
                rules={ledger.rules}
                ruleRows={ruleListRows(ledger.rules, { accounts: ledger.data?.accounts ?? [], privacy })}
                canChange={() => mayRule}
                onChangeAmount={(rule, dueDate) => {
                  setSaid(null);
                  setConfirming({ rule, dueDate });
                }}
                onChangeRule={(rule) => {
                  setSaid(null);
                  setEditingRule(rule);
                }}
                onDone={(message) => {
                  setSaid(message);
                  void ledger.reloadMoney();
                }}
              />
            ),
          ...(viewer === null || !viewer.canRecord
            ? {}
            : {
                onVoidMove: (transfer: { id: string }, line: LedgerLine) => {
                  setSaid(null);
                  setVoidingMove({ id: transfer.id, line });
                },
              }),
          ...(viewer === null
            ? {}
            : {
                canChangeCredit: (credit: Credit) => mayChangeCredit(credit, viewer),
                onEditCredit: (credit: Credit) => {
                  setSaid(null);
                  setChanging(credit);
                },
              }),
          // The month surface, whose Came in counts other members' private credits, is shown to an owner or a partner.
          inCameIn: viewer?.role === 'owner' || viewer?.role === 'partner',
          credits: ledger.credits,
          transfers: ledger.transfers,
          accounts: ledger.data?.accounts ?? [],
          status: ledger.moneyStatus,
          onRetry: () => {
            void ledger.reloadMoney();
          },
        }}
      />
      {changing !== null && ledger.data !== null && (
        <AddCredit
          key={changing.id}
          data={ledger.data}
          editing={changing}
          onAddAccount={ledger.add}
          onChangeAccount={ledger.change}
          onSaved={() => {
            setChanging(null);
          }}
          onChanged={(outcome) => {
            setChanging(null);
            setSaid(outcome === 'voided' ? 'Credit voided. It no longer counts.' : 'Credit changed.');
            void ledger.reloadMoney();
          }}
          onCancel={() => {
            setChanging(null);
          }}
        />
      )}
    </>
  );
}
