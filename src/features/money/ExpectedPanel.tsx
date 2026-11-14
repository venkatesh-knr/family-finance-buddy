/**
 * Expected: the credits a rule says are due (docs/design/ledger-income.md section 5; the MoneyLedger board, state 2).
 *
 * A credit rule never posts by itself (LI-I8). When it is due, a credit waits here and counts nowhere, not in Came in and not in FIRE, until a
 * person confirms it. Each has three actions: Confirm writes it at the rule's amount, Change amount writes it at the amount that came in, and
 * Not this month writes nothing and moves the rule on. A double tap writes one credit, because the table allows one per rule and due date.
 * The row's rule can be changed, paused or archived from *Change this rule*.
 */

import { useState } from 'react';
import { confirmExpectedCredit, passOverDue } from '../../repo/credits.ts';
import type { IncomeRule } from '../../repo/types.ts';
import { Problem } from '../../ui/primitives.tsx';
import type { ExpectedRow } from './ruleForm.ts';

export function ExpectedPanel({
  rows,
  rules,
  paused,
  canChange,
  onChangeAmount,
  onChangeRule,
  onDone,
}: {
  rows: readonly ExpectedRow[];
  rules: readonly IncomeRule[];
  /** The paused rules, which expect nothing and are listed so that there is a way back to one. */
  paused: readonly IncomeRule[];
  /** Whether the viewer may confirm, pass over or change this rule: only an owner or a partner makes or changes a rule. */
  canChange: (rule: IncomeRule) => boolean;
  onChangeAmount: (rule: IncomeRule, dueDate: string) => void;
  onChangeRule: (rule: IncomeRule) => void;
  /** A credit was confirmed or passed over: the ledger reads again. */
  onDone: (said: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const showPaused = paused.filter(canChange);
  if (rows.length === 0 && showPaused.length === 0) return null;

  const act = async (key: string, run: () => Promise<void>, said: string): Promise<void> => {
    setBusy(key);
    setProblem(null);
    try {
      await run();
      onDone(said);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be done.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" aria-label="Expected">
      <h2 className="label mb-1">Expected</h2>
      {problem !== null && <Problem>{problem}</Problem>}
      <ul className="recent-rows">
        {rows.map((row) => {
          const rule = rules.find((each) => each.id === row.ruleId);
          if (rule === undefined) return null;
          const key = `${row.ruleId}-${row.dueDate}`;
          const may = canChange(rule);
          return (
            <li key={key} aria-label={`${row.title}, ${row.sub}, ${row.amount}, ${row.word}`} className="py-2">
              <div className="flex flex-wrap items-start justify-between gap-x-3">
                <span className="min-w-0 flex-1" style={{ flexBasis: '8rem' }}>
                  <span className="recent-payee block">{row.title}</span>
                  <span className="note block">{row.sub}</span>
                </span>
                <span className="recent-amount tabular-nums" style={{ textAlign: 'right' }}>
                  {row.amount}
                  <span className="note block" style={{ fontWeight: 400 }}>
                    {row.word}
                  </span>
                </span>
              </div>
              {may && !row.actionable && <p className="note mt-1">Deal with this rule’s earlier date first.</p>}
              {may && row.actionable && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="qa-chip"
                    disabled={busy !== null}
                    onClick={() => {
                      void act(key, () => confirmExpectedCredit({ rule, dueDate: row.dueDate }), `Confirmed ${row.title}.`);
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="qa-chip"
                    disabled={busy !== null}
                    onClick={() => {
                      onChangeAmount(rule, row.dueDate);
                    }}
                  >
                    Change amount
                  </button>
                  <button
                    type="button"
                    className="qa-chip"
                    disabled={busy !== null}
                    onClick={() => {
                      void act(key, () => passOverDue(rule, row.dueDate), `${row.title} marked not this month.`);
                    }}
                  >
                    Not this month
                  </button>
                  <button
                    type="button"
                    className="qa-chip"
                    disabled={busy !== null}
                    onClick={() => {
                      onChangeRule(rule);
                    }}
                  >
                    Change this rule
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {showPaused.length > 0 && (
        <ul className="recent-rows" aria-label="Paused rules">
          {showPaused.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span className="note">
                {rule.name} · paused, it expects nothing
              </span>
              <button
                type="button"
                className="qa-chip"
                disabled={busy !== null}
                onClick={() => {
                  onChangeRule(rule);
                }}
              >
                Change this rule
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
