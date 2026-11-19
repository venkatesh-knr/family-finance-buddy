import { describe, expect, it } from 'vitest';
import { parseGpay } from './gpay.ts';
import type { PdfCell, PdfPage, PdfRow } from './pdfRows.ts';

/**
 * Google Pay's transaction statement as a PDF (docs/build-plan.md step 7a; docs/design/spending-capture.md sections 3 and 4). A payment is three rows: the date, who was paid and the
 * amount; the time and the UPI transaction id; and the account it was paid from. The fixtures are synthetic rows in that layout.
 */
const cell = (x: number, text: string): PdfCell => ({ x, right: x + text.length * 5, text });
const row = (...cells: [number, string][]): PdfRow => ({ cells: cells.map(([x, text]) => cell(x, text)) });

const NOTE = row([20, 'Note: This statement reflects payments made by you on the Google Pay app. Self transfer payments are not included in the total money paid and']);
const HEAD = [
  row([20, 'Transaction statement']),
  row([20, '9000000000, someone@example.com']),
  row([20, 'Transaction statement period'], [300, 'Sent'], [400, 'Received']),
];
const periodRow = (sent: string, received: string): PdfRow => row([20, '01 October 2026 - 31 October 2026'], [300, sent], [400, received]);
const COLUMNS = row([20, 'Date & time'], [150, 'Transaction details'], [450, 'Amount']);
const payment = (date: string, who: string, amount: string, time: string, id: string, from: string): PdfRow[] => [
  row([20, date], [150, who], [450, amount]),
  row([20, time], [150, `UPI Transaction ID: ${id}`]),
  row([20, `Paid by ${from}`]),
];

const PAGE: PdfPage = {
  rows: [
    ...HEAD,
    periodRow('₹1,230.50', '₹0'),
    COLUMNS,
    ...payment('01 Oct, 2026', 'Paid to SAMPLE CAFE', '₹224', '06:04 PM', '200000000002', 'ICICI Bank 4321'),
    ...payment('02 Oct, 2026', 'Paid to SAMPLE CLINIC', '₹1,006.50', '07:13 PM', '300000000003', 'HDFC Bank 1234'),
    ...payment('08 Oct, 2026', 'Self transfer to ICICI Bank 4321', '₹50,000', '09:00 AM', '400000000004', 'HDFC Bank 1234'),
    NOTE,
    row([20, 'Page 1 of 1']),
  ],
};

describe('Google Pay statement', () => {
  const out = parseGpay([PAGE]);

  it('reads a payment, its UPI transaction id and the account it was paid from', () => {
    expect(out.problems).toEqual([]);
    expect(out.lines[0]).toMatchObject({ date: '2026-10-01', direction: 'debit', amountMinor: 22_400n, payee: 'SAMPLE CAFE', upiReference: '200000000002', fromLast4: '4321' });
    expect(out.lines[1]).toMatchObject({ date: '2026-10-02', amountMinor: 100_650n, payee: 'SAMPLE CLINIC', upiReference: '300000000003', fromLast4: '1234' });
  });

  it('marks a transfer between the household’s own accounts, which is not spending, and names where it went', () => {
    expect(out.lines[2]).toMatchObject({ direction: 'debit', amountMinor: 5_000_000n, payee: null, selfTransferToLast4: '4321', fromLast4: '1234', upiReference: '400000000004' });
    expect(out.lines[0]?.selfTransferToLast4 ?? null).toBeNull();
  });

  it('is a UPI app’s statement, with the period it says, and no single account', () => {
    expect(out).toMatchObject({ kind: 'gpay_pdf', last4: null, periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  });

  it('checks that what was paid adds up to what it says was sent, leaving out transfers to oneself, as the statement does', () => {
    const wrong = parseGpay([{ rows: PAGE.rows.map((r) => (r.cells[1]?.text === '₹1,230.50' ? periodRow('₹9,999.00', '₹0') : r)) }]);
    expect(wrong.problems.some((problem) => /sent/i.test(problem))).toBe(true);
  });

  it('reads money received as a credit, and checks it against what the statement says was received', () => {
    const received: PdfPage = { rows: [...HEAD, periodRow('₹0', '₹500'), COLUMNS, ...payment('03 Oct, 2026', 'Received from SAMPLE PERSON', '₹500', '10:00 AM', '500000000005', 'ICICI Bank 4321')] };
    const result = parseGpay([received]);
    expect(result.problems).toEqual([]);
    expect(result.lines[0]).toMatchObject({ direction: 'credit', amountMinor: 50_000n, payee: 'SAMPLE PERSON', upiReference: '500000000005' });
  });

  it('carries a statement over pages, and ignores the note and the page number', () => {
    const page2: PdfPage = { rows: [row([20, 'Transaction statement']), COLUMNS, ...payment('11 Oct, 2026', 'Paid to SAMPLE SHOP', '₹5', '10:13 AM', '600000000006', 'ICICI Bank 4321'), NOTE] };
    const result = parseGpay([PAGE, page2]);
    expect(result.lines).toHaveLength(4);
    expect(result.lines[3]).toMatchObject({ payee: 'SAMPLE SHOP', amountMinor: 500n });
  });

  it('has no UPI reference for a payment that prints no transaction id, and does not invent one', () => {
    const noId: PdfPage = { rows: PAGE.rows.filter((r) => !/200000000002/.test(r.cells[1]?.text ?? '')) };
    expect(parseGpay([noId]).lines[0]?.upiReference).toBeNull();
  });

  it('refuses a file that is not this statement', () => {
    expect(parseGpay([{ rows: [row([20, 'hello'])] }]).problems[0]).toMatch(/not a Google Pay statement/i);
  });
});
