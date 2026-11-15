/**
 * Money: the month, quick add with *+ Money in* under it, what is expected, and the ledger (docs/design/ledger-income.md sections 1 and 3).
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
import { AccountsNudge } from './AccountsNudge.tsx';
import { accountsNudge } from './accountsNudge.ts';
import { SalaryRuleForm } from './SalaryRuleForm.tsx';
import { CloseMonth } from './CloseMonth.tsx';
import { isClosed, monthToClose, monthWord } from './closeMonth.ts';
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
  // Not offered until the credits and moves have been read: money in read as nothing would make spent read low.
  const mayClose =
    ledger.data !== null &&
    ledger.moneyStatus === 'ready' &&
    ledger.data.viewer.canRecord &&
    ledger.data.accounts.some((account) => !account.isArchived) &&
    !isClosed({ month: closeMonthKey, accounts: ledger.data.accounts, balances: ledger.data.balances });
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
      {nudge?.kind === 'add' && <AccountsNudge nudge={nudge} />}
      {mayClose && (
        <button
          type="button"
          className="btn btn-quiet add-pill"
          onClick={() => {
            setSaid(null);
            setClosing(true);
          }}
        >
          Close {monthWord(closeMonthKey)} · about 2 minutes
        </button>
      )}
      {/* Always in the page, so that what is put into it is announced; under the button, where the person is looking. */}
      <p className="note" role="status">
        {said}
      </p>
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
          // Under quick add: money out above it, money in below.
          afterQuickAdd: (
            <MoneyIn
              data={ledger.data}
              privacy={privacy}
              onAddAccount={ledger.add}
              onChangeAccount={ledger.change}
              onSaved={() => {
                setSaid(null);
                void ledger.reloadMoney();
              }}
              canRepeat={mayRule}
              onRepeat={(draft) => {
                setNewRule(draft);
              }}
            />
          ),
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
      {nudge?.kind === 'manage' && <AccountsNudge nudge={nudge} />}
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
