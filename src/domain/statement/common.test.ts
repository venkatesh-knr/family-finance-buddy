import { describe, expect, it } from 'vitest';
import { balanceChainProblems, describeNarration, last4Of, parseAmount, parseDate, upiNarration, type StatementLine } from './common.ts';

/**
 * What every statement parser shares (docs/design/spending-capture.md section 4; docs/build-plan.md step 7): amounts as exact minor units, dates as IST calendar days,
 * the last four of an account and the parts of a UPI narration. Fixtures are synthetic, with the structure of the banks' own text and none of a household's data.
 */
describe('amounts', () => {
  it('reads an Indian-grouped or plain figure to exact paise, whatever it is padded with', () => {
    expect(parseAmount('50,000.00')).toBe(5_000_000n);
    expect(parseAmount('   18072.50   ')).toBe(1_807_250n);
    expect(parseAmount('1,23,456.78')).toBe(12_345_678n);
    expect(parseAmount('224')).toBe(22_400n);
    expect(parseAmount('0.00')).toBe(0n);
    expect(parseAmount('₹1,070.50')).toBe(107_050n);
    expect(parseAmount('` 29,730.25')).toBe(2_973_025n);
  });

  it('refuses what is not a figure, more than two decimals, and a sign: direction is its own field', () => {
    for (const text of ['', ' ', 'abc', '1.234', '-5', '5-', '1,00,0.5']) expect(parseAmount(text), text).toBeNull();
  });

  it('never goes through a double', () => {
    expect(parseAmount('90071992547409.93')).toBe(9_007_199_254_740_993n);
  });
});

describe('dates', () => {
  it('reads day first with a two or four digit year', () => {
    expect(parseDate('19/08/26', 'dmy')).toBe('2026-08-19');
    expect(parseDate('19/08/2026', 'dmy')).toBe('2026-08-19');
    expect(parseDate('01.10.2026', 'dmy')).toBe('2026-10-01');
    expect(parseDate('19-08-26', 'dmy')).toBe('2026-08-19');
  });

  it('reads month first, as a QIF file writes it', () => {
    expect(parseDate('08-19-2026', 'mdy')).toBe('2026-08-19');
    expect(parseDate('08/19/26', 'mdy')).toBe('2026-08-19');
  });

  it('reads a day, a month name and a year', () => {
    expect(parseDate('01 Oct, 2026', 'dMonY')).toBe('2026-10-01');
    expect(parseDate('November 18, 2026', 'MonDY')).toBe('2026-11-18');
  });

  it('refuses a date that is not on the calendar', () => {
    expect(parseDate('31/02/26', 'dmy')).toBeNull();
    expect(parseDate('13/13/26', 'dmy')).toBeNull();
    expect(parseDate('hello', 'dmy')).toBeNull();
    expect(parseDate('', 'mdy')).toBeNull();
  });
});

describe('the last four of an account or card', () => {
  it('keeps four digits and nothing else of the number', () => {
    expect(last4Of('50100000001234')).toBe('1234');
    expect(last4Of('XXXXXXXX1234')).toBe('1234');
    expect(last4Of('4501XXXXXXXX5678')).toBe('5678');
    expect(last4Of('554637******9012')).toBe('9012');
    expect(last4Of('Paid by SAMPLE Bank 4321')).toBe('4321');
  });

  it('is nothing when there are not four digits to keep', () => {
    expect(last4Of('')).toBeNull();
    expect(last4Of('XXX')).toBeNull();
    expect(last4Of('12')).toBeNull();
  });
});

describe('a UPI narration', () => {
  it('takes the payee, the 12-digit reference and the note from an HDFC narration, and never keeps the VPA', () => {
    const out = upiNarration('UPI-SAMPLE SHOP-SAMPLESHOP@OKBANK-ABCD0000001-123456789012-GROCERIES');
    expect(out).toEqual({ payee: 'SAMPLE SHOP', reference: '123456789012', note: 'GROCERIES' });
    expect(JSON.stringify(out)).not.toContain('@');
  });

  it('copes with a hyphen inside the VPA and a name that is cut short', () => {
    expect(upiNarration('UPI-A PERSON NAME-APERSON1-3@OKSBI-ABCD0000001-100000000001-EXPENSES')).toEqual({ payee: 'A PERSON NAME', reference: '100000000001', note: 'EXPENSES' });
  });

  it('takes the parts of an ICICI narration, which is slash separated', () => {
    expect(upiNarration('UPI/SAMPLE CAFE/XXabcd@tmb/snacks/TAMILNAD MERCANTILE/200000000002/ICI9bdaa52c986f4589bbd73a516c1c76f0')).toEqual({
      payee: 'SAMPLE CAFE',
      reference: '200000000002',
      note: 'snacks',
    });
  });

  it('reads a narration that is wrapped over lines once it has been joined', () => {
    expect(upiNarration('UPI/SAMPLE VENDOR/XX7vtj@paytm/food/YES BANK L/300000000003/ICI4e545cfea2e14db2a1afdf7e11 bcad68')?.reference).toBe('300000000003');
  });

  it('is nothing for a narration that is not a UPI payment', () => {
    expect(upiNarration('NEFT DR-ABCD0000001-SOMEONE-NETBANK, MUM-HDFCH0000000001-INV')).toBeNull();
    expect(upiNarration('ATW-123456XXXXXX7890-ATM01-CHENNAI')).toBeNull();
  });

  it('refuses a reference that is not 12 digits rather than guessing', () => {
    expect(upiNarration('UPI-SAMPLE SHOP-SHOP@OKBANK-ABCD0000001-12345-NOTE')?.reference).toBeNull();
  });
});

describe('what a narration says about a line', () => {
  it('gives the payee, the UPI reference and the note as a hint for a UPI payment', () => {
    expect(describeNarration('UPI-SAMPLE SHOP-SAMPLESHOP@OKBANK-ABCD0000001-123456789012-GROCERIES')).toEqual({ payee: 'SAMPLE SHOP', upiReference: '123456789012', hint: 'GROCERIES' });
  });

  it('gives the beneficiary of a NEFT, IMPS or RTGS transfer and no reference', () => {
    expect(describeNarration('NEFT DR-ABCD0000001-A PERSON-NETBANK, MUM-HDFCH00000000001-FOR TEST')).toEqual({ payee: 'A PERSON', upiReference: null, hint: null });
    expect(describeNarration('IMPS-312345678901-ANOTHER PERSON-ABCD-XXXXXXXX1234-NOTE')).toEqual({ payee: null, upiReference: null, hint: null });
  });

  it('gives nothing for a line that names nobody', () => {
    expect(describeNarration('SALARY CREDIT SAMPLE EMPLOYER')).toEqual({ payee: null, upiReference: null, hint: null });
  });
});

describe('the running balance as a check on a statement’s own lines', () => {
  const line = (direction: 'debit' | 'credit', amount: bigint, balance: bigint | null): StatementLine =>
    ({ date: '2026-08-19', valueDate: null, direction, amountMinor: amount, raw: '', payee: null, upiReference: null, reference: null, balanceMinor: balance, hint: null });

  it('is clean when each balance follows from the one before it and its line', () => {
    expect(balanceChainProblems([line('debit', 100n, 900n), line('credit', 50n, 950n), line('debit', 150n, 800n)])).toEqual([]);
  });

  it('names the line whose balance does not follow, which is how a misread direction or amount shows', () => {
    const problems = balanceChainProblems([line('debit', 100n, 900n), line('credit', 50n, 850n), line('debit', 150n, 700n)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/line 2/);
  });

  it('skips a line with no balance and goes on from the next that has one', () => {
    expect(balanceChainProblems([line('debit', 100n, 900n), line('debit', 50n, null), line('debit', 50n, 800n)])).toEqual([]);
    expect(balanceChainProblems([line('debit', 100n, null), line('debit', 50n, null)])).toEqual([]);
  });
});
