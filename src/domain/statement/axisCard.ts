/**
 * Axis Bank's credit card statement as a PDF (docs/build-plan.md step 7).
 *
 * A transaction is a row of date, details, an optional merchant category and an amount with `Dr` or `Cr` after it. The category is the statement's own word for the kind of spend
 * (`RESTAURANTS`, `FUEL`) and is kept as a hint for a suggestion, never as a category. The summary gives the previous balance, payments, credits, purchases, cash advances and other
 * debits; the lines are checked against it. Pure: rows in, a `ParsedStatement` out.
 */

import { cardTotalsProblems, last4Of, parseAmount, parseDate, type ParsedStatement, type StatementLine } from './common.ts';
import { rowText, type PdfPage, type PdfRow } from './pdfRows.ts';

const AMOUNT_DR_CR = /^([\d,]+\.\d{2})\s*(Dr|Cr)$/i;

const isTransaction = (row: PdfRow): boolean => /^\d{2}\/\d{2}\/\d{4}$/.test(row.cells[0]?.text ?? '') && AMOUNT_DR_CR.test(row.cells[row.cells.length - 1]?.text ?? '');

function notThis(why: string): ParsedStatement {
  return { kind: 'axis_card_pdf', accountType: 'card', last4: null, periodStart: null, periodEnd: null, lines: [], problems: [why] };
}

export function parseAxisCard(pages: readonly PdfPage[]): ParsedStatement {
  const all = pages.flatMap((page) => page.rows);
  if (!all.some((row) => /Axis Bank.*Credit Card/i.test(rowText(row)))) return notThis('This is not an Axis credit card statement: it does not name an Axis Bank credit card.');

  // Only the table: it ends at the end-of-statement line.
  const end = all.findIndex((row) => /End of Statement/i.test(rowText(row)));
  const rows = end < 0 ? all : all.slice(0, end);

  const periodRow = rows.find((row) => /^\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}$/.test(row.cells[0]?.text ?? '') || row.cells.some((c) => /^\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}$/.test(c.text)));
  const periodCell = periodRow?.cells.find((c) => /^\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}$/.test(c.text));
  const [from = '', to = ''] = (periodCell?.text ?? '').split(' - ');
  // The due date and then the statement's generation date: the single dates beside the period.
  const dates = periodRow === undefined ? [] : periodRow.cells.filter((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c.text));
  const cardNumber = rows.flatMap((row) => row.cells).find((c) => /^\d{6}\*+\d{4}$/.test(c.text));

  // Previous balance, payments, credits, purchases, cash advances, other debits and charges, then what is due: seven figures in one row, the first with Dr or Cr after it.
  const figures = (row: PdfRow): bigint[] => row.cells.map((c) => parseAmount(c.text.replace(/\s*(Dr|Cr)$/i, ''))).filter((amount): amount is bigint => amount !== null);
  const summaryRow = rows.find((row) => AMOUNT_DR_CR.test(row.cells[0]?.text ?? '') && figures(row).length >= 7);
  const summary = summaryRow === undefined ? undefined : figures(summaryRow);
  const [previous, payments, credits, purchases, cashAdvances, otherDebits, totalDue] = summary ?? [];
  const signOf = (text: string | undefined): bigint => (/Cr$/i.test(text ?? '') ? -1n : 1n);
  const dueSign = summaryRow === undefined ? 1n : signOf(summaryRow.cells[summaryRow.cells.length - 1]?.text);
  const previousSign = signOf(summaryRow?.cells[0]?.text);

  const lines: StatementLine[] = [];
  const problems: string[] = [];
  for (const row of rows) {
    if (!isTransaction(row)) continue;
    const number = `transaction ${String(lines.length + problems.length + 1)}`;
    const date = parseDate(row.cells[0]?.text ?? '', 'dmy');
    const match = AMOUNT_DR_CR.exec(row.cells[row.cells.length - 1]?.text ?? '');
    const amount = parseAmount(match?.[1] ?? '');
    if (date === null || match === null || amount === null) {
      problems.push(`${number}: its date or amount could not be read.`);
      continue;
    }
    const details = row.cells[1]?.text ?? '';
    const category = row.cells.length >= 4 ? (row.cells[2]?.text ?? '') : '';
    lines.push({
      date,
      valueDate: null,
      direction: /^Cr$/i.test(match[2] ?? '') ? 'credit' : 'debit',
      amountMinor: amount,
      raw: details,
      // A merchant is printed as `NAME,CITY`; the name is the payee. A line with no category is a payment or a credit, which has no payee.
      payee: category === '' ? null : details.split(',')[0]?.trim() || null,
      upiReference: null,
      reference: null,
      balanceMinor: null,
      hint: category === '' ? null : category,
    });
  }

  const complete = [previous, payments, credits, purchases, cashAdvances, otherDebits, totalDue].every((value) => value !== undefined);
  const totals = !complete
    ? ['The summary at the head of the statement could not be read, so its lines could not be checked against it.']
    : cardTotalsProblems(lines, { charges: (purchases ?? 0n) + (cashAdvances ?? 0n) + (otherDebits ?? 0n), credits: (payments ?? 0n) + (credits ?? 0n) });

  return {
    kind: 'axis_card_pdf',
    accountType: 'card',
    last4: cardNumber === undefined ? null : last4Of(cardNumber.text),
    periodStart: parseDate(from, 'dmy'),
    periodEnd: parseDate(to, 'dmy'),
    ...(!complete || previous === undefined || totalDue === undefined
      ? {}
      : {
          card: {
            statementDate: parseDate(dates[1]?.text ?? '', 'dmy') ?? parseDate(to, 'dmy'),
            paymentDueDate: parseDate(dates[0]?.text ?? '', 'dmy'),
            previousBalanceMinor: previousSign * previous,
            totalDueMinor: dueSign * totalDue,
          },
        }),
    lines,
    problems: [...problems, ...totals],
  };
}
