import { describe, expect, it } from 'vitest';
import { parsePdfStatement, parseTextStatement } from './detect.ts';
import type { PdfPage } from './pdfRows.ts';

/** Which statement a file is, from what it says (docs/build-plan.md step 7): a person chooses a file, not a format. */
const page = (...rows: string[]): PdfPage => ({ rows: rows.map((text) => ({ cells: [{ x: 10, right: 10 + text.length * 5, text }] })) });

describe('a text file', () => {
  it('is QIF when it begins with a type line', () => {
    expect(parseTextStatement('!Type:Bank\nD08-19-2026\nT-10.00\nPSAMPLE\n^\n').statement?.kind).toBe('qif');
  });

  it('is HDFC delimited when it has the Date, Narration header', () => {
    const text = '\n Date ,Narration ,Value Dat,Debit Amount ,Credit Amount ,Chq/Ref Number\n 19/08/26 ,SAMPLE ,19/08/26 , 10.00 , 0.00 ,REF1\n';
    expect(parseTextStatement(text).statement?.kind).toBe('hdfc_delimited');
  });

  it('is HDFC’s printed statement when it has the Narration and Withdrawal columns under a rule', () => {
    const rule = '--------  ----------------------------------------  ----------------  --------  ------------------  ------------------  ------------------';
    const text = ['HDFC BANK Ltd.', rule, 'Date      Narration                                 Chq./Ref.No.      Value Dt  Withdrawal Amt.        Deposit Amt.     Closing Balance', rule, ''].join('\n');
    expect(parseTextStatement(text).statement?.kind).toBe('hdfc_text');
  });

  it('is none of them otherwise, and says so, rather than guessing', () => {
    const out = parseTextStatement('hello, this is a letter');
    expect(out.statement).toBeNull();
    expect(out.problem).toMatch(/not a statement the app reads/i);
  });
});

describe('a PDF', () => {
  it('is ICICI savings by its title', () => {
    expect(parsePdfStatement([page('Statement of Transactions in Account no. 123456781234 in INR for the period October 1, 2026 - October 31, 2026')]).statement?.kind).toBe('icici_savings_pdf');
  });

  it('is the ICICI card by its heading, the Axis card by its name, and Google Pay by its period', () => {
    expect(parsePdfStatement([page('CREDIT CARD STATEMENT')]).statement?.kind).toBe('icici_card_pdf');
    expect(parsePdfStatement([page('Sample Axis Bank Premium Credit Card')]).statement?.kind).toBe('axis_card_pdf');
    expect(parsePdfStatement([page('Transaction statement period')]).statement?.kind).toBe('gpay_pdf');
  });

  it('is none of them otherwise, and says so', () => {
    const out = parsePdfStatement([page('Some other document')]);
    expect(out.statement).toBeNull();
    expect(out.problem).toMatch(/not a statement the app reads/i);
  });
});
