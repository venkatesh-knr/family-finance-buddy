/**
 * Google Pay's transaction statement as a PDF (docs/build-plan.md step 7a; docs/design/spending-capture.md sections 3 and 4).
 *
 * A payment is three rows: the date, who was paid and the amount; the time and the UPI transaction id; and *Paid by ICICI Bank 4321*, the account it came from by its last four. The
 * statement is not of one account, so each line carries its own. What it adds to a bank's statement is a readable payee name and the UPI reference that lets the two be matched; a
 * transfer between the household's own accounts says so in words and is marked, because it is not spending. The statement's own *Sent* and *Received* totals check the reading, as
 * a card's summary does. Pure: rows in, a `ParsedStatement` out.
 */

import { formatMoney, money } from '../../lib/money.ts';
import { last4Of, parseAmount, parseDate, type ParsedStatement, type StatementLine } from './common.ts';
import { rowText, type PdfPage, type PdfRow } from './pdfRows.ts';

const DATE = /^\d{2} [A-Za-z]{3}, \d{4}$/;
const KIND = /^(Paid to|Self transfer to|Received from)\s+/;

const isPayment = (row: PdfRow): boolean => DATE.test(row.cells[0]?.text ?? '') && KIND.test(row.cells[1]?.text ?? '');

function notThis(why: string): ParsedStatement {
  return { kind: 'gpay_pdf', accountType: 'bank', last4: null, periodStart: null, periodEnd: null, lines: [], problems: [why] };
}

export function parseGpay(pages: readonly PdfPage[]): ParsedStatement {
  const rows = pages.flatMap((page) => page.rows);
  const label = rows.findIndex((row) => /^Transaction statement period/.test(rowText(row)));
  if (label < 0) return notThis('This is not a Google Pay statement: there is no "Transaction statement period" heading.');

  const periodRow = rows[label + 1];
  const [from = '', to = ''] = (periodRow?.cells[0]?.text ?? '').split(' - ');
  const sent = parseAmount(periodRow?.cells[1]?.text ?? '');
  const received = parseAmount(periodRow?.cells[2]?.text ?? '');

  const lines: StatementLine[] = [];
  const problems: string[] = [];
  rows.forEach((row, index) => {
    if (!isPayment(row)) return;
    const number = `payment ${String(lines.length + problems.length + 1)}`;
    const date = parseDate(row.cells[0]?.text ?? '', 'dMonY');
    const details = row.cells[1]?.text ?? '';
    const amount = parseAmount(row.cells[row.cells.length - 1]?.text ?? '');
    if (date === null || amount === null || row.cells.length < 3) {
      problems.push(`${number}: its date or amount could not be read.`);
      return;
    }

    // The next rows, up to the next payment: the time and the transaction id, then the account.
    let reference: string | null = null;
    let from4: string | null = null;
    for (const next of rows.slice(index + 1, index + 4)) {
      if (isPayment(next)) break;
      const text = rowText(next);
      const id = /UPI Transaction ID:\s*(\d{12})\b/.exec(text);
      if (id !== null) reference = id[1] ?? null;
      const account = /^(?:Paid by|Credited to|Received in)\s+.*?(\d{4})$/.exec(text);
      if (account !== null) from4 = account[1] ?? null;
    }

    const kind = KIND.exec(details)?.[1] ?? '';
    const self = kind === 'Self transfer to';
    lines.push({
      date,
      valueDate: null,
      direction: kind === 'Received from' ? 'credit' : 'debit',
      amountMinor: amount,
      raw: details,
      payee: self ? null : details.replace(KIND, '').trim() || null,
      upiReference: reference,
      reference: null,
      balanceMinor: null,
      hint: null,
      fromLast4: from4,
      ...(self ? { selfTransferToLast4: last4Of(details) } : {}),
    });
  });

  const spent = lines.filter((line) => line.direction === 'debit' && line.selfTransferToLast4 === undefined).reduce((total, line) => total + line.amountMinor, 0n);
  const credited = lines.filter((line) => line.direction === 'credit').reduce((total, line) => total + line.amountMinor, 0n);
  const totals: string[] = [];
  if (sent !== null && sent !== spent) totals.push(`The payments add up to ${formatMoney(money(spent, 'INR'))}, and the statement says ${formatMoney(money(sent, 'INR'))} was sent.`);
  if (received !== null && received !== credited) totals.push(`The money received adds up to ${formatMoney(money(credited, 'INR'))}, and the statement says ${formatMoney(money(received, 'INR'))} was received.`);

  return {
    kind: 'gpay_pdf',
    accountType: 'bank',
    last4: null,
    periodStart: parseDate(from, 'dMonY'),
    periodEnd: parseDate(to, 'dMonY'),
    lines,
    problems: [...problems, ...totals],
  };
}
