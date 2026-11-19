import { describe, expect, it } from 'vitest';
import type { ParsedStatement, StatementLine } from './common.ts';
import { matchStatement, pairOwnTransfers, type ExistingEntry, type HashedLine, type KnownAccount } from './match.ts';

/**
 * What an imported line is (docs/design/spending-capture.md section 4; docs/build-plan.md step 7). One payment is one entry with up to three witnesses; a line is recognised by its
 * hash if its statement was imported before, then by its UPI reference, and only then by a near match, which waits for a person. A card repayment is never an expense, and neither is the
 * principal an EMI re-bills; its interest and GST are. Pure: lines, the household's entries and accounts in; a proposal for each line out. The data is invented.
 */
const REF_A = 'a'.repeat(64);
const REF_B = 'b'.repeat(64);

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  date: '2026-10-05',
  valueDate: null,
  direction: 'debit',
  amountMinor: 22_400n,
  raw: 'UPI-SAMPLE SHOP-SHOP@OKBANK-ABCD0000001-200000000002-NOTE',
  payee: 'SAMPLE SHOP',
  upiReference: '200000000002',
  reference: null,
  balanceMinor: null,
  hint: null,
  ...over,
});
const hashed = (n: number, over: Partial<StatementLine> = {}, refHash: string | null = null): HashedLine => ({
  line: line(over),
  lineHash: String(n).repeat(64).slice(0, 64),
  refHash,
  refLast4: refHash === null ? null : (over.upiReference ?? '200000000002').slice(-4),
});

const BANK: ParsedStatement = { kind: 'icici_savings_pdf', accountType: 'bank', last4: '4321', periodStart: null, periodEnd: null, lines: [], problems: [] };
const CARD: ParsedStatement = { kind: 'axis_card_pdf', accountType: 'card', last4: '9012', periodStart: null, periodEnd: null, lines: [], problems: [] };
const GPAY: ParsedStatement = { kind: 'gpay_pdf', accountType: 'bank', last4: null, periodStart: null, periodEnd: null, lines: [], problems: [] };

const ACCOUNTS: KnownAccount[] = [
  { id: 'acc-bank', last4: '4321', type: 'savings' },
  { id: 'acc-card', last4: '9012', type: 'card' },
];
const entry = (over: Partial<ExistingEntry> = {}): ExistingEntry => ({
  id: 'e1',
  date: '2026-10-05',
  amountMinor: 22_400n,
  currency: 'INR',
  payee: 'Typed shop',
  accountId: 'acc-bank',
  upiRefHash: null,
  witnessedBy: [],
  ...over,
});
const run = (statement: ParsedStatement, lines: HashedLine[], over: { existing?: ExistingEntry[]; known?: string[]; accounts?: KnownAccount[]; ownNames?: string[] } = {}) =>
  matchStatement({ statement, lines, accounts: over.accounts ?? ACCOUNTS, existing: over.existing ?? [], knownLineHashes: new Set(over.known ?? []), ownNames: over.ownNames ?? [] });

describe('a line seen before', () => {
  it('is recognised by its hash, and does nothing, even when its reference would match an entry', () => {
    const h = hashed(1, {}, REF_A);
    const out = run(BANK, [h], { known: [h.lineHash], existing: [entry({ upiRefHash: REF_A })] });
    expect(out.rows[0]?.proposal).toEqual({ action: 'skip', reason: 'already-imported', sure: true });
  });
});

describe('SC-I5, SC-I6 — one payment is one entry: the UPI reference merges, and a near match waits for a person', () => {
  it('adds a witness to the entry with the same UPI reference, and never makes a second entry', () => {
    const out = run(BANK, [hashed(1, {}, REF_A)], { existing: [entry({ upiRefHash: REF_A, payee: 'SAMPLE SHOP' })] });
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'witness', entryId: 'e1' });
  });

  it('fills what the entry has empty and never overwrites what is there: a typed payee stays', () => {
    const typed = run(BANK, [hashed(1, { payee: 'SAMPLE SHOP' }, REF_A)], { existing: [entry({ upiRefHash: REF_A, payee: 'Typed shop' })] });
    expect(typed.rows[0]?.proposal).toMatchObject({ action: 'witness', fill: {} });
    const empty = run(BANK, [hashed(1, { payee: 'SAMPLE SHOP' }, REF_A)], { existing: [entry({ upiRefHash: REF_A, payee: null, accountId: null })] });
    expect(empty.rows[0]?.proposal).toMatchObject({ action: 'witness', fill: { payee: 'SAMPLE SHOP', accountId: 'acc-bank' } });
  });

  it('offers the reference too, when a near match is accepted: the entry that had none takes the line’s', () => {
    const out = run(BANK, [hashed(1, { date: '2026-10-06' }, REF_A)], { existing: [entry({ date: '2026-10-05', upiRefHash: null })] });
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'suggest', entryId: 'e1', fill: { upiRefHash: REF_A, upiRefLast4: '0002' } });
  });

  it('suggests, and does not merge, a near match: the same amount and account within two days, not yet seen by this kind of statement', () => {
    const out = run(BANK, [hashed(1, { date: '2026-10-06', upiReference: null }, null)], { existing: [entry({ date: '2026-10-05' })] });
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'suggest', entryId: 'e1' });
  });

  it('does not suggest an entry with another amount, more than two days away, already seen by this kind, or with another reference', () => {
    const cases: ExistingEntry[] = [
      entry({ amountMinor: 22_500n }),
      entry({ date: '2026-10-08' }),
      entry({ witnessedBy: ['icici_savings_pdf'] }),
      entry({ upiRefHash: REF_B }),
      entry({ accountId: 'acc-card' }),
    ];
    for (const existing of cases) {
      const out = run(BANK, [hashed(1, { upiReference: null }, REF_A)], { existing: [existing] });
      expect(out.rows[0]?.proposal.action, JSON.stringify(existing, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).toBe('create');
    }
  });

  it('offers an entry to one line only: the second of two like lines is a new entry', () => {
    const out = run(BANK, [hashed(1, { upiReference: null }), hashed(2, { upiReference: null })], { existing: [entry()] });
    expect(out.rows.map((row) => row.proposal.action)).toEqual(['suggest', 'create']);
  });

  it('offers the nearest entry in date when more than one fits', () => {
    const out = run(BANK, [hashed(1, { date: '2026-10-05', upiReference: null })], { existing: [entry({ id: 'far', date: '2026-10-07' }), entry({ id: 'near', date: '2026-10-05' })] });
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'suggest', entryId: 'near' });
  });
});

describe('a new entry', () => {
  it('is a UPI payment from the statement’s account, with the reference as a last four and a hash, and the payee the statement gives', () => {
    const out = run(BANK, [hashed(1, {}, REF_A)]);
    expect(out.rows[0]?.proposal).toMatchObject({
      action: 'create',
      entry: { date: '2026-10-05', amountMinor: 22_400n, currency: 'INR', payee: 'SAMPLE SHOP', accountId: 'acc-bank', method: 'upi', upiRefLast4: '0002', upiRefHash: REF_A, sourceHash: '1'.repeat(64) },
    });
  });

  it('is a card payment on a card statement, from the card account', () => {
    const out = run(CARD, [hashed(1, { raw: 'SAMPLE HOTEL,TOWN', payee: 'SAMPLE HOTEL', upiReference: null, hint: 'HOTELS' })]);
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'create', entry: { method: 'card', accountId: 'acc-card', hint: 'HOTELS' } });
  });

  it('carries no account when the file names none, and asks for none to be added', () => {
    const out = run({ ...BANK, last4: null, kind: 'hdfc_delimited' }, [hashed(1)]);
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'create', entry: { accountId: null, accountLast4: null } });
    expect(out.accountsToAdd).toEqual([]);
  });
});

describe('what is not an expense', () => {
  it('a card repayment is never an expense: the payment line on a card statement is skipped', () => {
    const out = run(CARD, [hashed(1, { direction: 'credit', raw: 'BBPS PAYMENT RECEIVED - REF0000000001', payee: null, upiReference: null })]);
    expect(out.rows[0]?.proposal).toEqual({ action: 'skip', reason: 'card-payment', sure: true });
  });

  it('and a bank line that looks like paying a card is proposed as a skip, which is a guess a person can change', () => {
    for (const raw of ['CREDIT CARD PAYMENT SAMPLE', 'UPI-CRED-CRED@AXISB-AXIS0000001-300000000003-CARDBILL', 'AUTOPAY CARD BILL']) {
      const out = run(BANK, [hashed(1, { raw, payee: null, upiReference: null })]);
      expect(out.rows[0]?.proposal, raw).toMatchObject({ action: 'skip', reason: 'card-payment', sure: false, entry: { amountMinor: 22_400n } });
    }
  });

  it('a credit on a card that is not a payment (a refund, a cashback) is not imported as an expense, and says why', () => {
    const out = run(CARD, [hashed(1, { direction: 'credit', raw: 'FUEL CASHBACK REBATES', payee: null, upiReference: null })]);
    expect(out.rows[0]?.proposal).toEqual({ action: 'skip', reason: 'card-credit', sure: true });
  });

  it('the principal an EMI re-bills is skipped, and its interest and GST are expenses', () => {
    const principal = run(CARD, [hashed(1, { raw: 'Principal Amount Amortization - <2/6>RAZ*SAMPLE', payee: null, upiReference: null })]);
    expect(principal.rows[0]?.proposal).toEqual({ action: 'skip', reason: 'emi-principal', sure: true });
    for (const raw of ['Interest Amount Amortization - <2/6>RAZ*SAMPLE', 'IGST-CI@18%']) {
      const out = run(CARD, [hashed(1, { raw, payee: null, upiReference: null })]);
      expect(out.rows[0]?.proposal, raw).toMatchObject({ action: 'create', entry: { hint: 'Interest and charges' } });
    }
  });

  it('money in on a bank statement is not imported as spending, and says so', () => {
    const out = run(BANK, [hashed(1, { direction: 'credit', raw: 'SALARY CREDIT SAMPLE EMPLOYER', payee: null, upiReference: null })]);
    expect(out.rows[0]?.proposal).toEqual({ action: 'skip', reason: 'money-in', sure: true });
  });

  it('a debit to a broker or a fund house is a purchase to link, and is proposed as a skip, a guess', () => {
    for (const raw of ['UPI-SAMPLEMONEY-SAMPLEMONEY.PAYU@BANK-ABCD0000001-400000000004-UPIINTENT'.replace('SAMPLEMONEY', 'INDMONEY'), 'NEFT DR-ABCD0000001-ZERODHA BROKING-NETBANK-REF1', 'ACH D- GROWW MUTUAL FUND-REF2']) {
      const out = run(BANK, [hashed(1, { raw, payee: null, upiReference: null })]);
      expect(out.rows[0]?.proposal, raw).toMatchObject({ action: 'skip', reason: 'investment', sure: false, entry: { amountMinor: 22_400n } });
    }
  });

  it('a transfer to one’s own account that the statement says in words is skipped, and so is money received on Google Pay', () => {
    const own = run(GPAY, [hashed(1, { raw: 'Self transfer to ICICI Bank 4321', payee: null, selfTransferToLast4: '4321', fromLast4: '9012' })]);
    expect(own.rows[0]?.proposal).toEqual({ action: 'skip', reason: 'own-transfer', sure: true });
    const received = run(GPAY, [hashed(1, { direction: 'credit', raw: 'Received from SAMPLE PERSON', fromLast4: '4321' })]);
    expect(received.rows[0]?.proposal).toEqual({ action: 'skip', reason: 'money-in', sure: true });
  });
});

describe('accounts', () => {
  it('takes the account of each Google Pay line from the account it was paid from', () => {
    const out = run(GPAY, [hashed(1, { fromLast4: '4321' }), hashed(2, { fromLast4: '9012', raw: 'Paid to X', upiReference: null })]);
    expect(out.rows.map((row) => (row.proposal.action === 'create' ? row.proposal.entry.accountId : null))).toEqual(['acc-bank', 'acc-card']);
  });

  it('names the accounts a statement uses that the household does not have, once each, to be added', () => {
    const out = run(GPAY, [hashed(1, { fromLast4: '7777' }), hashed(2, { fromLast4: '7777', raw: 'Paid to Y', upiReference: null }), hashed(3, { fromLast4: '8888', raw: 'Paid to Z', upiReference: null })], { accounts: [] });
    expect(out.accountsToAdd).toEqual([
      { last4: '7777', type: 'savings', institution: null },
      { last4: '8888', type: 'savings', institution: null },
    ]);
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'create', entry: { accountId: null, accountLast4: '7777' } });
  });

  it('names the account of a bank or card statement, with the bank from the format', () => {
    expect(run(BANK, [hashed(1)], { accounts: [] }).accountsToAdd).toEqual([{ last4: '4321', type: 'savings', institution: 'ICICI Bank' }]);
    expect(run(CARD, [hashed(1, { upiReference: null })], { accounts: [] }).accountsToAdd).toEqual([{ last4: '9012', type: 'card', institution: 'Axis Bank' }]);
  });
});

describe('moves between the household’s own accounts, across the statements read together', () => {
  const side = (id: string, account: string, direction: 'debit' | 'credit', date = '2026-10-08', amount = 5_000_000n) => ({ id, account, line: line({ direction, date, amountMinor: amount }) });

  it('pairs a debit on one account with a credit of the same amount on another within a day, as a guess', () => {
    const pairs = pairOwnTransfers([side('a', 'hdfc', 'debit'), side('b', 'icici', 'credit', '2026-10-09')]);
    expect(pairs.get('a')).toBe('b');
    expect(pairs.get('b')).toBe('a');
  });

  it('does not pair two lines of one account, an amount that differs, a day too far, or the same direction', () => {
    expect(pairOwnTransfers([side('a', 'hdfc', 'debit'), side('b', 'hdfc', 'credit')]).size).toBe(0);
    expect(pairOwnTransfers([side('a', 'hdfc', 'debit'), side('b', 'icici', 'credit', '2026-10-08', 4_000_000n)]).size).toBe(0);
    expect(pairOwnTransfers([side('a', 'hdfc', 'debit'), side('b', 'icici', 'credit', '2026-10-12')]).size).toBe(0);
    expect(pairOwnTransfers([side('a', 'hdfc', 'debit'), side('b', 'icici', 'debit')]).size).toBe(0);
  });

  it('uses each line once, nearest in date first', () => {
    const pairs = pairOwnTransfers([side('d1', 'hdfc', 'debit', '2026-10-08'), side('c1', 'icici', 'credit', '2026-10-09'), side('c2', 'icici', 'credit', '2026-10-08')]);
    expect(pairs.get('d1')).toBe('c2');
    expect(pairs.has('c1')).toBe(false);
  });
});

describe('review: a move to one of the household’s own names is a guess that it is not spending', () => {
  const own = (payee: string, ownNames: string[] = ['Venkatesh']) => run({ ...BANK }, [hashed(1, { payee, raw: `NEFT DR-ABCD0000001-${payee}-NETBANK-REF1`, upiReference: null })], { ownNames });

  it('proposes skipping a debit to a payee that begins with a household member’s name, and carries the entry so a person can overrule it', () => {
    expect(own('VENKATESH NARAYANASA').rows[0]?.proposal).toMatchObject({ action: 'skip', reason: 'own-transfer', sure: false, entry: { amountMinor: 22_400n } });
    expect(own('Venkatesh Stores').rows[0]?.proposal).toMatchObject({ action: 'skip', reason: 'own-transfer', sure: false });
  });

  it('does not take a different name, a name that only contains theirs, or a short one for the household’s', () => {
    expect(own('SAMPLE SHOP').rows[0]?.proposal.action).toBe('create');
    expect(own('NEW VENKATESH TRADERS').rows[0]?.proposal.action).toBe('create');
    expect(own('VENKATESH', ['Ven']).rows[0]?.proposal.action).toBe('create');
  });
});

describe('review: what an entry is written with', () => {
  it('takes the readable text of a line that names no payee as its payee, with any VPA taken out, and the statement’s hint as its note', () => {
    const out = run(CARD, [hashed(1, { payee: null, raw: 'POS SAMPLE STORE CITY SHOP@OKBANK 1234', upiReference: null, hint: 'HOTELS' })]);
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'create', entry: { payee: 'POS SAMPLE STORE CITY 1234', note: 'HOTELS' } });
    expect(JSON.stringify(out.rows[0]?.proposal, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('@');
  });

  it('keeps the payee the statement gave', () => {
    expect(run(BANK, [hashed(1, {})]).rows[0]?.proposal).toMatchObject({ entry: { payee: 'SAMPLE SHOP', note: null } });
  });
});

describe('review: a UPI app’s readable name improves a name a bank cut short, and never a typed one', () => {
  const gpayLine = (payee: string) => hashed(1, { payee, raw: `Paid to ${payee}`, fromLast4: '4321' }, REF_A);

  it('replaces a payee that is the beginning of the readable name, saying which payee it replaces', () => {
    const out = run(GPAY, [gpayLine('HOTEL ARIYAS VEG')], { existing: [entry({ upiRefHash: REF_A, payee: 'HOTEL ARIY' })] });
    expect(out.rows[0]?.proposal).toMatchObject({ action: 'witness', fill: { payee: 'HOTEL ARIYAS VEG', payeeFrom: 'HOTEL ARIY' } });
  });

  it('leaves a payee that is a different name, one too short to be a cut-short name, and a bank statement’s own line', () => {
    const different = run(GPAY, [gpayLine('HOTEL ARIYAS VEG')], { existing: [entry({ upiRefHash: REF_A, payee: 'Typed shop' })] });
    expect(different.rows[0]?.proposal).toMatchObject({ action: 'witness', fill: {} });
    const short = run(GPAY, [gpayLine('HOTEL ARIYAS VEG')], { existing: [entry({ upiRefHash: REF_A, payee: 'Hotel' })] });
    expect(short.rows[0]?.proposal).toMatchObject({ action: 'witness', fill: {} });
    const bank = run(BANK, [hashed(1, { payee: 'HOTEL ARIYAS VEG' }, REF_A)], { existing: [entry({ upiRefHash: REF_A, payee: 'HOTEL ARIY' })] });
    expect(bank.rows[0]?.proposal).toMatchObject({ action: 'witness', fill: {} });
  });
});

describe('review: only card repayments are taken for card repayments', () => {
  it('does not take a UPI AutoPay mandate for one, and still takes a card’s autopay', () => {
    expect(run(BANK, [hashed(1, { raw: 'UPI AUTOPAY MANDATE SAMPLE STREAMING', payee: null, upiReference: null })]).rows[0]?.proposal.action).toBe('create');
    expect(run(BANK, [hashed(1, { raw: 'CARD AUTOPAY SAMPLE', payee: null, upiReference: null })]).rows[0]?.proposal).toMatchObject({ action: 'skip', reason: 'card-payment', sure: false });
  });
});
