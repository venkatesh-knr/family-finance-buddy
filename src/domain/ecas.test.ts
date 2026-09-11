/**
 * Reading a consolidated account statement.
 *
 * Every line below is synthetic. A real eCAS lists every folio, the PAN and
 * the address of the person it was issued to, and none of that belongs in a
 * public repository — so these fixtures are written in the shape of the
 * published CAMS and KFintech layouts with invented figures. They will be
 * wrong in details no published description mentions, which is what testing
 * against a real file is for; the point of having them is that the shape is
 * pinned and a change that breaks it says so.
 *
 * The parser is pure: lines of text in, transactions out. It touches no PDF,
 * no crypto and no clock — the file is opened by an adapter and the identity
 * of each line is hashed outside, because a hash is I/O-shaped and this is
 * arithmetic.
 *
 * Two rules it must never break:
 *
 *   A magnitude is a magnitude. Amounts and units are unsigned, exactly as
 *   `parseAmountToMinor` and `parseQuantity` insist, and the direction of a
 *   transaction is its own field. A redemption printed as (4,000.00) is four
 *   thousand rupees going out, not minus four thousand rupees held.
 *
 *   A line that does not parse is reported, never dropped. A statement where
 *   nine rows of ten arrive is worse than one that fails outright, because the
 *   cost basis looks plausible.
 */

import { describe, expect, it } from 'vitest';
import { parseAmountToMinor } from '../lib/money.ts';
import { parseQuantity as q } from '../lib/quantity.ts';
import { parseEcas } from './ecas.ts';

const paise = (amount: string) => parseAmountToMinor(amount, 'INR');

/**
 * A two-folio statement, in the CAMS shape.
 *
 * It carries the awkward cases on purpose: a charge line with one figure
 * rather than four, a redemption printed in brackets, an IDCW payout that
 * moves no units, two identical SIP instalments on one day, and a line that
 * begins with a date and is not a transaction at all.
 */
const STATEMENT = [
  'Consolidated Account Statement',
  'CAMS  KFintech  Franklin Templeton  SBFS',
  'Statement for the period from 01-Apr-2024 To 31-Mar-2026',
  'PAN: XXXXX1234X          KYC: OK',
  '',
  'HDFC Mutual Fund',
  'Folio No: 10422158 / 45',
  'HDFC0001-HDFC Top 100 Fund - Growth (Advisor: DIRECT) Registrar : CAMS',
  'ISIN: INF179K01BC2',
  'Date       Transaction                Amount      Units       Price    Unit Balance',
  'Opening Unit Balance                                                        0.000',
  '05-Apr-2024 Purchase-SIP             5,000.00     45.123    110.8100      45.123',
  '05-Apr-2024 *** Stamp Duty ***           0.25',
  '05-May-2024 Purchase-SIP             5,000.00     43.500    114.9425      88.623',
  '05-Jun-2024 Purchase-SIP             5,000.00     43.500    114.9425     132.123',
  '05-Jun-2024 Purchase-SIP             5,000.00     43.500    114.9425     175.623',
  '20-Jun-2025 Redemption              (4,000.00)   (30.000)   133.3333     145.623',
  '31-Mar-2026 Closing Unit Balance                                         145.623',
  '',
  'SBI Mutual Fund',
  'Folio No: 90876543',
  'SB0007-SBI Bluechip Fund - Regular Plan - IDCW (Advisor: ARN-1234) Registrar : KFINTECH',
  'ISIN: INF200K01LQ9',
  '12-Aug-2024 Purchase                25,000.00    500.000     50.0000     500.000',
  '15-Sep-2025 IDCW Reinvestment        1,250.00     24.000     52.0833     524.000',
  '16-Sep-2025 IDCW Payout                800.00',
  '18-Sep-2025 Something the layout does not explain',
  'Closing Unit Balance                                                     524.000',
];

describe('parsing a consolidated account statement', () => {
  const statement = parseEcas(STATEMENT);

  it('reads the period it covers', () => {
    expect(statement.period).toEqual({ from: '2024-04-01', to: '2026-03-31' });
  });

  it('finds each folio, with its scheme and ISIN', () => {
    expect(statement.folios).toHaveLength(2);

    const [hdfc, sbi] = statement.folios;
    expect(hdfc?.amc).toBe('HDFC Mutual Fund');
    expect(hdfc?.folio).toBe('10422158 / 45');
    expect(hdfc?.scheme).toContain('HDFC Top 100 Fund - Growth');
    expect(hdfc?.isin).toBe('INF179K01BC2');

    expect(sbi?.amc).toBe('SBI Mutual Fund');
    expect(sbi?.isin).toBe('INF200K01LQ9');
  });

  /**
   * Four characters, and never the folio itself. "Account identifiers keep
   * last four digits only" — the whole folio exists in memory long enough to
   * be hashed and is never returned for storage.
   */
  it('keeps only the last four characters of a folio', () => {
    expect(statement.folios[0]?.folioLast4).toBe('5845');
    expect(statement.folios[1]?.folioLast4).toBe('6543');
  });

  it('reads a purchase as a magnitude, with its direction alongside', () => {
    const first = statement.folios[0]?.transactions[0];

    expect(first?.date).toBe('2024-04-05');
    expect(first?.kind).toBe('purchase');
    expect(first?.direction).toBe('in');
    expect(first?.amountMinor).toBe(paise('5000.00'));
    expect(first?.units).toBe(q('45.123'));
    expect(first?.nav).toBe('110.8100');
    expect(first?.balanceUnits).toBe(q('45.123'));
  });

  /**
   * The case the money invariant is really about. A redemption is printed as
   * (4,000.00) and (30.000), and a parser that let a minus sign through would
   * put a negative cost into `lot` — where the column refuses it — or a
   * negative quantity into a position.
   */
  it('reads a bracketed redemption as money going out, never as a negative', () => {
    const redemption = statement.folios[0]?.transactions.find((t) => t.kind === 'redemption');

    expect(redemption?.date).toBe('2025-06-20');
    expect(redemption?.direction).toBe('out');
    expect(redemption?.amountMinor).toBe(paise('4000.00'));
    expect(redemption?.units).toBe(q('30.000'));
    expect(redemption?.amountMinor).toBeGreaterThan(0n);
    expect(redemption?.units).toBeGreaterThan(0n);
  });

  it('leaves a charge that belongs to no purchase alone, rather than guessing', () => {
    const statement = parseEcas([
      'Folio No: 12345678',
      'ABC0001-A Fund - Growth',
      '05-Apr-2024 Purchase-SIP 5,000.00 45.123 110.8100 45.123',
      '20-Jun-2024 *** Annual Maintenance *** 100.00',
    ]);

    const fee = statement.folios[0]?.transactions.find((t) => t.date === '2024-06-20');

    expect(fee?.kind).toBe('charge');
    expect(fee?.absorbed).toBe(false);
    expect(statement.folios[0]?.transactions[0]?.chargesMinor).toBe(0n);
  });

  it('reads a charge line that carries one figure and no units', () => {
    const duty = statement.folios[0]?.transactions.find((t) => t.kind === 'charge');

    expect(duty?.description).toContain('Stamp Duty');
    expect(duty?.amountMinor).toBe(paise('0.25'));
    expect(duty?.units).toBe(0n);
    expect(duty?.nav).toBeNull();
  });

  /**
   * The cost of acquisition is all in: "brokerage, STT and stamp duty belong
   * in here rather than in a column of their own". A statement prints the duty
   * as its own row on the same day, so the two are put back together.
   */
  it('folds stamp duty into the purchase it was charged on', () => {
    const [purchase, duty] = statement.folios[0]?.transactions ?? [];

    expect(purchase?.kind).toBe('purchase');
    expect(purchase?.amountMinor).toBe(paise('5000.00'));
    expect(purchase?.chargesMinor).toBe(paise('0.25'));
    expect(duty?.absorbed).toBe(true);
  });

  it('leaves the purchase its own identity, so an earlier import still matches', () => {
    const purchase = statement.folios[0]?.transactions[0];

    expect(purchase?.identity).not.toContain('0.25');
    expect(purchase?.identity).toContain('in500000');
  });

  it('tells a reinvestment from a payout, because one buys units and one does not', () => {
    const sbi = statement.folios[1];

    const reinvestment = sbi?.transactions.find((t) => t.kind === 'dividend_reinvest');
    expect(reinvestment?.units).toBe(q('24.000'));
    expect(reinvestment?.direction).toBe('in');

    const payout = sbi?.transactions.find((t) => t.kind === 'dividend_payout');
    expect(payout?.units).toBe(0n);
    expect(payout?.direction).toBe('out');
  });

  it('does not mistake opening, closing or header lines for transactions', () => {
    const descriptions = statement.folios.flatMap((f) =>
      f.transactions.map((t) => t.description.toLowerCase()),
    );

    expect(descriptions.some((d) => d.includes('opening unit balance'))).toBe(false);
    expect(descriptions.some((d) => d.includes('closing unit balance'))).toBe(false);
    expect(descriptions.some((d) => d.includes('transaction'))).toBe(false);
  });

  it('records the closing balance the statement states, as its own figure', () => {
    expect(statement.folios[0]?.closingUnits).toBe(q('145.623'));
    expect(statement.folios[1]?.closingUnits).toBe(q('524.000'));
  });

  /**
   * Reported, not dropped. Nine rows of ten arriving silently is the failure
   * that shows up years later in a cost basis.
   */
  it('reports a line it cannot read rather than skipping it quietly', () => {
    expect(statement.unread).toHaveLength(1);
    expect(statement.unread[0]?.line).toContain('Something the layout does not explain');
    expect(statement.unread[0]?.folio).toBe('90876543');
  });

  it('says which registrar produced it', () => {
    expect(statement.registrar).toBe('cams');
  });
});

describe('the identity of a statement line', () => {
  const statement = parseEcas(STATEMENT);
  const hdfc = statement.folios[0];

  /**
   * The hazard the position solves. Two SIP instalments can fall on one day
   * for the same amount and the same units — a top-up beside the monthly
   * instalment — and on date, amount and description alone the two lines are
   * indistinguishable. Hashed that way, the second would be refused as a
   * re-import and the cost basis would be short by one instalment.
   */
  it('separates two identical instalments on one day', () => {
    const june = hdfc?.transactions.filter((t) => t.date === '2024-06-05') ?? [];

    expect(june).toHaveLength(2);
    expect(june[0]?.amountMinor).toBe(june[1]?.amountMinor);
    expect(june[0]?.units).toBe(june[1]?.units);
    expect(june[0]?.identity).not.toBe(june[1]?.identity);
  });

  it('gives the same line the same identity every time the file is read', () => {
    const again = parseEcas(STATEMENT);

    expect(again.folios[0]?.transactions.map((t) => t.identity)).toEqual(
      hdfc?.transactions.map((t) => t.identity),
    );
  });

  /**
   * The case that matters on the second import, and the reason the ordinal
   * counts identical lines rather than positions.
   *
   * A CAS is requested for a period, and the periods overlap: April to
   * September this time, January to September next. The same instalment is
   * the first line of one file and the seventh of the other. An identity built
   * on position makes those two different lines, the unique index sees two
   * different hashes and lets both in, and the fund's cost basis is doubled
   * for that instalment.
   */
  it('gives a line the same identity whatever period the file covers', () => {
    const shorter = parseEcas([
      'Folio No: 12345678',
      'ABC0001-A Fund - Growth Registrar : CAMS',
      '05-Jun-2024 Purchase-SIP 5,000.00 45.123 110.8100 90.246',
    ]);

    const longer = parseEcas([
      'Folio No: 12345678',
      'ABC0001-A Fund - Growth Registrar : CAMS',
      '05-Apr-2024 Purchase-SIP 5,000.00 45.123 110.8100 45.123',
      '05-May-2024 Purchase-SIP 5,000.00 43.500 114.9425 88.623',
      '05-Jun-2024 Purchase-SIP 5,000.00 45.123 110.8100 90.246',
    ]);

    const june = longer.folios[0]?.transactions.find((t) => t.date === '2024-06-05');

    expect(shorter.folios[0]?.transactions[0]?.identity).toBe(june?.identity);
  });

  it('gives two folios different identities for otherwise identical lines', () => {
    const one = parseEcas([
      'Folio No: 11111111',
      'ABC0001-A Fund - Growth Registrar : CAMS',
      '05-Apr-2024 Purchase-SIP 5,000.00 45.123 110.8100 45.123',
    ]);
    const other = parseEcas([
      'Folio No: 22222222',
      'ABC0001-A Fund - Growth Registrar : CAMS',
      '05-Apr-2024 Purchase-SIP 5,000.00 45.123 110.8100 45.123',
    ]);

    expect(one.folios[0]?.transactions[0]?.identity).not.toBe(
      other.folios[0]?.transactions[0]?.identity,
    );
  });
});

/**
 * A registrar's eCAS, as CAMS actually prints one.
 *
 * Written from a real statement with every figure, folio, name and identifier
 * replaced. It differs from the published description in three ways that each
 * broke something: the investor's name sits between the folio and the scheme,
 * the scheme line wraps with the ISIN on the continuation, and every page is
 * headed by a date range that begins like a transaction.
 */
const REGISTRAR = [
  'Consolidated Account Statement',
  '01-Apr-2026 To 11-Sep-2026',
  'Date Transaction Amount Units Price Unit',
  '(INR) (INR) Balance',
  'A Fund House Mutual Fund',
  'Folio No: 1234567 / 61 PAN: ABCDE1234F KYC: OK PAN: OK',
  'Jane Investor',
  'P1191-A Fund House Large Cap Fund (erstwhile Bluechip Fund) - Growth (Non Registrar : CAMS',
  '-Demat) - ISIN: INF109K01BL4(Advisor: ABCMFC)',
  'Nominee 1: Nominee 2: Nominee 3:',
  'Opening Unit Balance: 3,733.251',
  '06-Apr-2026 SIP Purchase - Instalment 14/190 - via Internet - ABCMFC/E376338 4,999.75 48.845 102.36 3,782.096',
  '06-Apr-2026 *** Stamp Duty *** 0.25',
  'Closing Unit Balance: 3,782.096 NAV on 10-Sep-2026: INR 105.66 Total Cost Value: 298,936.65 Market Value on 10-Sep-2026: INR 424,090.71',
];

describe('a registrar eCAS, as one is actually printed', () => {
  const statement = parseEcas(REGISTRAR);
  const folio = statement.folios[0];

  it('reads the period from the page header', () => {
    expect(statement.period).toEqual({ from: '2026-04-01', to: '2026-09-11' });
  });

  /**
   * The page header begins with a date and is not a transaction. Every page of
   * a real statement carries one, and they were the whole of its "could not be
   * read" list.
   */
  it('does not take the page header for a transaction it failed to read', () => {
    expect(statement.unread).toEqual([]);
  });

  /**
   * The line between the folio and the scheme is the investor's name. Taking
   * the first plausible line after the folio made a person's name the name of
   * an instrument — wrong as data, and a name written into a table that never
   * asked for one.
   */
  it('takes the scheme, not the name of the person the statement is for', () => {
    expect(folio?.scheme).toBe(
      'A Fund House Large Cap Fund (erstwhile Bluechip Fund) - Growth',
    );
    expect(folio?.scheme).not.toContain('Jane Investor');
  });

  it('finds the ISIN on the line the name wrapped onto', () => {
    expect(folio?.isin).toBe('INF109K01BL4');
  });

  it('takes the fund house printed above the folio', () => {
    expect(folio?.amc).toBe('A Fund House Mutual Fund');
  });

  /**
   * "Closing Unit Balance: 3,782.096 NAV on …: INR 105.66 … Market Value …:
   * INR 424,090.71" — the last figure on that line is what the holding is
   * worth, and reading it as a quantity would say the household owns four
   * hundred thousand units of it.
   */
  it('reads the closing balance as units, not the market value beside it', () => {
    expect(folio?.closingUnits).toBe(q('3782.096'));
  });

  it('reads the instalment and leaves the stamp duty as a charge', () => {
    const [purchase, duty] = folio?.transactions ?? [];

    expect(purchase?.amountMinor).toBe(paise('4999.75'));
    expect(purchase?.units).toBe(q('48.845'));
    expect(purchase?.nav).toBe('102.36');
    expect(duty?.kind).toBe('charge');
    expect(duty?.amountMinor).toBe(paise('0.25'));
  });
});

/**
 * A depository CAS, which is the other document entirely.
 *
 * CDSL and NSDL send a monthly statement covering demat holdings and mutual
 * fund folios together. Its mutual-fund rows carry the same facts as a
 * registrar's in a different order, and the first real file this parser met
 * was one of these — read as having no transactions at all.
 *
 * The shape below is that file's, with every figure, folio and identifier
 * replaced.
 */
const DEPOSITORY = [
  'Central Depository Services (India) Limited',
  'CONSOLIDATED ACCOUNT STATEMENT (CAS) FOR SECURITIES HELD IN DEMAT FORM',
  'AND INVESTMENTS IN MUTUAL FUNDS FOR THE PERIOD',
  'FROM 01-11-2022 TO 30-11-2022',
  'STATEMENT OF TRANSACTIONS FOR THE PERIOD FROM 01-11-2022 TO 30-11-2022',
  'A Fund House Mutual Fund',
  '1191 - A Fund House Bluechip Fund - Growth',
  'Folio No : 11112222/33 Mode of Holding : Single KYC of Investor/s : KYC OK Nominee : Please Nominate',
  'ISIN : INF109K01BL4 UCC : MFXXXX0000 Mobile No : Please provide Email : someone@example.test',
  'Income Capital',
  'Stamp',
  'Date Transaction Description Amount (`) NAV (`) Price (`) Units Distrib Withdr',
  'Duty (`)',
  'ution (`) awal (`)',
  'Opening Balance 2015.379',
  'SIP Purchase - Instalment',
  '07-11-2022 42/62 - ARN-0000/E000000 2999.85 69.68 69.68 43.052 .15 0 0',
  '617753219',
  'Closing Balance 2058.431',
  'A Fund House Medium Term Bond Fund - Growth',
  'Folio No : 11112222/33 Mode of Holding : Single KYC of Investor/s : KYC OK Nominee : Please Nominate',
  'ISIN : INF109K01AH4 UCC : Mobile No : Please provide Email : someone@example.test',
  'No Transaction during the period',
];

describe('a depository CAS, which prints the same facts differently', () => {
  const statement = parseEcas(DEPOSITORY);

  it('knows who issued it', () => {
    expect(statement.registrar).toBe('cdsl');
  });

  it('reads the period written in numbers', () => {
    expect(statement.period).toEqual({ from: '2022-11-01', to: '2022-11-30' });
  });

  /**
   * The scheme is printed above the folio here and below it on a registrar's
   * statement. Getting this wrong is what made three holdings come back named
   * "No Transaction during the period".
   */
  it('takes the scheme from above the folio, and the fund house from above that', () => {
    expect(statement.folios[0]?.scheme).toBe('A Fund House Bluechip Fund - Growth');
    expect(statement.folios[0]?.amc).toBe('A Fund House Mutual Fund');
    expect(statement.folios[0]?.isin).toBe('INF109K01BL4');
    expect(statement.folios[0]?.folioLast4).toBe('2233');
  });

  /**
   * The row this whole layout branch exists for. Read off the right-hand end,
   * as a registrar's row is, its four trailing figures are units, stamp duty
   * and two zeroes — so the amount would have come out as 43.05 and the units
   * as fifteen paise.
   */
  it('reads amount, NAV and units from the columns this layout puts them in', () => {
    const txn = statement.folios[0]?.transactions[0];

    expect(txn?.date).toBe('2022-11-07');
    expect(txn?.kind).toBe('purchase');
    expect(txn?.amountMinor).toBe(paise('2999.85'));
    expect(txn?.nav).toBe('69.68');
    expect(txn?.units).toBe(q('43.052'));
  });

  it('takes the description from the line above the figures', () => {
    expect(statement.folios[0]?.transactions[0]?.description).toContain('SIP Purchase - Instalment');
  });

  it('reads the closing balance this layout writes without the word "unit"', () => {
    expect(statement.folios[0]?.closingUnits).toBe(q('2058.431'));
  });

  it('leaves a quiet folio quiet rather than inventing a transaction', () => {
    expect(statement.folios[1]?.transactions).toEqual([]);
    expect(statement.folios[1]?.scheme).toBe('A Fund House Medium Term Bond Fund - Growth');
  });

  it('reads the whole statement without a line it could not account for', () => {
    expect(statement.unread).toEqual([]);
  });
});

describe('the shapes a statement arrives in', () => {
  it('reads an upper-case date, which KFintech prints', () => {
    const statement = parseEcas([
      'Folio No.: 7788990011',
      'SB0007-A Fund - Growth Registrar : KFINTECH',
      '01-APR-2025 Purchase 1,000.00 10.000 100.0000 10.000',
    ]);

    expect(statement.folios[0]?.transactions[0]?.date).toBe('2025-04-01');
    expect(statement.registrar).toBe('kfintech');
  });

  it('reads a minus sign as readily as brackets', () => {
    const statement = parseEcas([
      'Folio No: 12345678',
      'ABC0001-A Fund - Growth',
      '10-Jun-2025 Redemption -1,000.00 -10.000 100.0000 0.000',
    ]);

    const txn = statement.folios[0]?.transactions[0];
    expect(txn?.direction).toBe('out');
    expect(txn?.amountMinor).toBe(paise('1000.00'));
    expect(txn?.units).toBe(q('10.000'));
  });

  it('classifies a switch as leaving one scheme and entering another', () => {
    const statement = parseEcas([
      'Folio No: 12345678',
      'ABC0001-A Fund - Growth',
      '10-Jun-2025 Switch Out - To B Fund (1,000.00) (10.000) 100.0000 0.000',
      '10-Jun-2025 Switch In - From A Fund 1,000.00 8.000 125.0000 8.000',
    ]);

    const [out, into] = statement.folios[0]?.transactions ?? [];
    expect(out?.kind).toBe('switch_out');
    expect(out?.direction).toBe('out');
    expect(into?.kind).toBe('switch_in');
    expect(into?.direction).toBe('in');
  });

  /**
   * Both of these come from the first real statement this parser met, where
   * the published shape turned out to be a simplification.
   */
  it('takes the folio number off a line that carries half the account with it', () => {
    const statement = parseEcas([
      'Folio No: 10422158 / 45 PAN: XXXXX1234X KYC: OK Mode of Holding: Single',
      'ABC0001-A Fund - Growth Registrar : CAMS',
      '05-Apr-2024 Purchase-SIP 5,000.00 45.123 110.8100 45.123',
    ]);

    expect(statement.folios[0]?.folio).toBe('10422158 / 45');
    // Not "ngle", which is what the whole line ends in.
    expect(statement.folios[0]?.folioLast4).toBe('5845');
  });

  /**
   * A CDSL depository CAS prints 01-11-2022 where a registrar prints
   * 01-Nov-2022. A parser that knew only the second read a real file as
   * empty — every row present, every row unrecognised.
   */
  it('reads a numeric date, day first, as an Indian statement writes one', () => {
    const statement = parseEcas([
      'Folio No: 12345678',
      'ABC0001-A Fund - Growth',
      '01-11-2022 Purchase 1,000.00 10.000 100.0000 10.000',
    ]);

    expect(statement.folios[0]?.transactions[0]?.date).toBe('2022-11-01');
  });

  it('refuses a month that is not one rather than reading it as January', () => {
    const statement = parseEcas([
      'Folio No: 12345678',
      'ABC0001-A Fund - Growth',
      '01-13-2022 Purchase 1,000.00 10.000 100.0000 10.000',
    ]);

    expect(statement.folios[0]?.transactions ?? []).toEqual([]);
    expect(statement.unread).toHaveLength(1);
  });

  it('does not take "No Transaction during the period" for a scheme name', () => {
    const statement = parseEcas([
      'Folio No: 12345678 Mode of Holding: Single',
      'No Transaction during the period',
    ]);

    expect(statement.folios[0]?.scheme).toBe('');
    expect(statement.folios[0]?.transactions).toEqual([]);
  });

  it('returns nothing rather than guessing when the file is not a statement', () => {
    const statement = parseEcas(['Dear investor,', 'Thank you for your business.']);

    expect(statement.folios).toEqual([]);
    expect(statement.unread).toEqual([]);
    expect(statement.period).toBeNull();
  });
});
