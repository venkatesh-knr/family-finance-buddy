/**
 * The plain-text statements of a bank (docs/build-plan.md step 7): HDFC's delimited file, HDFC's printed statement as text, and QIF.
 *
 * Pure: the file's text in, a `ParsedStatement` out. A line that cannot be read is named by its row in `problems` and never dropped silently, and the rest are still read;
 * whether a statement with problems may be imported is the importer's decision, not this module's. Nothing of an account is kept but its last four digits.
 */

import { balanceChainProblems, describeNarration, last4Of, parseAmount, parseDate, type DateStyle, type ParsedStatement, type StatementLine } from './common.ts';

const rows = (text: string): string[] => text.split(/\r?\n/);

const notThis = (kind: ParsedStatement['kind'], accountType: ParsedStatement['accountType'], why: string): ParsedStatement => ({
  kind,
  accountType,
  last4: null,
  periodStart: null,
  periodEnd: null,
  lines: [],
  problems: [why],
});

/** A figure column that is blank or zero is no figure. */
function figure(text: string): { readonly minor: bigint | null; readonly blank: boolean } {
  const trimmed = text.trim();
  if (trimmed === '') return { minor: 0n, blank: true };
  return { minor: parseAmount(trimmed), blank: false };
}

/** The line from what the columns held: which way it went is the column that has a figure, and a figure in both or in neither is a problem and not a guess. */
function toLine(input: {
  readonly date: string;
  readonly valueDate: string;
  readonly narration: string;
  readonly reference: string;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
  readonly at: string;
  readonly dateStyle: DateStyle;
}): StatementLine | string {
  const date = parseDate(input.date, input.dateStyle);
  if (date === null) return `${input.at}: the date "${input.date}" is not a date.`;
  const debit = figure(input.debit);
  const credit = figure(input.credit);
  if (debit.minor === null || credit.minor === null) return `${input.at}: an amount is not a figure.`;
  if ((debit.minor > 0n) === (credit.minor > 0n)) return `${input.at}: a figure is in both the debit and credit columns, or in neither.`;
  const balance = input.balance.trim() === '' ? null : parseAmount(input.balance);
  const about = describeNarration(input.narration);
  return {
    date,
    valueDate: input.valueDate.trim() === '' ? null : parseDate(input.valueDate, input.dateStyle),
    direction: debit.minor > 0n ? 'debit' : 'credit',
    amountMinor: debit.minor > 0n ? debit.minor : credit.minor,
    raw: input.narration,
    payee: about.payee,
    upiReference: about.upiReference,
    reference: input.reference.trim() === '' ? null : input.reference.trim(),
    balanceMinor: balance,
    hint: about.hint,
  };
}

// ── HDFC, delimited ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `Date ,Narration ,Value Dat,Debit Amount ,Credit Amount ,Chq/Ref Number` and, in the file as the bank writes it today, `,Closing Balance`, padded with spaces. The header says which. A
 * narration can hold a comma, so the columns after it are read from the right and the narration is what is left. The file states no period and no account number.
 */
export function parseHdfcDelimited(text: string): ParsedStatement {
  const all = rows(text);
  const header = all.findIndex((line) => /Date\s*,\s*Narration/i.test(line));
  if (header < 0) return notThis('hdfc_delimited', 'bank', 'This is not an HDFC delimited statement: there is no Date, Narration header row.');

  // The columns after the narration, from the right: with a balance there are five (value date, debit, credit, reference, balance), without one four.
  const withBalance = /Closing\s*Balance/i.test(all[header] ?? '');
  const tail = withBalance ? 5 : 4;
  const lines: StatementLine[] = [];
  const problems: string[] = [];
  let row = 0;
  for (const line of all.slice(header + 1)) {
    if (line.trim() === '') continue;
    row += 1;
    const parts = line.split(',');
    if (parts.length < tail + 2) {
      problems.push(`row ${String(row)}: expected ${String(tail + 2)} columns and found ${String(parts.length)}.`);
      continue;
    }
    const n = parts.length;
    const made = toLine({
      date: parts[0] ?? '',
      valueDate: parts[n - tail] ?? '',
      narration: parts.slice(1, n - tail).join(',').trim(),
      reference: parts[withBalance ? n - 2 : n - 1] ?? '',
      debit: parts[n - tail + 1] ?? '',
      credit: parts[n - tail + 2] ?? '',
      balance: withBalance ? (parts[n - 1] ?? '') : '',
      at: `row ${String(row)}`,
      dateStyle: 'dmy',
    });
    if (typeof made === 'string') problems.push(made);
    else lines.push(made);
  }
  return { kind: 'hdfc_delimited', accountType: 'bank', last4: null, periodStart: null, periodEnd: null, lines, problems: [...problems, ...balanceChainProblems(lines)] };
}

// ── HDFC, the printed statement as text ─────────────────────────────────────────────────────────────────────────

/**
 * The printed statement. Its columns are the runs of dashes the statement draws under its header, so they are read at those widths. A narration that wrapped is carried on in the
 * next row with nothing else in it, and is joined without a space: the statement cuts a word where the column ends, and a space put back would break a UPI narration.
 */
export function parseHdfcText(text: string): ParsedStatement {
  const all = rows(text);
  const header = all.findIndex((line) => /Narration/.test(line) && /Withdrawal/.test(line));
  const rule = header < 0 ? -1 : all.findIndex((line, i) => i > header && /^-+(\s+-+)+\s*$/.test(line));
  if (header < 0 || rule < 0) return notThis('hdfc_text', 'bank', 'This is not an HDFC statement: there is no table with Narration and Withdrawal columns.');

  const columns = [...(all[rule] ?? '').matchAll(/-+/g)].map((match) => [match.index, match.index + match[0].length] as const);
  if (columns.length < 7) return notThis('hdfc_text', 'bank', 'This is not an HDFC statement: its table has fewer than seven columns.');

  const head = all.slice(0, header).join('\n');
  const account = /Account No\s*:\s*(\S+)/.exec(head);
  const period = /Statement From\s*:\s*(\d{2}\/\d{2}\/\d{4})\s+To:\s*(\d{2}\/\d{2}\/\d{4})/.exec(head);

  interface Pending {
    date: string;
    narration: string;
    reference: string;
    valueDate: string;
    debit: string;
    credit: string;
    balance: string;
    at: string;
  }
  const lines: StatementLine[] = [];
  const problems: string[] = [];
  let pending: Pending | null = null;
  let count = 0;
  const finish = (): void => {
    if (pending === null) return;
    const made = toLine({ ...pending, dateStyle: 'dmy' });
    if (typeof made === 'string') problems.push(made);
    else lines.push(made);
    pending = null;
  };

  for (const line of all.slice(rule + 1)) {
    if (line.trimStart().startsWith('*')) break;
    if (line.trim() === '') continue;
    const cells = columns.map(([from, to]) => line.slice(from, to).trim());
    if (/^\d{2}\/\d{2}\/\d{2}$/.test(cells[0] ?? '')) {
      finish();
      count += 1;
      pending = {
        date: cells[0] ?? '',
        narration: cells[1] ?? '',
        reference: cells[2] ?? '',
        valueDate: cells[3] ?? '',
        debit: cells[4] ?? '',
        credit: cells[5] ?? '',
        balance: cells[6] ?? '',
        at: `transaction ${String(count)}`,
      };
    } else if (pending !== null && (cells[0] ?? '') === '') {
      pending.narration += cells[1] ?? '';
      pending.reference += cells[2] ?? '';
    }
  }
  finish();

  return {
    kind: 'hdfc_text',
    accountType: 'bank',
    last4: account === null ? null : last4Of(account[1] ?? ''),
    periodStart: period === null ? null : parseDate(period[1] ?? '', 'dmy'),
    periodEnd: period === null ? null : parseDate(period[2] ?? '', 'dmy'),
    lines,
    problems: [...problems, ...balanceChainProblems(lines)],
  };
}

// ── QIF ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Quicken's interchange format: `!Type:Bank`, then records of one letter and a value a line, closed by `^`. HDFC writes the date month first; a file whose dates cannot be month
 * first (a day above twelve in the first place) is read day first. A negative figure is money out. The memo is not read: it holds the time of day and nothing a match needs.
 */
export function parseQif(text: string): ParsedStatement {
  const all = rows(text).map((line) => line.trim());
  const first = all.find((line) => line !== '') ?? '';
  const type = /^!Type:(\w+)/i.exec(first);
  if (type === null) return notThis('qif', 'bank', 'This is not a QIF file: it does not begin with a !Type line.');
  const accountType: ParsedStatement['accountType'] = /^ccard$/i.test(type[1] ?? '') ? 'card' : 'bank';

  type Record_ = Partial<Record<'D' | 'T' | 'N' | 'P', string>>;
  const records: Record_[] = [];
  let current: Record_ = {};
  for (const line of all.slice(all.indexOf(first) + 1)) {
    if (line === '^') {
      records.push(current);
      current = {};
    } else if (/^[DTNP]/.test(line)) {
      current[line[0] as 'D' | 'T' | 'N' | 'P'] = line.slice(1);
    }
  }

  const dayFirst = records.some((record) => {
    const lead = /^(\d{1,2})[-/.]/.exec(record.D ?? '');
    return lead !== null && Number(lead[1]) > 12;
  });
  const lines: StatementLine[] = [];
  const problems: string[] = [];
  records.forEach((record, index) => {
    const at = `record ${String(index + 1)}`;
    const date = parseDate(record.D ?? '', dayFirst ? 'dmy' : 'mdy');
    if (date === null) {
      problems.push(`${at}: the date "${record.D ?? ''}" is not a date.`);
      return;
    }
    const signed = (record.T ?? '').trim();
    const amount = parseAmount(signed.replace(/^[-+]/, ''));
    if (amount === null || amount === 0n) {
      problems.push(`${at}: the amount "${signed}" is not a figure.`);
      return;
    }
    const narration = (record.P ?? '').trim();
    const about = describeNarration(narration);
    lines.push({
      date,
      valueDate: null,
      direction: signed.startsWith('-') ? 'debit' : 'credit',
      amountMinor: amount,
      raw: narration,
      payee: about.payee,
      upiReference: about.upiReference,
      reference: (record.N ?? '').trim() === '' ? null : (record.N ?? '').trim(),
      balanceMinor: null,
      hint: about.hint,
    });
  });
  return { kind: 'qif', accountType, last4: null, periodStart: null, periodEnd: null, lines, problems };
}
