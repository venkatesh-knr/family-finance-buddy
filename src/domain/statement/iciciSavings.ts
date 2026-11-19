/**
 * ICICI's savings statement as a PDF (docs/build-plan.md step 7).
 *
 * Each transaction is printed as three things: a payee line above it, its own row (serial number, date, one amount, balance), and its narration wrapped beneath. The amount
 * is in the Withdrawal column or in the Deposit column and nothing else says which, so the column is read from where the amount sits against the header's, and the running balance
 * then checks the whole reading. Pure: rows with their columns in, a `ParsedStatement` out.
 */

import { balanceChainProblems, describeNarration, last4Of, parseAmount, parseDate, type ParsedStatement, type StatementLine } from './common.ts';
import { rowText, type PdfPage, type PdfRow } from './pdfRows.ts';

/** Where the amounts start: nothing left of this is an amount, and the cheque number column is. */
const AMOUNTS_FROM = 380;

const DATE = /^\d{2}\.\d{2}\.\d{4}$/;
/** The legend of abbreviations at the foot of a page opens with INFT, and nothing after it is a transaction's. A narration may begin NEFT or IMPS, so those words do not end the table. */
const LEGEND = /^(INFT - |www\.icici|Please call|Never share)/;

const isTransaction = (row: PdfRow): boolean => /^\d+$/.test(row.cells[0]?.text ?? '') && DATE.test(row.cells[1]?.text ?? '');
const isHeaderEnd = (row: PdfRow): boolean => /^Date\b/.test(rowText(row)) && /Amount \(INR\)/.test(rowText(row));

function notThis(why: string): ParsedStatement {
  return { kind: 'icici_savings_pdf', accountType: 'bank', last4: null, periodStart: null, periodEnd: null, lines: [], problems: [why] };
}

export function parseIciciSavings(pages: readonly PdfPage[]): ParsedStatement {
  const title = pages.flatMap((page) => page.rows).map(rowText).find((line) => /Statement of Transactions in Account no/i.test(line));
  const hasTable = pages.some((page) => page.rows.some(isHeaderEnd));
  if (title === undefined || !hasTable) return notThis('This is not an ICICI savings statement: there is no "Statement of Transactions" title and transaction table.');

  const account = /Account no\.?\s*(\S+)/i.exec(title);
  const period = /for the period\s+([A-Za-z]+ \d{1,2}, \d{4})\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})/i.exec(title);

  const lines: StatementLine[] = [];
  const problems: string[] = [];
  /** Where a withdrawal ends and a deposit begins, from the header's two columns; kept from page to page, since a page repeats the header. */
  let boundary: number | null = null;

  for (const page of pages) {
    const headerRow = page.rows.find((row) => row.cells.some((c) => c.text === 'Withdrawal') && row.cells.some((c) => c.text === 'Deposit'));
    if (headerRow !== undefined) {
      const w = headerRow.cells.find((c) => c.text === 'Withdrawal')?.right ?? 0;
      const d = headerRow.cells.find((c) => c.text === 'Deposit')?.right ?? 0;
      boundary = (w + d) / 2;
    }
    const start = page.rows.findIndex(isHeaderEnd);
    if (start < 0) continue;
    const body = page.rows.slice(start + 1);
    const end = body.findIndex((row) => LEGEND.test(rowText(row)));
    const table = end < 0 ? body : body.slice(0, end);
    const at = table.flatMap((row, index) => (isTransaction(row) ? [index] : []));

    at.forEach((index, k) => {
      const next = at[k + 1];
      const row = table[index] as PdfRow;
      const between = table.slice(index + 1, next ?? table.length);
      // The last line before the next transaction is that transaction's payee line, not this one's narration.
      const narrationRows = next === undefined ? between : between.slice(0, -1);
      const payeeRow = index > 0 && !isTransaction(table[index - 1] as PdfRow) && (k === 0 || index - 1 > (at[k - 1] ?? -1)) ? table[index - 1] : undefined;

      const number = `transaction ${String(lines.length + problems.length + 1)}`;
      const date = parseDate(row.cells[1]?.text ?? '', 'dmy');
      const amounts = row.cells.slice(2).filter((c) => c.right > AMOUNTS_FROM);
      const reference = row.cells.slice(2).find((c) => c.right <= AMOUNTS_FROM)?.text.trim() ?? '';
      if (date === null || amounts.length !== 2 || boundary === null) {
        problems.push(`${number}: its date, amount and balance could not be read.`);
        return;
      }
      const amountCell = amounts[0];
      const amount = parseAmount(amountCell?.text ?? '');
      const balance = parseAmount(amounts[1]?.text ?? '');
      if (amountCell === undefined || amount === null || balance === null) {
        problems.push(`${number}: an amount is not a figure.`);
        return;
      }
      const raw = narrationRows.map(rowText).join('');
      const about = describeNarration(raw);
      lines.push({
        date,
        valueDate: null,
        direction: amountCell.right < boundary ? 'debit' : 'credit',
        amountMinor: amount,
        raw,
        payee: about.payee ?? (payeeRow === undefined ? null : rowText(payeeRow) || null),
        upiReference: about.upiReference,
        reference: reference === '' ? null : reference,
        balanceMinor: balance,
        hint: about.hint,
      });
    });
  }

  return {
    kind: 'icici_savings_pdf',
    accountType: 'bank',
    last4: account === null ? null : last4Of(account[1] ?? ''),
    periodStart: period === null ? null : parseDate(period[1] ?? '', 'MonDY'),
    periodEnd: period === null ? null : parseDate(period[2] ?? '', 'MonDY'),
    lines,
    problems: [...problems, ...balanceChainProblems(lines)],
  };
}
