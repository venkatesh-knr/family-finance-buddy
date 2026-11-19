/**
 * Import a statement (docs/design/spending-capture.md sections 3 and 4; docs/build-plan.md step 7 and 7a): the Money screen's way to bring a month of spending in from a bank, a
 * card or Google Pay, in place of typing it.
 *
 * Three steps on a screen of their own. *Choose the statement*: the file is read on this device (a protected PDF asks for its password here, and the password is used once and not
 * kept), found to be one the app reads or said not to be, and its lines hashed and matched against what the household already has. *What it will do*: every line, with what the import
 * will do with it and what it may be changed to; what needs an answer is first, and nothing is written until it has one. *Confirm*: a fresh authenticator code, since an import writes to
 * the household's record. The matching and the plan are pure (`src/domain/statement/`); the writing is `src/repo/statementImport.ts`.
 *
 * A statement that does not add up to its own totals is refused with the difference said, and never imported with a guess: a misread line is worse than a missing one.
 */

import { useState } from 'react';
import { parsePdfStatement, parseTextStatement } from '../../domain/statement/detect.ts';
import type { ParsedStatement, StatementKind } from '../../domain/statement/common.ts';
import { matchStatement, type MatchResult } from '../../domain/statement/match.ts';
import { planImport, type Decision } from '../../domain/statement/plan.ts';
import { formatShortDate } from '../../lib/dates.ts';
import { PasswordNeeded } from '../../lib/ecas-pdf.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { hashStatement } from '../../lib/statementHash.ts';
import { readStatementPages } from '../../lib/statement-pdf.ts';
import { verifyTotpCode } from '../../repo/auth.ts';
import { commitImport, periodOf, readMatchingContext, type MatchingContext } from '../../repo/statementImport.ts';
import { Field, PasswordField, Problem, RequiredKey } from '../../ui/primitives.tsx';
import { Select } from '../../ui/Select.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { previewRows, type PreviewGroup, type PreviewRow } from './statementPreview.ts';
import type { AccountsData } from './useAccounts.ts';

const KIND_WORDS: Record<StatementKind, string> = {
  hdfc_delimited: 'an HDFC delimited file',
  hdfc_text: 'an HDFC statement',
  qif: 'a QIF file',
  icici_savings_pdf: 'an ICICI savings statement',
  icici_card_pdf: 'an ICICI credit card statement',
  axis_card_pdf: 'an Axis credit card statement',
  gpay_pdf: 'a Google Pay statement',
};

const GROUP_HEADINGS: Record<PreviewGroup, string> = {
  decide: 'Needs your answer',
  add: 'To add as expenses',
  merge: 'Already entries: this statement is added to them',
  left: 'Left out',
};

interface Read {
  readonly statement: ParsedStatement;
  readonly matched: MatchResult;
  readonly context: MatchingContext;
}

export function ImportStatement({ data, privacy, onDone, onCancel }: { data: AccountsData; privacy: boolean; onDone: (said: string) => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [decisions, setDecisions] = useState<ReadonlyMap<number, Decision>>(new Map());
  const [label, setLabel] = useState('');
  const [memberId, setMemberId] = useState(data.viewer.memberId);
  const [visibility, setVisibility] = useState<'household' | 'personal'>('household');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [finishProblem, setFinishProblem] = useState<string | null>(null);

  const show = (minor: bigint): string => formatMoney(money(minor, 'INR'), { privacy });

  const open = async (chosen: File, passwordGiven: string): Promise<void> => {
    setReading(true);
    setProblem(null);
    setRead(null);
    setDecisions(new Map());
    try {
      const bytes = await chosen.arrayBuffer();
      const detected = /\.pdf$/i.test(chosen.name) ? parsePdfStatement(await readStatementPages(bytes, passwordGiven)) : parseTextStatement(new TextDecoder('utf-8').decode(bytes));
      if (detected.statement === null) {
        setProblem(detected.problem ?? 'That file could not be read.');
        return;
      }
      const statement = detected.statement;
      setNeedPassword(false);
      if (statement.lines.length === 0 && statement.problems.length === 0) {
        setProblem('That statement has no transactions in it.');
        return;
      }
      const hashed = await hashStatement(statement);
      const period = periodOf(statement.lines.map((line) => line.date)) ?? { from: statement.periodStart ?? '', to: statement.periodEnd ?? '' };
      const context = await readMatchingContext({ householdId: data.household.id, from: period.from, to: period.to, lineHashes: hashed.map((entry) => entry.lineHash) });
      const matched = matchStatement({ statement, lines: hashed, accounts: context.accounts, existing: context.existing, knownLineHashes: context.knownLineHashes });
      setRead({ statement, matched, context });
    } catch (error) {
      if (error instanceof PasswordNeeded) {
        setNeedPassword(true);
        setProblem(error.message);
      } else {
        setProblem(error instanceof Error ? error.message : 'That file could not be read.');
      }
    } finally {
      setReading(false);
    }
  };

  const plan = read === null ? null : planImport(read.matched.rows, decisions);
  const rows = read === null ? [] : previewRows(read.matched.rows, decisions, read.context.existing);
  const blocked = read !== null && read.statement.problems.length > 0;

  const choose = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setNeedPassword(false);
    setPassword('');
    setRead(null);
    setProblem(null);
    if (chosen !== null) void open(chosen, '');
  };

  const finish = async (): Promise<void> => {
    if (read === null || plan === null || !plan.canCommit) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setFinishProblem('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setFinishProblem(null);
    try {
      await verifyTotpCode(code);
      const dates = read.statement.lines.map((line) => line.date);
      const outcome = await commitImport({
        householdId: data.household.id,
        memberId,
        visibility,
        kind: read.statement.kind,
        label: label.trim() === '' ? null : label.trim(),
        period: periodOf(dates),
        statementLast4: read.statement.kind === 'gpay_pdf' ? null : read.statement.last4,
        accountsToAdd: read.matched.accountsToAdd,
        writes: plan.writes,
        memberOf: read.context.memberOf,
      });
      const parts = [`${String(outcome.entriesCreated)} ${outcome.entriesCreated === 1 ? 'expense' : 'expenses'} added`];
      if (outcome.witnessesAdded > 0) parts.push(`${String(outcome.witnessesAdded)} added to entries you already had`);
      if (outcome.accountsAdded > 0) parts.push(`${String(outcome.accountsAdded)} ${outcome.accountsAdded === 1 ? 'account' : 'accounts'} added`);
      if (outcome.alreadyThere > 0) parts.push(`${String(outcome.alreadyThere)} already there`);
      if (outcome.conflicts > 0) parts.push(`${String(outcome.conflicts)} left out: a payment with that reference is an entry you cannot see`);
      onDone(`Imported: ${parts.join(', ')}.`);
    } catch (error) {
      setFinishProblem(error instanceof Error ? error.message : 'The import could not be written. Nothing is doubled if you run it again.');
    } finally {
      setBusy(false);
    }
  };

  const rowsIn = (group: PreviewGroup): PreviewRow[] => rows.filter((row) => row.group === group);
  const renderRow = (row: PreviewRow) => (
    <li key={row.index} className="statement-row" data-testid="statement-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-semibold">{row.title}</span>
        <span className="tabular-nums">
          {row.direction === 'credit' ? '+ ' : ''}
          {show(row.amountMinor)}
        </span>
      </div>
      <p className="note">
        {formatShortDate(row.date)} · {row.doing}
      </p>
      {row.options.length > 1 && (
        <select
          className="field mt-1.5"
          aria-label={`What to do with ${row.title}, ${formatShortDate(row.date)}`}
          value={row.decision ?? ''}
          onChange={(event) => {
            const next = event.target.value as Decision;
            setDecisions((was) => new Map(was).set(row.index, next));
          }}
        >
          {row.decision === null && (
            <option value="" disabled>
              Choose…
            </option>
          )}
          {row.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </li>
  );

  const members = data.members;

  return (
    <Stepper
      title="Import a statement"
      finishLabel="Import"
      busyLabel="Importing…"
      busy={busy}
      problem={finishProblem}
      onFinish={finish}
      onCancel={onCancel}
      steps={[
        {
          name: 'Choose the statement',
          ready: read !== null && !blocked,
          content: (
            <>
              <p className="note">
                Choose a bank, card or Google Pay statement. It is read on this device: nothing is uploaded, and the file, its name and its password are not kept.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="label" htmlFor="statement-file">
                  Statement
                </label>
                <input
                  id="statement-file"
                  className="field"
                  type="file"
                  accept=".pdf,.txt,.csv,.qif,application/pdf,text/plain"
                  disabled={reading || busy}
                  onChange={choose}
                />
              </div>

              {needPassword && file !== null && (
                <div className="flex flex-col gap-2">
                  <PasswordField
                    label="Password for this PDF"
                    value={password}
                    autoComplete="off"
                    onChange={(event) => {
                      setPassword(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void open(file, password);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-quiet self-start"
                    disabled={reading || password === ''}
                    onClick={() => {
                      void open(file, password);
                    }}
                  >
                    Open it
                  </button>
                </div>
              )}

              {reading && (
                <p className="note" role="status">
                  Reading the statement…
                </p>
              )}
              {problem !== null && <Problem>{problem}</Problem>}

              {read !== null && (
                <p className="note" role="status" data-testid="statement-read">
                  Read {String(read.statement.lines.length)} {read.statement.lines.length === 1 ? 'line' : 'lines'} from {KIND_WORDS[read.statement.kind]}.
                </p>
              )}
              {blocked && read !== null && (
                <div data-testid="statement-problems">
                  <Problem>This statement does not add up, so nothing can be imported from it. A line may have been misread, and a misread line is worse than a missing one.</Problem>
                  <ul className="note mt-1.5 list-disc pl-5">
                    {read.statement.problems.slice(0, 8).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Field
                label="A name for this import"
                placeholder="optional"
                value={label}
                maxLength={120}
                hint="Optional. To recognise it later; not the file’s own name."
                autoComplete="off"
                onChange={(event) => {
                  setLabel(event.target.value);
                }}
              />
            </>
          ),
        },
        {
          name: 'What it will do',
          ready: plan !== null && plan.canCommit,
          content:
            read === null || plan === null ? (
              <p className="note">Choose a statement first.</p>
            ) : (
              <>
                <p className="note" data-testid="statement-summary">
                  {String(plan.counts.create)} to add as expenses · {String(plan.counts.witness)} added to entries you already have · {String(plan.counts.skip)} left out
                  {plan.counts.undecided > 0 ? ` · ${String(plan.counts.undecided)} need your answer` : ''}
                </p>
                <p className="note">Change anything here before it is written. A line that is not an expense, such as a card repayment, is left out and says why.</p>

                {read.matched.accountsToAdd.length > 0 && (
                  <div data-testid="statement-accounts">
                    <h3 className="label">Accounts that will be added</h3>
                    <ul className="note mt-1 list-disc pl-5">
                      {read.matched.accountsToAdd.map((account) => (
                        <li key={account.last4}>
                          {account.institution ?? 'Account'} ••{account.last4} ({account.type === 'card' ? 'a card' : 'a savings account'})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.viewer.canFileForOthers && members.length > 1 && (
                  <Select
                    label="Whose they are"
                    value={memberId}
                    onChange={(event) => {
                      setMemberId(event.target.value);
                    }}
                  >
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </Select>
                )}

                <div className="flex flex-col gap-1.5">
                  <span className="label" id="statement-visibility-label">
                    Who can see these
                  </span>
                  <div className="segmented self-start" role="group" aria-labelledby="statement-visibility-label">
                    <button
                      type="button"
                      aria-pressed={visibility === 'household'}
                      onClick={() => {
                        setVisibility('household');
                      }}
                    >
                      The household
                    </button>
                    <button
                      type="button"
                      aria-pressed={visibility === 'personal'}
                      onClick={() => {
                        setVisibility('personal');
                      }}
                    >
                      Only them
                    </button>
                  </div>
                </div>

                {(['decide', 'add', 'merge'] as const).map((group) =>
                  rowsIn(group).length === 0 ? null : (
                    <section key={group} aria-label={GROUP_HEADINGS[group]} data-testid={`statement-group-${group}`}>
                      <h3 className="label">
                        {GROUP_HEADINGS[group]} ({String(rowsIn(group).length)})
                      </h3>
                      <ul className="mt-1.5 flex flex-col gap-3">{rowsIn(group).map(renderRow)}</ul>
                    </section>
                  ),
                )}
                {rowsIn('left').length > 0 && (
                  <details data-testid="statement-group-left">
                    <summary className="label cursor-pointer">
                      {GROUP_HEADINGS.left} ({String(rowsIn('left').length)})
                    </summary>
                    <ul className="mt-1.5 flex flex-col gap-3">{rowsIn('left').map(renderRow)}</ul>
                  </details>
                )}
              </>
            ),
        },
        {
          name: 'Confirm',
          ready: /^\d{6}$/.test(code.trim()) && plan !== null && plan.canCommit,
          content: (
            <>
              <RequiredKey />
              <p className="note">
                {plan === null ? '' : `This writes ${String(plan.counts.create)} ${plan.counts.create === 1 ? 'expense' : 'expenses'}`}
                {plan !== null && plan.counts.witness > 0 ? ` and adds this statement to ${String(plan.counts.witness)} you already have` : ''}
                {plan === null ? '' : '. Nothing is doubled if the same statement is imported again.'}
              </p>
              <Field
                label="Code from your authenticator app"
                needed
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
              <p className="note">An import writes to the household’s record, so it asks for a fresh code first.</p>
            </>
          ),
        },
      ]}
    />
  );
}

