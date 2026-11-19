import { describe, expect, it } from 'vitest';
import { parseAxisCard } from './axisCard.ts';
import { parseIciciCard } from './iciciCard.ts';
import type { PdfCell, PdfPage, PdfRow } from './pdfRows.ts';

/**
 * Credit card statements as PDFs (docs/build-plan.md step 7): ICICI's and Axis's. The fixtures are synthetic rows in the layout each bank prints, with invented figures that add
 * up the way a real statement's summary does, so the check that a statement's lines add up to its own summary is exercised.
 */
const cell = (x: number, text: string): PdfCell => ({ x, right: x + text.length * 5, text });
const row = (...cells: [number, string][]): PdfRow => ({ cells: cells.map(([x, text]) => cell(x, text)) });
const page = (...rows: PdfRow[]): PdfPage => ({ rows });

describe('ICICI credit card', () => {
  const PAGE = page(
    row([20, 'CREDIT CARD STATEMENT']),
    row([20, 'STATEMENT DATE']),
    row([20, 'November 18, 2026'], [200, 'To update email ID and registered mailing address']),
    row([20, 'PAYMENT DUE DATE'], [200, 'To update mobile number']),
    row([20, 'xBarcodeNoise']),
    row([20, 'December 6, 2026'], [200, 'Scan to Pay using']),
    row([20, 'Previous Balance'], [120, 'Purchases / Charges'], [240, 'Cash Advances'], [340, 'Payments / Credits']),
    row([20, '` 1,000.00'], [120, '` 5,500.50'], [240, '` 0.00'], [340, '`1,000.00']),
    row([20, 'Date'], [70, 'SerNo.'], [140, 'Transaction Details'], [330, 'Reward'], [380, 'Intl.'], [420, 'Amount (in `)']),
    row([20, '4501XXXXXXXX5678']),
    row([20, '21/10/2026'], [70, '10000000001'], [140, 'Interest Amount Amortization -'], [330, '0'], [450, '150.50']),
    row([140, '<2/6>RAZ*SAMPLE']),
    row([20, '21/10/2026'], [70, '10000000002'], [140, 'IGST-CI@18%'], [330, '0'], [450, '27.00']),
    row([20, '22/10/2026'], [70, '10000000003'], [140, 'SAMPLE CINEMA TICKET CITY IN'], [330, '21'], [450, '1,323.00']),
    row([450, '100%']),
    row([20, '05/11/2026'], [70, '10000000004'], [140, 'SAMPLE STORE'], [330, '0'], [380, '12.00'], [450, '4,000.00']),
    row([20, '01/11/2026'], [70, '10000000005'], [140, 'BBPS Payment received'], [330, '0'], [450, '1,000.00 CR']),
  );

  it('reads a purchase, a charge and a payment, with a credit marked CR and everything else a charge on the card', () => {
    const out = parseIciciCard([PAGE]);
    expect(out.problems).toEqual([]);
    expect(out.lines.map((line) => [line.date, line.direction, line.amountMinor])).toEqual([
      ['2026-10-21', 'debit', 15_050n],
      ['2026-10-21', 'debit', 2_700n],
      ['2026-10-22', 'debit', 132_300n],
      ['2026-11-05', 'debit', 400_000n],
      ['2026-11-01', 'credit', 100_000n],
    ]);
  });

  it('takes the rupee amount and not the international one when both are printed, and the details with their EMI marker carried on', () => {
    const out = parseIciciCard([PAGE]);
    expect(out.lines[3]?.amountMinor).toBe(400_000n);
    expect(out.lines[0]?.raw).toBe('Interest Amount Amortization - <2/6>RAZ*SAMPLE');
  });

  it('is a card, with its last four, the statement date, the due date and what is due', () => {
    const out = parseIciciCard([PAGE]);
    expect(out).toMatchObject({ kind: 'icici_card_pdf', accountType: 'card', last4: '5678', periodEnd: '2026-11-18' });
    expect(out.card).toEqual({ statementDate: '2026-11-18', paymentDueDate: '2026-12-06', previousBalanceMinor: 100_000n, totalDueMinor: 550_050n });
  });

  it('checks that its lines add up to the summary: purchases and charges, and payments and credits', () => {
    const wrong = page(...PAGE.rows.map((r) => (r.cells[0]?.text === '` 1,000.00' ? row([20, '` 1,000.00'], [120, '` 5,600.50'], [240, '` 0.00'], [340, '`1,000.00']) : r)));
    expect(parseIciciCard([wrong]).problems.some((problem) => /purchases and charges/i.test(problem))).toBe(true);
  });

  it('refuses a file that is not this statement', () => {
    expect(parseIciciCard([page(row([20, 'hello']))]).problems[0]).toMatch(/not an ICICI credit card statement/i);
  });
});

describe('Axis credit card', () => {
  const PAGE = page(
    row([20, 'Sample Axis Bank Premium Credit Card']),
    row([20, 'Total Payment Due'], [150, 'Minimum Payment Due'], [280, 'Statement Period'], [400, 'Payment Due Date'], [520, 'Statement Generation Date']),
    row([280, '15/10/2026 - 13/11/2026'], [400, '03/12/2026'], [520, '13/11/2026']),
    row([20, '5,000.00 Dr'], [150, '100.00 Dr']),
    row([20, 'Credit Card Number'], [150, 'Credit Limit']),
    row([20, '554637******9012'], [150, '64,000.00']),
    row([20, '2,000.00 Dr'], [120, '2,000.00'], [200, '10.00'], [280, '5,010.00'], [360, '0.00'], [440, '0.00'], [520, '5,000.00'], [600, 'Dr']),
    row([20, 'Account Summary']),
    row([20, 'DATE'], [90, 'TRANSACTION DETAILS'], [330, 'MERCHANT CATEGORY'], [480, 'AMOUNT (Rs.)']),
    row([20, 'Card No:'], [90, '554637******9012'], [330, 'Name'], [380, 'A PERSON']),
    row([20, '17/10/2026'], [90, 'BBPS PAYMENT RECEIVED - REF0000000001'], [480, '2,000.00 Cr']),
    row([20, '17/10/2026'], [90, 'SAMPLE HOTEL,TOWN'], [330, 'HOTELS'], [480, '1,770.00 Dr']),
    row([20, '18/10/2026'], [90, 'SAMPLE CLOTHES,TOWN'], [330, 'CLOTH STORES'], [480, '3,240.00 Dr']),
    row([20, '02/11/2026'], [90, 'FUEL CASHBACK REBATES'], [480, '10.00 Cr']),
    row([20, '**** End of Statement ****']),
  );

  it('reads a payment, purchases and a cashback, the direction from Dr and Cr', () => {
    const out = parseAxisCard([PAGE]);
    expect(out.problems).toEqual([]);
    expect(out.lines.map((line) => [line.date, line.direction, line.amountMinor])).toEqual([
      ['2026-10-17', 'credit', 200_000n],
      ['2026-10-17', 'debit', 177_000n],
      ['2026-10-18', 'debit', 324_000n],
      ['2026-11-02', 'credit', 1_000n],
    ]);
  });

  it('takes the merchant’s name as the payee and the merchant category as a hint, and has neither for a line without them', () => {
    const out = parseAxisCard([PAGE]);
    expect(out.lines[1]).toMatchObject({ payee: 'SAMPLE HOTEL', hint: 'HOTELS', raw: 'SAMPLE HOTEL,TOWN' });
    expect(out.lines[2]).toMatchObject({ payee: 'SAMPLE CLOTHES', hint: 'CLOTH STORES' });
    expect(out.lines[0]).toMatchObject({ payee: null, hint: null });
  });

  it('is a card, with its last four, the period, the due date and what is due', () => {
    const out = parseAxisCard([PAGE]);
    expect(out).toMatchObject({ kind: 'axis_card_pdf', accountType: 'card', last4: '9012', periodStart: '2026-10-15', periodEnd: '2026-11-13' });
    expect(out.card).toEqual({ statementDate: '2026-11-13', paymentDueDate: '2026-12-03', previousBalanceMinor: 200_000n, totalDueMinor: 500_000n });
    expect(JSON.stringify(out, (key, value: unknown) => (key === 'raw' ? undefined : typeof value === 'bigint' ? String(value) : value))).not.toContain('554637');
  });

  it('checks that its lines add up to the summary', () => {
    const wrong = page(...PAGE.rows.map((r) => (r.cells[0]?.text === '2,000.00 Dr' ? row([20, '2,000.00 Dr'], [120, '2,000.00'], [200, '10.00'], [280, '5,999.00'], [360, '0.00'], [440, '0.00'], [520, '5,000.00'], [600, 'Dr']) : r)));
    expect(parseAxisCard([wrong]).problems.some((problem) => /purchases and charges/i.test(problem))).toBe(true);
  });

  it('refuses a file that is not this statement', () => {
    expect(parseAxisCard([page(row([20, 'hello']))]).problems[0]).toMatch(/not an Axis credit card statement/i);
  });
});
