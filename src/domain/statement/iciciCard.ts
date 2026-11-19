/**
 * ICICI's credit card statement as a PDF (docs/build-plan.md step 7).
 *
 * A transaction is a row of date, serial number, details, reward points and an amount, with a `CR` after the amount for a credit and an international amount before it where there is
 * one. A line that carries an EMI marker (`<2/6>RAZ*...`) carries it on in the row beneath. The summary above gives the previous balance, purchases and charges, cash advances and
 * payments and credits; the lines are checked against it. Pure: rows in, a `ParsedStatement` out.
 */

import { cardTotalsProblems, last4Of, parseAmount, parseDate, type ParsedStatement, type StatementLine } from './common.ts';
import { rowText, type PdfPage, type PdfRow } from './pdfRows.ts';

const MONTH_DATE = /^[A-Z][a-z]+ \d{1,2}, \d{4}$/;

const isTransaction = (row: PdfRow): boolean => /^\d{2}\/\d{2}\/\d{4}$/.test(row.cells[0]?.text ?? '') && /^\d{8,}$/.test(row.cells[1]?.text ?? '');

function notThis(why: string): ParsedStatement {
  return { kind: 'icici_card_pdf', accountType: 'card', last4: null, periodStart: null, periodEnd: null, lines: [], problems: [why] };
}

/** The first date after a label that opens a row, as the statement prints it: *November 18, 2026*. Other text, such as a barcode, can sit between the two. */
function dateAfter(rows: readonly PdfRow[], label: string) {
  const at = rows.findIndex((row) => row.cells[0]?.text === label);
  if (at < 0) return null;
  for (const row of rows.slice(at + 1, at + 10)) {
    const first = row.cells[0]?.text ?? '';
    if (MONTH_DATE.test(first)) return parseDate(first, 'MonDY');
  }
  return null;
}

export function parseIciciCard(pages: readonly PdfPage[]): ParsedStatement {
  const rows = pages.flatMap((page) => page.rows);
  if (!rows.some((row) => /^CREDIT CARD STATEMENT/.test(rowText(row)))) return notThis('This is not an ICICI credit card statement: there is no "CREDIT CARD STATEMENT" heading.');

  const statementDate = dateAfter(rows, 'STATEMENT DATE');
  const paymentDueDate = dateAfter(rows, 'PAYMENT DUE DATE');
  const cardNumber = rows.flatMap((row) => row.cells).find((c) => /^\d{4}X+\d{4}$/.test(c.text));

  const labels = rows.findIndex((row) => row.cells.some((c) => c.text === 'Previous Balance') && row.cells.some((c) => /^Purchases/.test(c.text)));
  const summary =
    labels < 0
      ? null
      : rows
          .slice(labels + 1, labels + 6)
          .map((row) => row.cells.map((c) => parseAmount(c.text)).filter((amount): amount is bigint => amount !== null))
          .find((amounts) => amounts.length >= 4);
  const [previous, purchases, cashAdvances, payments] = summary ?? [];

  const lines: StatementLine[] = [];
  const problems: string[] = [];
  rows.forEach((row, index) => {
    if (!isTransaction(row)) return;
    const number = `transaction ${String(lines.length + problems.length + 1)}`;
    const date = parseDate(row.cells[0]?.text ?? '', 'dmy');
    const last = row.cells[row.cells.length - 1];
    // The amount is the last cell, with CR after it in the same cell or in one of its own.
    const credit = /\bCR$/i.test(last?.text ?? '');
    const amountCell = credit && /^CR$/i.test(last?.text ?? '') ? row.cells[row.cells.length - 2] : last;
    const amount = parseAmount((amountCell?.text ?? '').replace(/\s*CR$/i, ''));
    if (date === null || amount === null || row.cells.length < 4) {
      problems.push(`${number}: its date or amount could not be read.`);
      return;
    }
    const next = rows[index + 1];
    const marker = next !== undefined && (next.cells[0]?.text ?? '').startsWith('<') ? ` ${rowText(next)}` : '';
    lines.push({
      date,
      valueDate: null,
      direction: credit ? 'credit' : 'debit',
      amountMinor: amount,
      raw: `${row.cells[2]?.text ?? ''}${marker}`.trim(),
      payee: null,
      upiReference: null,
      reference: row.cells[1]?.text ?? null,
      balanceMinor: null,
      hint: null,
    });
  });

  const totals =
    previous === undefined || purchases === undefined || cashAdvances === undefined || payments === undefined
      ? ['The summary at the head of the statement could not be read, so its lines could not be checked against it.']
      : cardTotalsProblems(lines, { charges: purchases + cashAdvances, credits: payments });

  return {
    kind: 'icici_card_pdf',
    accountType: 'card',
    last4: cardNumber === undefined ? null : last4Of(cardNumber.text),
    periodStart: null,
    periodEnd: statementDate,
    ...(previous === undefined || purchases === undefined || cashAdvances === undefined || payments === undefined
      ? {}
      : { card: { statementDate, paymentDueDate, previousBalanceMinor: previous, totalDueMinor: previous + purchases + cashAdvances - payments } }),
    lines,
    problems: [...problems, ...totals],
  };
}
