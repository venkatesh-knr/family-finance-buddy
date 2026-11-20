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
import { findMoves } from '../../domain/statement/moves.ts';
import { personalCredits, planImport, resolveRows, type Decision } from '../../domain/statement/plan.ts';
import { cardNotes, statedBalances, type CycleEnds } from '../../domain/statement/statedBalance.ts';
import { suggestCategories, suggestionWords, type Suggestion } from '../../domain/statement/suggestCategory.ts';
import { CREDIT_CATEGORIES, CREDIT_LABEL, type CreditCategory } from '../../domain/credit.ts';
import { formatShortDate, istCalendarDate } from '../../lib/dates.ts';
import { PasswordNeeded } from '../../lib/ecas-pdf.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { hashStatement } from '../../lib/statementHash.ts';
import { readStatementPages } from '../../lib/statement-pdf.ts';
import { verifyTotpCode } from '../../repo/auth.ts';
import { commitImport, commitMoves, periodOf, readCategoryContext, readMatchingContext, type MatchingContext } from '../../repo/statementImport.ts';
import { Field, PasswordField, Problem, RequiredKey } from '../../ui/primitives.tsx';
import { monthWord } from './closeMonth.ts';
import { Select } from '../../ui/Select.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { cardNoteWords, previewRows, type PreviewGroup, type PreviewRow } from './statementPreview.ts';
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

/** A statement by what it is, for a row that says which of several it is on. */
const KIND_NAME: Record<StatementKind, string> = {
  hdfc_delimited: 'HDFC file',
  hdfc_text: 'HDFC statement',
  qif: 'QIF file',
  icici_savings_pdf: 'ICICI savings',
  icici_card_pdf: 'ICICI card',
  axis_card_pdf: 'Axis card',
  gpay_pdf: 'Google Pay',
};

const GROUP_HEADINGS: Record<PreviewGroup, string> = {
  decide: 'Needs your answer',
  guess: 'Left out as a guess: check these',
  add: 'To add',
  merge: 'Already entries: this statement is added to them',
  left: 'Left out',
};

interface Read {
  readonly statement: ParsedStatement;
  readonly matched: MatchResult;
  readonly context: MatchingContext;
  /** The household's categories in use, for the choice on each new expense. */
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  /** A suggested category for each row that could be an entry, from what the household has filed before; null where there is no basis. */
  readonly suggestions: readonly (Suggestion | null)[];
}

/** How many problems a refused statement lists before saying how many more there are. */
const PROBLEMS_SHOWN = 8;

export function ImportStatement({ data, privacy, onDone, onCancel }: { data: AccountsData; privacy: boolean; onDone: (said: string) => void; onCancel: () => void }) {
  const [files, setFiles] = useState<readonly File[]>([]);
  const [password, setPassword] = useState('');
  // The place in the chosen files of one that is protected and waits for its password.
  const [waiting, setWaiting] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reads, setReads] = useState<readonly Read[]>([]);
  // Decisions and categories are kept by a row's place among the rows of every statement read together.
  const [decisions, setDecisions] = useState<ReadonlyMap<number, Decision>>(new Map());
  // The statements whose card the person said closes on its statement date, by their place in the list: it is set so when the import is written (card-cycles.md 5).
  // It is the card's, so it is kept by the card's last four and applies to every statement of that card read together.
  const [statementDateFor, setStatementDateFor] = useState<ReadonlySet<string>>(new Set());
  // The category a person chose for a row, where it differs from the suggestion; an empty string is no category.
  const [chosen, setChosen] = useState<ReadonlyMap<number, string>>(new Map());
  const [label, setLabel] = useState('');
  const [memberId, setMemberId] = useState(data.viewer.memberId);
  const [visibility, setVisibility] = useState<'household' | 'personal'>('household');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [finishProblem, setFinishProblem] = useState<string | null>(null);

  const show = (minor: bigint): string => formatMoney(money(minor, 'INR'), { privacy });

  /** One file: read on this device, found to be a statement the app reads, its lines hashed and matched against what the household already has. */
  const readOne = async (chosenFile: File, passwordGiven: string): Promise<Read> => {
    const bytes = await chosenFile.arrayBuffer();
    const detected = /\.pdf$/i.test(chosenFile.name) ? parsePdfStatement(await readStatementPages(bytes, passwordGiven)) : parseTextStatement(new TextDecoder('utf-8').decode(bytes));
    if (detected.statement === null) throw new Error(detected.problem ?? 'That file could not be read.');
    const statement = detected.statement;
    if (statement.lines.length === 0 && statement.problems.length === 0) throw new Error('That statement has no transactions in it.');
    const hashed = await hashStatement(statement);
    const period = periodOf(statement.lines.map((line) => line.date)) ?? { from: statement.periodStart ?? '', to: statement.periodEnd ?? '' };
    const [context, filed] = await Promise.all([
      readMatchingContext({ householdId: data.household.id, from: period.from, to: period.to, lineHashes: hashed.map((entry) => entry.lineHash) }),
      readCategoryContext(data.household.id),
    ]);
    const matched = matchStatement({
      statement,
      lines: hashed,
      accounts: context.accounts,
      existing: context.existing,
      existingCredits: context.existingCredits,
      existingTransfers: context.existingTransfers,
      knownLineHashes: context.knownLineHashes,
      ownNames: data.members.map((member) => member.displayName),
    });
    // A category is suggested only from what this household has filed under the payee before, and says so; a row that could not be an entry gets none.
    const suggestions = suggestCategories({
      lines: matched.rows.map((row) => {
        const entry = 'entry' in row.proposal ? row.proposal.entry : undefined;
        return { payee: entry?.payee ?? null, amountMinor: row.line.amountMinor };
      }),
      history: filed.history,
      active: new Set(filed.categories.map((category) => category.id)),
    });
    return { statement, matched, context, categories: filed.categories, suggestions };
  };

  /** The files in order from one place: each is added to what has been read, and one that needs a password stops the reading until it is given. */
  const readFrom = async (list: readonly File[], from: number, passwordGiven: string, already: readonly Read[]): Promise<void> => {
    setReading(true);
    setProblem(null);
    let got = already;
    try {
      for (let at = from; at < list.length; at += 1) {
        const next = list[at];
        if (next === undefined) continue;
        try {
          got = [...got, await readOne(next, at === from ? passwordGiven : '')];
          setReads(got);
          setWaiting(null);
        } catch (error) {
          if (error instanceof PasswordNeeded) {
            setWaiting(at);
            setProblem(list.length > 1 ? `${next.name}: ${error.message}` : error.message);
          } else {
            const said = error instanceof Error ? error.message : 'That file could not be read.';
            setProblem(list.length > 1 ? `${next.name}: ${said}` : said);
          }
          return;
        }
      }
    } finally {
      setReading(false);
    }
  };

  // The rows of every statement read together, one after another, and which statement each is of.
  const flat = reads.flatMap((read, statement) => read.matched.rows.map((row, local) => ({ row, statement, local })));
  const rowsAll = flat.map((entry) => entry.row);
  const gpayWithOthers = reads.length > 1 && reads.some((read) => read.statement.kind === 'gpay_pdf');
  // A move is a debit on one bank account and a credit of the same amount on another: found across the statements read together, and offered, never taken for certain.
  const moves = findMoves(flat.map((entry) => ({ row: entry.row, bank: reads[entry.statement]?.statement.accountType === 'bank' && reads[entry.statement]?.statement.kind !== 'gpay_pdf' })));

  // What each row will be filed under: what the person chose, or the suggestion, or nothing.
  const categoryOf = (index: number): string | null => {
    const picked = chosen.get(index);
    // Money in is filed under a credit category, which the line's words suggested and a person can change.
    const proposal = flat[index]?.row.proposal;
    const credit = proposal === undefined ? undefined : proposal.action === 'credit' || proposal.action === 'skip' ? proposal.credit : undefined;
    if (credit !== undefined) return picked !== undefined && picked !== '' ? picked : credit.category;
    if (picked !== undefined) return picked === '' ? null : picked;
    const at = flat[index];
    return at === undefined ? null : (reads[at.statement]?.suggestions[at.local]?.categoryId ?? null);
  };
  const categories = new Map(flat.map((_entry, index) => [index, categoryOf(index)] as const));
  const plan = reads.length === 0 ? null : planImport(rowsAll, decisions, categories, moves);
  // Money in that would be private can be written only under the member it belongs to: for someone else it is said here, and the import waits.
  const blockedMoneyIn = plan === null || memberId === data.viewer.memberId ? 0 : personalCredits(plan.writes, visibility);
  const canCommit = plan !== null && plan.canCommit && blockedMoneyIn === 0 && !gpayWithOthers;
  const existingAll = reads.flatMap((read) => read.context.existing);
  const rows = reads.length === 0 ? [] : previewRows(rowsAll, decisions, existingAll, moves);
  const blocked = reads.some((read) => read.statement.problems.length > 0);
  const everyFileRead = files.length > 0 && reads.length === files.length;
  const accountsFor = (read: Read) => read.matched.accountsToAdd.map((account) => (statementDateFor.has(account.last4) && account.type === 'card' ? { ...account, cycleEnds: 'statement' as const } : account));
  const accountsToAdd = [...new Map(reads.flatMap((read) => accountsFor(read)).map((account) => [account.last4, account] as const)).values()];
  const many = reads.length > 1;

  // What each statement states of its account's balance, which the close reads, and what the preview says of it. A card that closes on its statement date (already, or because the person
  // said so here) states its due on its statement date and the one before its period; any other account only a balance on a month's last day.
  const today = istCalendarDate(new Date());
  const cardOf = (read: Read) => (read.statement.accountType === 'card' && read.statement.last4 !== null ? read.context.accounts.find((account) => account.type === 'card' && account.last4 === read.statement.last4) : undefined);
  const switched = (read: Read): boolean => read.statement.last4 !== null && statementDateFor.has(read.statement.last4);
  const cycleOf = (read: Read): CycleEnds => (read.statement.accountType === 'card' && (cardOf(read)?.cycleEnds === 'statement' || switched(read)) ? 'statement' : 'month_end');
  const resolved = resolveRows(rowsAll, decisions, moves);
  /** The day of the card's latest recorded due before this statement: where a statement that prints no period opens. */
  const previousDueOf = (read: Read): string | undefined => {
    const known = cardOf(read);
    const stated = read.statement.card?.statementDate ?? read.statement.periodEnd;
    if (known === undefined || stated === null) return undefined;
    return read.context.cardDues
      .filter((due) => due.accountId === known.id && due.asAt < stated)
      .map((due) => due.asAt)
      .sort()
      .pop();
  };
  // A line the person added as something else (a conversion credit taken as a refund) is not also an EMI conversion.
  const offsetOf = (at: number): number => reads.slice(0, at).reduce((total, read) => total + read.matched.rows.length, 0);
  const balancesOf = (read: Read, at: number) =>
    read.statement.kind === 'gpay_pdf' || read.statement.last4 === null
      ? []
      : statedBalances(read.statement, today, cycleOf(read), {
          previousDue: previousDueOf(read),
          countsAsEmi: (line) => {
            const local = read.statement.lines.indexOf(line);
            return local < 0 || resolved[offsetOf(at) + local]?.decision === 'skip';
          },
        });
  const notesOf = (read: Read) => {
    const known = cardOf(read);
    return cardNotes(
      read.statement,
      cycleOf(read),
      known === undefined ? [] : read.context.cardDues.filter((due) => due.accountId === known.id && due.source === 'typed'),
      previousDueOf(read),
    );
  };
  /** Whether this statement's card can be switched here: it is a card, it closes at month end now, and the statement is not dated on a month end (which closes that month already). */
  const canSwitch = (read: Read): boolean =>
    read.statement.accountType === 'card' && cardOf(read)?.cycleEnds !== 'statement' && (switched(read) || notesOf(read).some((note) => note.kind === 'gives-nothing'));

  const choose = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(event.target.files ?? []);
    setFiles(picked);
    setWaiting(null);
    setPassword('');
    setReads([]);
    setDecisions(new Map());
    setStatementDateFor(new Set());
    setChosen(new Map());
    setProblem(null);
    if (picked.length > 0) void readFrom(picked, 0, '', []);
  };

  const finish = async (): Promise<void> => {
    if (reads.length === 0 || plan === null || !canCommit) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setFinishProblem('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setFinishProblem(null);
    try {
      await verifyTotpCode(code);
      const total = { entries: 0, credits: 0, witnesses: 0, accounts: 0, balances: 0, there: 0, conflicts: 0 };
      // The statements one after another, each with its own batch. A statement with nothing to write is left alone, unless a move needs the account it names.
      const needed = new Set(plan.writes.flatMap((write) => (write.kind === 'move' ? [flat[moves.find((pair) => pair.debit === write.index)?.credit ?? -1]?.statement ?? -1] : [])));
      const batches = new Map<number, string>();
      for (const [at, read] of reads.entries()) {
        const writes = plan.writes.filter((write) => flat[write.index]?.statement === at);
        if (writes.length === 0 && !needed.has(at)) continue;
        const dates = read.statement.lines.map((line) => line.date);
        const outcome = await commitImport({
          householdId: data.household.id,
          memberId,
          viewerMemberId: data.viewer.memberId,
          visibility,
          kind: read.statement.kind,
          label: label.trim() === '' ? null : label.trim(),
          period: periodOf(dates),
          statementLast4: read.statement.kind === 'gpay_pdf' ? null : read.statement.last4,
          accountsToAdd: accountsFor(read),
          balances: balancesOf(read, at),
          statementAccountType: read.statement.accountType,
          setCycleToStatement: read.statement.accountType === 'card' && read.statement.last4 !== null && statementDateFor.has(read.statement.last4),
          writes,
          memberOf: read.context.memberOf,
        });
        batches.set(at, outcome.batchId);
        total.entries += outcome.entriesCreated;
        total.credits += outcome.creditsCreated;
        total.witnesses += outcome.witnessesAdded;
        total.accounts += outcome.accountsAdded;
        total.balances += outcome.balancesRecorded;
        total.there += outcome.alreadyThere;
        total.conflicts += outcome.conflicts;
      }
      // The moves, once every statement has its accounts: each is cited to the batch of the statement its debit is on.
      const made = await commitMoves({
        householdId: data.household.id,
        moves: plan.writes.flatMap((write) => {
          const batchId = batches.get(flat[write.index]?.statement ?? -1);
          return write.kind === 'move' && batchId !== undefined ? [{ move: write.move, batchId }] : [];
        }),
      });
      const parts = [`${String(total.entries)} ${total.entries === 1 ? 'expense' : 'expenses'} added`];
      if (total.credits > 0) parts.push(`${String(total.credits)} money in added`);
      if (made.created > 0) parts.push(`${String(made.created)} ${made.created === 1 ? 'move' : 'moves'} between your accounts added`);
      if (total.witnesses > 0) parts.push(`${String(total.witnesses)} added to entries you already had`);
      if (total.accounts > 0) parts.push(`${String(total.accounts)} ${total.accounts === 1 ? 'account' : 'accounts'} added`);
      if (total.balances > 0) parts.push(`${String(total.balances)} ${total.balances === 1 ? 'balance' : 'balances'} recorded`);
      if (total.there + made.alreadyThere > 0) parts.push(`${String(total.there + made.alreadyThere)} already there`);
      if (total.conflicts > 0) parts.push(`${String(total.conflicts)} left out: a payment with that reference is an entry you cannot see`);
      onDone(`Imported: ${parts.join(', ')}.`);
    } catch (error) {
      setFinishProblem(error instanceof Error ? error.message : 'The import could not be written. Nothing is doubled if you run it again.');
    } finally {
      setBusy(false);
    }
  };

  const statementName = (at: number): string => {
    const read = reads[at];
    return read === undefined ? '' : `${KIND_NAME[read.statement.kind]}${read.statement.last4 === null ? '' : ` ••${read.statement.last4}`}`;
  };
  const rowsIn = (group: PreviewGroup): PreviewRow[] => rows.filter((row) => row.group === group);
  const renderRow = (row: PreviewRow) => (
    <li key={row.index} className="statement-row" data-testid="statement-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-semibold" id={`statement-row-${String(row.index)}`}>
          {row.title}
        </span>
        <span className="tabular-nums">
          {row.direction === 'credit' ? '+ ' : ''}
          {show(row.amountMinor)}
        </span>
      </div>
      <p className="note">
        {formatShortDate(row.date)} · {many ? `${statementName(flat[row.index]?.statement ?? 0)} · ` : ''}{row.doing}
      </p>
      {row.options.length > 1 && (
        <label className="label mt-1.5 block" htmlFor={`statement-do-${String(row.index)}`}>
          What to do
        </label>
      )}
      {row.options.length > 1 && (
        <select
          id={`statement-do-${String(row.index)}`}
          className="field mt-1"
          aria-describedby={`statement-row-${String(row.index)}`}
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
      {row.decision === 'create' && row.moneyIn && reads.length > 0 && (
        <>
          <label className="label mt-1.5 block" htmlFor={`statement-category-${String(row.index)}`}>
            Category
          </label>
          <select
            id={`statement-category-${String(row.index)}`}
            className="field mt-1"
            aria-describedby={`statement-row-${String(row.index)}`}
            value={categoryOf(row.index) ?? ''}
            onChange={(event) => {
              const next = event.target.value;
              setChosen((was) => new Map(was).set(row.index, next));
            }}
          >
            {CREDIT_CATEGORIES.map((category: CreditCategory) => (
              <option key={category} value={category}>
                {CREDIT_LABEL[category]}
              </option>
            ))}
          </select>
          <p className="note mt-1">Guessed from what the statement says. Money in is private to whoever it came to, and a refund is the household’s.</p>
        </>
      )}
      {row.decision === 'create' && !row.moneyIn && reads.length > 0 && (
        <>
          <label className="label mt-1.5 block" htmlFor={`statement-category-${String(row.index)}`}>
            Category
          </label>
          <select
            id={`statement-category-${String(row.index)}`}
            className="field mt-1"
            aria-describedby={`statement-row-${String(row.index)}`}
            value={categoryOf(row.index) ?? ''}
            onChange={(event) => {
              const next = event.target.value;
              setChosen((was) => new Map(was).set(row.index, next));
            }}
          >
            <option value="">No category</option>
            {(reads[0]?.categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {(() => {
            // It says it is a suggestion, and what it rests on, only while it is still the suggestion: a category the person chose is theirs.
            const at = flat[row.index];
            const suggestion = at === undefined ? null : (reads[at.statement]?.suggestions[at.local] ?? null);
            const named = suggestion === null ? undefined : reads[0]?.categories.find((category) => category.id === suggestion.categoryId);
            return suggestion !== null && named !== undefined && categoryOf(row.index) === suggestion.categoryId ? (
              <p className="note mt-1" data-testid="statement-suggestion">
                {suggestionWords(suggestion, named.name)}
              </p>
            ) : null;
          })()}
        </>
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
          ready: everyFileRead && !blocked && !gpayWithOthers,
          content: (
            <>
              <p className="note">
                Choose a bank, card or Google Pay statement, or several bank statements to read together, so that a move between your own accounts is not counted as spending and as income. They are read on this device: nothing is uploaded, and the files, their names and their passwords are not kept.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="label" htmlFor="statement-file">
                  {files.length > 1 ? 'Statements' : 'Statement'}
                </label>
                <input
                  id="statement-file"
                  className="field"
                  type="file"
                  multiple
                  accept=".pdf,.txt,.csv,.qif,application/pdf,text/plain"
                  disabled={reading || busy}
                  onChange={choose}
                />
              </div>

              {waiting !== null && files[waiting] !== undefined && (
                <div className="flex flex-col gap-2">
                  <PasswordField
                    label={files.length > 1 ? `Password for ${files[waiting]?.name ?? 'this PDF'}` : 'Password for this PDF'}
                    value={password}
                    autoComplete="off"
                    onChange={(event) => {
                      setPassword(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void readFrom(files, waiting, password, reads);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-quiet self-start"
                    disabled={reading || password === ''}
                    onClick={() => {
                      void readFrom(files, waiting, password, reads);
                    }}
                  >
                    Open it
                  </button>
                </div>
              )}

              {reading && (
                <p className="note" role="status">
                  {files.length > 1 ? 'Reading the statements…' : 'Reading the statement…'}
                </p>
              )}
              {problem !== null && <Problem>{problem}</Problem>}

              {reads.map((read, at) => (
                <p key={at} className="note" role="status" data-testid="statement-read">
                  Read {String(read.statement.lines.length)} {read.statement.lines.length === 1 ? 'line' : 'lines'} from {KIND_WORDS[read.statement.kind]}
                  {read.statement.last4 === null ? '' : ` of ••${read.statement.last4}`}.
                </p>
              ))}
              {gpayWithOthers && (
                <Problem>
                  Read a Google Pay statement on its own, after the bank statements it adds to. It adds to payments that are already entries, and what is imported in this same go is not there yet.
                </Problem>
              )}
              {reads.map((read, at) =>
                read.statement.problems.length === 0 ? null : (
                  <div key={at} data-testid="statement-problems">
                    <Problem>
                      {many ? `${statementName(at)} does not add up` : 'This statement does not add up'}, so nothing can be imported from it. A line may have been misread, and a misread line is worse than a missing one.
                    </Problem>
                    <ul className="note mt-1.5 list-disc pl-5">
                      {read.statement.problems.slice(0, PROBLEMS_SHOWN).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    {read.statement.problems.length > PROBLEMS_SHOWN && <p className="note mt-1">and {String(read.statement.problems.length - PROBLEMS_SHOWN)} more.</p>}
                  </div>
                ),
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
          ready: canCommit,
          content:
            reads.length === 0 || plan === null ? (
              <p className="note">Choose a statement first.</p>
            ) : (
              <>
                <p className="note" data-testid="statement-summary">
                  {String(plan.counts.create)} to add as expenses
                  {plan.counts.credit > 0 ? ` · ${String(plan.counts.credit)} to add as money in` : ''}
                  {plan.counts.move > 0 ? ` · ${String(plan.counts.move)} to add as ${plan.counts.move === 1 ? 'a move' : 'moves'} between your accounts` : ''} · {String(plan.counts.witness)} added to entries you already have · {String(plan.counts.skip)} left out
                  {plan.counts.undecided > 0 ? ` · ${String(plan.counts.undecided)} need your answer` : ''}
                </p>
                <p className="note">Change anything here before it is written. Money in is added as money in, a move between two of your own accounts is added as a move, and a line that is not spending, such as a card repayment, is left out and says why.</p>

                {accountsToAdd.length > 0 && (
                  <div data-testid="statement-accounts">
                    <h3 className="label">Accounts that will be added</h3>
                    <ul className="note mt-1 list-disc pl-5">
                      {accountsToAdd.map((account) => (
                        <li key={account.last4}>
                          {account.institution ?? 'Account'} ••{account.last4} ({account.type === 'card' ? 'a card' : 'a savings account'})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {reads.map((read, at) => {
                  const balances = balancesOf(read, at);
                  const notes = notesOf(read);
                  const onItsDate = cycleOf(read) === 'statement';
                  if (balances.length === 0 && notes.length === 0) return null;
                  const amount = (minor: bigint): string => (read.statement.accountType === 'card' && minor < 0n ? `${show(-minor)} in credit` : show(minor));
                  return (
                    <div key={at} data-testid="statement-balances">
                      {balances.length > 0 && (
                        <>
                          <h3 className="label">
                            {read.statement.accountType === 'card'
                              ? onItsDate
                                ? 'What the statement says is due, and what was due before its cycle'
                                : 'What the statement says is due at a month end'
                              : 'Balances the statement states at a month end'}{' '}
                            for ••{read.statement.last4}
                          </h3>
                          <ul className="note mt-1 list-disc pl-5">
                            {balances.map((stated) => (
                              <li key={stated.asAt}>
                                {formatShortDate(stated.asAt)}: {amount(stated.balanceMinor)}
                                {stated.basis === 'opening' && onItsDate ? ' (due when its cycle began)' : ''}
                              </li>
                            ))}
                          </ul>
                          <p className="note mt-1">
                            {onItsDate
                              ? 'A card that closes on its statement date is closed by its statement: the month its date falls in takes this cycle, and the close reads these two figures.'
                              : 'The month close reads a balance on the last day of a month, and prefers one from a statement to one typed for the same day. A balance on any other day is not recorded.'}
                          </p>
                        </>
                      )}
                      {notes.map((note) => (
                        <p key={note.kind + note.asAt} className="note mt-1" data-testid="statement-card-note">
                          {cardNoteWords(note, { amount, date: formatShortDate, month: (day) => monthWord(day.slice(0, 7)) })}
                        </p>
                      ))}
                      {canSwitch(read) && read.statement.last4 !== null && (
                        <>
                          <button
                            type="button"
                            className="btn btn-quiet mt-1.5 self-start"
                            onClick={() => {
                              const last4 = read.statement.last4 ?? '';
                              setStatementDateFor((was) => {
                                const next = new Set(was);
                                if (next.has(last4)) next.delete(last4);
                                else next.add(last4);
                                return next;
                              });
                            }}
                          >
                            {switched(read) ? 'This card will close on its statement date. Undo' : 'Use the statement date for this card'}
                          </button>
                          {switched(read) && (
                            <p className="note mt-1" data-testid="statement-cycle-set">
                              When you import, this card is set to close on its statement date. It applies to every month.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

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
                  <p className="note">This is for expenses and refunds. Other money in stays private to whoever it came to.</p>
                  {plan.counts.move > 0 && <p className="note">A move between your accounts has no choice here: it is seen by everyone who can see both accounts.</p>}
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

                {blockedMoneyIn > 0 && (
                  <Problem>
                    Money in is private to whoever it came to, so it can be added only under your own name. Choose yourself under Whose they are, or leave the money in out.
                  </Problem>
                )}

                {plan.nothingToWrite && (
                  <p className="note" role="status" data-testid="statement-nothing">
                    Everything in this statement is already here or left out, so there is nothing to import.
                  </p>
                )}

                {(['decide', 'guess', 'add', 'merge'] as const).map((group) =>
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
          ready: /^\d{6}$/.test(code.trim()) && canCommit,
          content: (
            <>
              <RequiredKey />
              <p className="note">
                {plan === null ? '' : `This writes ${String(plan.counts.create)} ${plan.counts.create === 1 ? 'expense' : 'expenses'}`}
                {plan !== null && plan.counts.credit > 0 ? `, ${String(plan.counts.credit)} money in` : ''}
                {plan !== null && plan.counts.move > 0 ? `, and ${String(plan.counts.move)} ${plan.counts.move === 1 ? 'move' : 'moves'} between your own accounts` : ''}
                {plan !== null && plan.counts.witness > 0 ? ` and adds ${many ? 'these statements' : 'this statement'} to ${String(plan.counts.witness)} you already have` : ''}
                {statementDateFor.size > 0 ? `, and sets ${[...statementDateFor].map((last4) => `••${last4}`).join(', ')} to close on its statement date, for every month` : ''}
                {plan === null ? '' : `. Nothing is doubled if ${many ? 'the same statements are' : 'the same statement is'} imported again.`}
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

