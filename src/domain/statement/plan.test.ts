import { describe, expect, it } from 'vitest';
import type { StatementLine } from './common.ts';
import type { MatchedRow, NewCredit, NewEntry, Proposal } from './match.ts';
import { allowedDecisions, creditVisibility, defaultDecision, personalCredits, planImport, skipWords } from './plan.ts';

/**
 * What an import will write, from what the matcher proposed and what a person decided (docs/design/spending-capture.md section 4; docs/build-plan.md step 7). Every row can be
 * changed before anything is written. A suggestion waits for a person and blocks the import until it has an answer; a skip that is a guess can be overruled; a skip the statement
 * itself makes sure of cannot; and a line that merges by reference cannot be made a second entry.
 */
const LINE: StatementLine = {
  date: '2026-10-05', valueDate: null, direction: 'debit', amountMinor: 22_400n, raw: 'RAW', payee: 'SHOP', upiReference: null, reference: null, balanceMinor: null, hint: null,
};
const ENTRY: NewEntry = {
  date: '2026-10-05', amountMinor: 22_400n, currency: 'INR', payee: 'SHOP', accountId: 'acc', accountLast4: '4321', method: null, upiRefLast4: null, upiRefHash: null, sourceHash: 'h'.repeat(64), hint: null, note: null,
};
const CREDIT_LINE: NewCredit = {
  date: '2026-10-05', amountMinor: 4_500_000n, currency: 'INR', payer: 'EMPLOYER', accountId: 'acc', accountLast4: '4321', category: 'salary', sourceHash: 'c'.repeat(64),
};
const MONEY_IN: Proposal = { action: 'credit', credit: CREDIT_LINE };
const TYPED: Proposal = { action: 'skip', reason: 'credit-typed', sure: false, credit: CREDIT_LINE };
const row = (proposal: Proposal): MatchedRow => ({ line: LINE, lineHash: 'h'.repeat(64), proposal });

const CREATE: Proposal = { action: 'create', entry: ENTRY };
const WITNESS: Proposal = { action: 'witness', entryId: 'e1', fill: { payee: 'SHOP' } };
const SUGGEST: Proposal = { action: 'suggest', entryId: 'e1', fill: {}, entry: ENTRY };
const GUESS: Proposal = { action: 'skip', reason: 'card-payment', sure: false, entry: ENTRY };
const SURE: Proposal = { action: 'skip', reason: 'emi-principal', sure: true };
const SEEN: Proposal = { action: 'skip', reason: 'already-imported', sure: true };

describe('the default for each proposal', () => {
  it('creates a new entry, merges a reference match, skips what is not an expense, and leaves a suggestion for a person', () => {
    expect(defaultDecision(CREATE)).toBe('create');
    expect(defaultDecision(WITNESS)).toBe('merge');
    expect(defaultDecision(GUESS)).toBe('skip');
    expect(defaultDecision(SURE)).toBe('skip');
    expect(defaultDecision(SEEN)).toBe('skip');
    expect(defaultDecision(SUGGEST)).toBeNull();
  });
});

describe('what a person may decide', () => {
  it('may skip a new entry, skip or leave a reference match, answer a suggestion any of three ways, and overrule a guess', () => {
    expect(allowedDecisions(CREATE)).toEqual(['create', 'skip']);
    expect(allowedDecisions(WITNESS)).toEqual(['merge', 'skip']);
    expect(allowedDecisions(SUGGEST)).toEqual(['merge', 'create', 'skip']);
    expect(allowedDecisions(GUESS)).toEqual(['skip', 'create']);
  });

  it('may not overrule what the statement is sure of, or a line already imported', () => {
    expect(allowedDecisions(SURE)).toEqual(['skip']);
    expect(allowedDecisions(SEEN)).toEqual(['skip']);
  });
});

describe('the plan', () => {
  it('writes the entries to create and the witnesses to add, and counts what it leaves', () => {
    const plan = planImport([row(CREATE), row(WITNESS), row(SURE), row(SEEN), row(GUESS)], new Map());
    expect(plan.writes.map((write) => [write.kind, write.index])).toEqual([['create', 0], ['witness', 1]]);
    expect(plan.counts).toEqual({ create: 1, credit: 0, move: 0, witness: 1, skip: 3, undecided: 0 });
    expect(plan.canCommit).toBe(true);
  });

  it('waits for an answer to a suggestion, and cannot be committed until it has one', () => {
    const plan = planImport([row(CREATE), row(SUGGEST)], new Map());
    expect(plan.undecided).toEqual([1]);
    expect(plan.canCommit).toBe(false);
  });

  it('takes a person’s answer to a suggestion: merge into the entry, or make a new one', () => {
    const merged = planImport([row(SUGGEST)], new Map([[0, 'merge' as const]]));
    expect(merged.writes).toEqual([{ kind: 'witness', index: 0, line: LINE, lineHash: 'h'.repeat(64), entryId: 'e1', fill: {} }]);
    const made = planImport([row(SUGGEST)], new Map([[0, 'create' as const]]));
    expect(made.writes[0]).toMatchObject({ kind: 'create', index: 0, entry: ENTRY });
  });

  it('imports a line that was proposed as a skip when the person overrules a guess', () => {
    const plan = planImport([row(GUESS)], new Map([[0, 'create' as const]]));
    expect(plan.writes[0]).toMatchObject({ kind: 'create', entry: ENTRY });
  });

  it('lets a person skip a line that would have been written', () => {
    const plan = planImport([row(CREATE), row(WITNESS)], new Map([[0, 'skip' as const], [1, 'skip' as const]]));
    expect(plan.writes).toEqual([]);
    expect(plan.counts.skip).toBe(2);
    expect(plan.canCommit).toBe(false);
  });

  it('ignores a decision that is not allowed: a sure skip stays skipped, and a reference match is not made a second entry', () => {
    const plan = planImport([row(SURE), row(WITNESS), row(SEEN)], new Map([[0, 'create' as const], [1, 'create' as const], [2, 'create' as const]]));
    expect(plan.writes.map((write) => write.kind)).toEqual(['witness']);
  });

  it('has nothing to commit when nothing would be written', () => {
    expect(planImport([row(SURE), row(SEEN)], new Map()).canCommit).toBe(false);
    expect(planImport([], new Map()).canCommit).toBe(false);
  });
});

describe('money in', () => {
  it('is added by default, can be left out, and a guess that it is not money in can be overruled', () => {
    expect(defaultDecision(MONEY_IN)).toBe('create');
    expect(allowedDecisions(MONEY_IN)).toEqual(['create', 'skip']);
    // Money in that may be one the household already has waits for a person, as a near match does: a credit wrongly left out reads as spending low.
    expect(defaultDecision(TYPED)).toBeNull();
    expect(allowedDecisions(TYPED)).toEqual(['skip', 'create']);
    expect(planImport([row(TYPED)], new Map()).canCommit).toBe(false);
    expect(planImport([row(TYPED)], new Map()).undecided).toEqual([0]);
    expect(planImport([row(TYPED)], new Map([[0, 'skip' as const]])).nothingToWrite).toBe(true);
  });

  it('is written as a credit with the category the line suggested, or the one a person chose, and counted apart from expenses', () => {
    const plan = planImport([row(MONEY_IN), row(MONEY_IN), row(CREATE)], new Map(), new Map([[1, 'interest'], [2, 'groceries']]));
    expect(plan.writes.map((write) => (write.kind === 'credit' ? write.category : write.kind))).toEqual(['salary', 'interest', 'create']);
    expect(plan.counts).toMatchObject({ create: 1, credit: 2, witness: 0 });
  });

  it('ignores a category that is not one of the ledger’s, rather than writing it', () => {
    const plan = planImport([row(MONEY_IN)], new Map(), new Map([[0, 'not-a-category']]));
    expect(plan.writes[0]).toMatchObject({ kind: 'credit', category: 'salary' });
  });

  it('is written when a person says a guessed skip was money in after all, and not otherwise', () => {
    expect(planImport([row(TYPED)], new Map([[0, 'create' as const]])).writes).toHaveLength(1);
    expect(planImport([row(TYPED)], new Map()).writes).toHaveLength(0);
  });
});

describe('who can see money in', () => {
  it('is private to whoever it came to, except a refund, which is the household\'s, unless the whole import is kept private', () => {
    expect(creditVisibility('salary', 'household')).toBe('personal');
    expect(creditVisibility('refund', 'household')).toBe('household');
    expect(creditVisibility('refund', 'personal')).toBe('personal');
    expect(creditVisibility('interest', 'personal')).toBe('personal');
  });

  it('counts the credits that only the person they are under can write, so an import for someone else can say so before anything is written', () => {
    const plan = planImport([row(MONEY_IN), row(MONEY_IN), row(CREATE)], new Map([]), new Map([[1, 'refund']]));
    expect(personalCredits(plan.writes, 'household')).toBe(1);
    expect(personalCredits(plan.writes, 'personal')).toBe(2);
    expect(personalCredits(planImport([row(CREATE)], new Map()).writes, 'personal')).toBe(0);
  });
});

describe('the category of what is created', () => {
  it('goes with a new entry, from what the person chose, and is nothing when none was', () => {
    const plan = planImport([row(CREATE), row(CREATE)], new Map(), new Map([[1, 'groceries']]));
    expect(plan.writes.map((write) => (write.kind === 'create' ? write.categoryId : 'x'))).toEqual([null, 'groceries']);
  });

  it('goes with an entry made from a suggestion or an overruled guess, and not with a merge', () => {
    const plan = planImport([row(SUGGEST), row(GUESS), row(WITNESS)], new Map([[0, 'create' as const], [1, 'create' as const]]), new Map([[0, 'fuel'], [1, 'fuel'], [2, 'fuel']]));
    expect(plan.writes.map((write) => (write.kind === 'create' ? write.categoryId : 'merge'))).toEqual(['fuel', 'fuel', 'merge']);
  });
});

describe('when there is nothing to write', () => {
  it('says so only when every suggestion is answered and nothing would be written, which is a re-imported statement or one that is all left out', () => {
    expect(planImport([row(SURE), row(SEEN)], new Map()).nothingToWrite).toBe(true);
    expect(planImport([], new Map()).nothingToWrite).toBe(true);
    expect(planImport([row(CREATE)], new Map()).nothingToWrite).toBe(false);
    expect(planImport([row(SUGGEST)], new Map()).nothingToWrite).toBe(false);
  });
});

describe('saying why a line is skipped', () => {
  it('says each reason in words, and whether it is a guess a person can change', () => {
    expect(skipWords('card-payment', true)).toBe('A card repayment. What it paid for was recorded when it was bought.');
    expect(skipWords('card-payment', false)).toBe('Looks like a card repayment, which is not an expense. Import it if it is not.');
    expect(skipWords('emi-principal', true)).toBe('The price of a purchase the card turned into an EMI, which was recorded when it was bought. The interest and tax on it are imported.');
    expect(skipWords('already-imported', true)).toBe('Already imported from this statement.');
    expect(skipWords('money-in', true)).toBe('Money received on a UPI app. It is imported from the bank statement it arrives on.');
    expect(skipWords('own-transfer', true)).toBe('A move between your own accounts, which is not spending.');
    expect(skipWords('investment', false)).toBe('Looks like money put into an investment, which is a purchase to link in Holdings and not an expense. Import it if it is not.');
    expect(skipWords('credit-typed', false)).toBe('Looks like money in you already have. Is it the same?');
    expect(skipWords('loan-money', false, true)).toBe('Looks like a loan paid out to you, which is not income. Add it if it is.');
    expect(skipWords('investment', false, true)).toBe('Looks like money back from an investment, which is not income. Add it if it is.');
    expect(skipWords('own-transfer', false, true)).toBe('Looks like money from your own account, which is not income. Add it if it is.');
  });
});
