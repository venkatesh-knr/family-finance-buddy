import { describe, expect, it } from 'vitest';
import { parseHdfcDelimited, parseHdfcText, parseQif } from './textFormats.ts';

/**
 * The plain-text statements of a bank (docs/build-plan.md step 7: HDFC delimited and text, and QIF). The fixtures are synthetic: the structure of the banks' own files, with
 * invented names, references and figures, because the real files are a household's and stay outside the repository.
 */

const DELIMITED = [
  '',
  '  Date     ,Narration                                                                                                                ,Value Dat,Debit Amount       ,Credit Amount      ,Chq/Ref Number  ,Closing Balance  ',
  ' 19/08/26  ,NEFT DR-ABCD0000001-A PERSON-NETBANK, MUM-HDFCH00000000001-FOR TEST                                                       ,19/08/26 ,      50000.00     ,          0.00     ,HDFCH00000000001,41500.00  ',
  ' 19/08/26  ,UPI-SAMPLE SHOP-SAMPLESHOP@OKBANK-ABCD0000001-123456789012-GROCERIES                                                       ,19/08/26 ,      18072.50     ,          0.00     ,0000123456789012,23427.50  ',
  ' 21/08/26  ,SALARY CREDIT SAMPLE EMPLOYER                                                                                             ,21/08/26 ,          0.00     ,     120000.00     ,SAL00000001,143427.50  ',
  '',
].join('\n');

/** Everything of a value but the raw narration, as text: the raw line is kept to recognise a line again (its hash) and is not what is shown or stored beside a payee. */
const shown = (value: unknown): string => JSON.stringify(value, (key, found: unknown) => (key === 'raw' ? undefined : typeof found === 'bigint' ? String(found) : found));

describe('HDFC, delimited', () => {
  const out = parseHdfcDelimited(DELIMITED);

  it('reads a debit, a UPI payment and a credit, with the direction from the column that has a figure', () => {
    expect(out.problems).toEqual([]);
    expect(out.lines.map((line) => [line.date, line.direction, line.amountMinor])).toEqual([
      ['2026-08-19', 'debit', 5_000_000n],
      ['2026-08-19', 'debit', 1_807_250n],
      ['2026-08-21', 'credit', 12_000_000n],
    ]);
  });

  it('keeps a comma that is inside a narration, and reads the columns from the right', () => {
    expect(out.lines[0]?.raw).toBe('NEFT DR-ABCD0000001-A PERSON-NETBANK, MUM-HDFCH00000000001-FOR TEST');
    expect(out.lines[0]).toMatchObject({ valueDate: '2026-08-19', reference: 'HDFCH00000000001', payee: 'A PERSON', upiReference: null });
  });

  it('takes the payee, the 12-digit reference and the note from a UPI narration, and never keeps the VPA', () => {
    expect(out.lines[1]).toMatchObject({ payee: 'SAMPLE SHOP', upiReference: '123456789012', hint: 'GROCERIES', reference: '0000123456789012' });
    expect(shown(out.lines[1])).not.toContain('@');
    expect(out.lines[2]).toMatchObject({ payee: null, upiReference: null, hint: null });
  });

  it('says it is a bank account, states no period and no account number, and reads the closing balance the file prints', () => {
    expect(out).toMatchObject({ kind: 'hdfc_delimited', accountType: 'bank', last4: null, periodStart: null, periodEnd: null });
    expect(out.lines.map((line) => line.balanceMinor)).toEqual([4_150_000n, 2_342_750n, 14_342_750n]);
  });

  it('reads the six column layout, which has no balance, by its header', () => {
    const six = DELIMITED.replace(',Closing Balance  ', '').replace(',41500.00  ', '').replace(',23427.50  ', '').replace(',143427.50  ', '');
    const result = parseHdfcDelimited(six);
    expect(result.problems).toEqual([]);
    expect(result.lines).toHaveLength(3);
    expect(result.lines.every((line) => line.balanceMinor === null)).toBe(true);
    expect(result.lines[1]).toMatchObject({ direction: 'debit', amountMinor: 1_807_250n, reference: '0000123456789012' });
  });

  it('names a row it cannot read, by row, and carries on with the rest', () => {
    const bad = DELIMITED.replace('50000.00', 'fifty').replace('21/08/26  ,SALARY', '31/02/26  ,SALARY');
    const result = parseHdfcDelimited(bad);
    expect(result.lines).toHaveLength(1);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(/row 1/i);
  });

  it('refuses a file that is not this format, and a row with a figure in both columns or neither', () => {
    expect(parseHdfcDelimited('hello\nworld').problems[0]).toMatch(/not an HDFC delimited statement/i);
    const both = DELIMITED.replace('          0.00     ,HDFCH00000000001,', '       500.00     ,HDFCH00000000001,');
    expect(parseHdfcDelimited(both).problems.some((p) => /both|neither/i.test(p))).toBe(true);
  });
});

/** A row of the printed statement: the columns at the widths the statement draws (8, 40, 16, 8, 18, 18, 18), two spaces between, figures to the right of their column. */
const WIDTHS = [8, 40, 16, 8, 18, 18, 18] as const;
const fixed = (cells: readonly string[]): string => cells.map((cell, i) => (i >= 4 ? cell.padStart(WIDTHS[i] ?? 0) : cell.padEnd(WIDTHS[i] ?? 0))).join('  ');
/** A transaction as the statement prints it: the narration cut at 40 characters and carried on beneath, the way the bank's own text wraps it. */
const printed = (date: string, narration: string, ref: string, withdrawal: string, deposit: string, balance: string): string[] => [
  fixed([date, narration.slice(0, 40), ref, date, withdrawal, deposit, balance]),
  ...(narration.length > 40 ? [fixed(['', narration.slice(40, 80), '', '', '', '', ''])] : []),
];

const TEXT = [
  'HDFC BANK Ltd.                                     Page No .:   1                                        Statement of accounts',
  '',
  '                                                                         Account No     : 50100000001234   PB Customer',
  'Statement From      : 19/08/2026  To: 29/08/2026                         RTGS/NEFT IFSC : HDFC0000001    MICR : 560000000',
  '',
  WIDTHS.map((w) => '-'.repeat(w)).join('  '),
  'Date      Narration                                 Chq./Ref.No.      Value Dt  Withdrawal Amt.        Deposit Amt.     Closing Balance',
  WIDTHS.map((w) => '-'.repeat(w)).join('  '),
  '',
  ...printed('19/08/26', 'NEFT DR-ABCD0000001-A PERSON-NETBANK, MUM-HDFCH00000000001-FOR TEST', 'HDFCH00000000001', '50,000.00', '', '41,500.00'),
  ...printed('19/08/26', 'UPI-SAMPLE SHOP-SAMPLESHOP@OKBANK-ABCD0000001-123456789012-GROCERIES', '0000123456789012', '18,072.50', '', '23,427.50'),
  ...printed('21/08/26', 'SALARY CREDIT SAMPLE EMPLOYER', 'SAL00000001', '', '1,20,000.00', '1,43,427.50'),
  '',
  WIDTHS.map((w) => '*'.repeat(w)).join('  '),
].join('\n');

describe('HDFC, the printed statement as text', () => {
  const out = parseHdfcText(TEXT);

  it('reads the columns by the widths the statement itself draws, and the direction from the column', () => {
    expect(out.problems).toEqual([]);
    expect(out.lines.map((line) => [line.date, line.direction, line.amountMinor, line.balanceMinor])).toEqual([
      ['2026-08-19', 'debit', 5_000_000n, 4_150_000n],
      ['2026-08-19', 'debit', 1_807_250n, 2_342_750n],
      ['2026-08-21', 'credit', 12_000_000n, 14_342_750n],
    ]);
  });

  it('joins a narration that the statement wrapped, without a space where it cut a word, so a UPI narration is whole again', () => {
    expect(out.lines[0]?.raw).toBe('NEFT DR-ABCD0000001-A PERSON-NETBANK, MUM-HDFCH00000000001-FOR TEST');
    expect(out.lines[1]?.raw).toBe('UPI-SAMPLE SHOP-SAMPLESHOP@OKBANK-ABCD0000001-123456789012-GROCERIES');
    expect(out.lines[1]).toMatchObject({ payee: 'SAMPLE SHOP', upiReference: '123456789012', hint: 'GROCERIES', reference: '0000123456789012' });
  });

  it('takes the last four of the account and the period from the header, and nothing more of the number', () => {
    expect(out).toMatchObject({ kind: 'hdfc_text', accountType: 'bank', last4: '1234', periodStart: '2026-08-19', periodEnd: '2026-08-29' });
    expect(shown(out)).not.toContain('50100000001234');
  });

  it('stops at the end of the statement and refuses a file that is not this one', () => {
    expect(parseHdfcText('not a statement').problems[0]).toMatch(/not an HDFC statement/i);
  });
});

const QIF = ['!Type:Bank', 'D08-19-2026', 'T-50000.00', 'NHDFCH00000000001', 'PNEFT DR-ABCD0000001-A PERSON-NETBANK, MUM-HDFCH00000000001-FOR TEST', 'MTXN TIME 18:42:46', '^', 'D08-21-2026', 'T120000.00', 'PSALARY CREDIT SAMPLE EMPLOYER', '^', ''].join('\n');

describe('QIF', () => {
  const out = parseQif(QIF);

  it('reads the date month first, the sign as the direction, and the payee line as the narration', () => {
    expect(out.problems).toEqual([]);
    expect(out.lines.map((line) => [line.date, line.direction, line.amountMinor])).toEqual([
      ['2026-08-19', 'debit', 5_000_000n],
      ['2026-08-21', 'credit', 12_000_000n],
    ]);
    expect(out.lines[0]).toMatchObject({ raw: 'NEFT DR-ABCD0000001-A PERSON-NETBANK, MUM-HDFCH00000000001-FOR TEST', reference: 'HDFCH00000000001', payee: 'A PERSON' });
  });

  it('reads a date written day first when a day is above twelve, and says it was', () => {
    const dayFirst = parseQif(['!Type:Bank', 'D19-08-2026', 'T-10.00', 'PSAMPLE', '^', ''].join('\n'));
    expect(dayFirst.lines[0]?.date).toBe('2026-08-19');
  });

  it('is a card when the file says so, and is not this format when it has no type header', () => {
    expect(parseQif('!Type:CCard\nD08-19-2026\nT-10.00\nPSAMPLE\n^\n').accountType).toBe('card');
    expect(parseQif('hello').problems[0]).toMatch(/not a QIF file/i);
  });

  it('names a record it cannot read and carries on', () => {
    const result = parseQif(['!Type:Bank', 'D08-19-2026', 'Tlots', 'PSAMPLE', '^', 'D08-20-2026', 'T-5.00', 'PSAMPLE TWO', '^', ''].join('\n'));
    expect(result.lines).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
  });
});
