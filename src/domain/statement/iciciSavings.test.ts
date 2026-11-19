import { describe, expect, it } from 'vitest';
import type { PdfCell, PdfPage, PdfRow } from './pdfRows.ts';
import { parseIciciSavings } from './iciciSavings.ts';

/**
 * ICICI's savings statement as a PDF (docs/build-plan.md step 7). The fixtures are synthetic rows with the columns' real positions: a payee line above each transaction, the
 * transaction's own row (serial, date, one amount in the Withdrawal or the Deposit column, the balance), and the narration wrapped beneath it.
 */
const cell = (x: number, right: number, text: string): PdfCell => ({ x, right, text });
const row = (...cells: PdfCell[]): PdfRow => ({ cells });
const text = (value: string, x = 247): PdfRow => row(cell(x, x + value.length * 5, value));

const HEADER: PdfRow[] = [
  row(cell(60, 108, 'Transaction'), cell(399, 447, 'Withdrawal'), cell(474, 504, 'Deposit'), cell(532, 564, 'Balance')),
  row(cell(24, 44, 'S No.'), cell(122, 186, 'Cheque Number'), cell(247, 332, 'Transaction Remarks')),
  row(cell(60, 80, 'Date'), cell(403, 447, 'Amount (INR)'), cell(460, 504, 'Amount (INR)'), cell(545, 564, '(INR)')),
];
const withdrawal = (n: number, date: string, amount: string, balance: string): PdfRow =>
  row(cell(30, 35, String(n)), cell(61, 104, date), cell(453 - amount.length * 5, 453, amount), cell(571 - balance.length * 5, 571, balance));
const deposit = (n: number, date: string, amount: string, balance: string): PdfRow =>
  row(cell(30, 35, String(n)), cell(61, 104, date), cell(510 - amount.length * 5, 510, amount), cell(571 - balance.length * 5, 571, balance));

const PAGE1: PdfPage = {
  rows: [
    text('1', 300),
    text('Statement of Transactions in Account no. 123456781234 in INR for the period October 1, 2026 - October 31, 2026', 30),
    text('Your Base Branch: SAMPLE BANK LIMITED,', 30),
    ...HEADER,
    text('SAMPLE CAFE'),
    withdrawal(1, '01.10.2026', '224.00', '19335.06'),
    text('UPI/SAMPLE CAFE/XXabcd@tmb/snacks/SAMPLE'),
    text('M/200000000002/ICI9bdaa52c986f4589bbd73a51'),
    text('6c1c76f0'),
    text('SAMPLE EMPLOYER'),
    deposit(2, '03.10.2026', '5000.00', '24335.06'),
    text('NEFT-SAMPLE EMPLOYER-SALARY'),
    text('SAMPLE VENDOR'),
    withdrawal(3, '04.10.2026', '1070.26', '23264.80'),
    text('UPI/SAMPLE VENDOR/XX7vtj@paytm/food/SAMPLE BAN'),
    text('K/300000000003/ICI4e545cfea2e14db2a1afdf7e11'),
    text('INFT - Internal Fund Transfer (Within ICICI Bank) | IMPS - Immediate Payment Service', 30),
  ],
};

describe('ICICI savings, the PDF', () => {
  const out = parseIciciSavings([PAGE1]);

  it('reads each transaction with the direction from the column its amount sits in', () => {
    expect(out.problems).toEqual([]);
    expect(out.lines.map((line) => [line.date, line.direction, line.amountMinor, line.balanceMinor])).toEqual([
      ['2026-10-01', 'debit', 22_400n, 1_933_506n],
      ['2026-10-03', 'credit', 500_000n, 2_433_506n],
      ['2026-10-04', 'debit', 107_026n, 2_326_480n],
    ]);
  });

  it('takes the 12-digit UPI reference and the payee from a narration the statement wrapped', () => {
    expect(out.lines[0]).toMatchObject({ payee: 'SAMPLE CAFE', upiReference: '200000000002', hint: 'snacks' });
    expect(out.lines[2]).toMatchObject({ payee: 'SAMPLE VENDOR', upiReference: '300000000003' });
    expect(out.lines[0]?.raw).toBe('UPI/SAMPLE CAFE/XXabcd@tmb/snacks/SAMPLEM/200000000002/ICI9bdaa52c986f4589bbd73a516c1c76f0');
  });

  it('falls back to the payee line printed above a transaction when the narration names nobody', () => {
    expect(out.lines[1]).toMatchObject({ payee: 'SAMPLE EMPLOYER', upiReference: null });
  });

  it('takes the account’s last four and the period from the title, and nothing more of the number', () => {
    expect(out).toMatchObject({ kind: 'icici_savings_pdf', accountType: 'bank', last4: '1234', periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    expect(JSON.stringify(out, (key, value: unknown) => (key === 'raw' ? undefined : typeof value === 'bigint' ? String(value) : value))).not.toContain('123456781234');
  });

  it('does not take the legend at the foot of a page for narration', () => {
    expect(out.lines[2]?.raw).not.toContain('INFT');
  });

  it('carries a statement over pages: the next page’s header is skipped and its first transaction has its payee line', () => {
    const page2: PdfPage = {
      rows: [text('2', 300), ...HEADER, text('SAMPLE SHOP'), withdrawal(4, '05.10.2026', '15.00', '23249.80'), text('UPI/SAMPLE SHOP/XXerpg@axb/UPI/AXIS'), text('BANK/400000000004/AXB0644627ae4044d9f8a37')],
    };
    const result = parseIciciSavings([PAGE1, page2]);
    expect(result.problems).toEqual([]);
    expect(result.lines).toHaveLength(4);
    expect(result.lines[3]).toMatchObject({ date: '2026-10-05', direction: 'debit', amountMinor: 1_500n, payee: 'SAMPLE SHOP', upiReference: '400000000004' });
  });

  it('names a line whose balance does not follow, which is how a misread amount shows', () => {
    const wrong: PdfPage = { rows: PAGE1.rows.map((r) => (r.cells[1]?.text === '04.10.2026' ? withdrawal(3, '04.10.2026', '1070.26', '23999.99') : r)) };
    expect(parseIciciSavings([wrong]).problems.some((problem) => /line 3/.test(problem))).toBe(true);
  });

  it('refuses a file that is not this statement', () => {
    expect(parseIciciSavings([{ rows: [text('hello')] }]).problems[0]).toMatch(/not an ICICI savings statement/i);
  });
});
