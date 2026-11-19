/**
 * What an imported line is (docs/design/spending-capture.md section 4; docs/build-plan.md step 7).
 *
 * A payment is **one entry with up to three witnesses**: the same Rs 642 can arrive on a bank statement, a Google Pay statement and a card statement, and it is one expense. For
 * each line of a statement this says what to do, strongest evidence first:
 *   1. the line's hash is one already recorded: the statement was imported before, and nothing is done;
 *   2. its UPI reference is the reference of an entry: a witness is added to that entry, and what the entry has empty is filled (a UPI statement's readable payee for a bank's
 *      narration), never what it has;
 *   3. a **near match**, the same amount and account within two days, not yet seen by this kind of statement: a *suggestion* that waits for a person (two Rs 500 payments on
 *      consecutive days are common), and an entry is offered to one line only;
 *   4. otherwise a new entry.
 * And some lines are not expenses at all, and are skipped with the reason said: a card repayment (the purchases were recorded when they happened), the principal an EMI re-bills
 * (the purchase was), money in, a debit to a broker or a fund house (a purchase to link, not spending), and a move between the household's own accounts. A skip says whether it is
 * *sure*, from the statement's own words, or a guess from the text, which a person can change in the preview. An EMI's interest and GST are expenses. The accounts a statement uses that
 * the household does not have are named, to be added. Pure: nothing is read or written here.
 */

import type { IsoDate } from '../../lib/dates.ts';
import { readableText, type ParsedStatement, type StatementKind, type StatementLine } from './common.ts';
import { normalisePayee } from './suggestCategory.ts';

/** A line with what is worked out from it on the device: the hash that recognises it, and its UPI reference as a hash and a last four (SC-I8). */
export interface HashedLine {
  readonly line: StatementLine;
  readonly lineHash: string;
  readonly refHash: string | null;
  readonly refLast4: string | null;
}

/** An entry the household has, as far as matching needs it. */
export interface ExistingEntry {
  readonly id: string;
  readonly date: IsoDate;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly payee: string | null;
  readonly accountId: string | null;
  readonly upiRefHash: string | null;
  /** The kinds of statement that have already witnessed it. */
  readonly witnessedBy: readonly StatementKind[];
}

export interface KnownAccount {
  readonly id: string;
  readonly last4: string | null;
  readonly type: 'savings' | 'current' | 'card';
}

export type SkipReason = 'already-imported' | 'card-payment' | 'card-credit' | 'emi-principal' | 'money-in' | 'investment' | 'own-transfer';

export interface NewEntry {
  readonly date: IsoDate;
  readonly amountMinor: bigint;
  readonly currency: 'INR';
  readonly payee: string | null;
  /** The account it was paid from, when the household has it. */
  readonly accountId: string | null;
  /** The last four of the account the line names, whether or not the household has it yet, so it can be added and the entry attached to it. */
  readonly accountLast4: string | null;
  readonly method: 'upi' | 'card' | null;
  readonly upiRefLast4: string | null;
  readonly upiRefHash: string | null;
  /** The hash of the line that makes it, which recognises the line when its statement is imported again. */
  readonly sourceHash: string;
  /** What the statement says of the kind of spend: a merchant category, a UPI note, or *Interest and charges*. A hint for a suggestion and never a category. */
  readonly hint: string | null;
  /** The note the entry is written with: the hint, a field the parser extracted and the capture rule says is written (detail-level.md section 4). */
  readonly note: string | null;
}

/** What an entry has empty and the line can fill. Never a field that has a value. */
export interface Fill {
  /** A payee for an entry that has none, or, with `payeeFrom`, a readable name for one a bank cut short. */
  readonly payee?: string;
  /** The payee this replaces: the update applies only while the entry still has it, so a name a person has changed since is never overwritten. */
  readonly payeeFrom?: string;
  readonly accountId?: string;
  readonly upiRefLast4?: string;
  readonly upiRefHash?: string;
}

export type Proposal =
  | { readonly action: 'create'; readonly entry: NewEntry }
  | { readonly action: 'witness'; readonly entryId: string; readonly fill: Fill }
  /** A near match: waits for a person, and is a new entry if they decline. */
  | { readonly action: 'suggest'; readonly entryId: string; readonly fill: Fill; readonly entry: NewEntry }
  /** A skip that is a guess carries the entry it would be, so a person who disagrees can import the line after all. A sure skip is not an expense and carries none. */
  | { readonly action: 'skip'; readonly reason: SkipReason; readonly sure: boolean; readonly entry?: NewEntry };

export interface MatchedRow {
  readonly line: StatementLine;
  readonly lineHash: string;
  readonly proposal: Proposal;
}

export interface AccountToAdd {
  readonly last4: string;
  readonly type: 'savings' | 'card';
  readonly institution: string | null;
}

export interface MatchResult {
  readonly rows: readonly MatchedRow[];
  readonly accountsToAdd: readonly AccountToAdd[];
}

/** How far apart, in days, a statement's date and an entry's may be for a near match. */
const NEAR_DAYS = 2;
/** The shortest a first name may be to be taken for a household member's, and the shortest a payee may be, once normalised, to be taken for a bank's cut-short form of a readable name. */
const OWN_NAME_FROM = 4;
const CUT_SHORT_FROM = 6;

const CARD_PAYMENT_ON_CARD = /\b(payment\s+(received|recd|thank)|bbps\s+payment|auto\s*debit\s+payment|neft\s+payment|upi\s+payment\s+received)\b/i;
const CARD_PAYMENT_ON_BANK = /(credit\s*card|\bcc\s*pay|card\s*bill|card\s*payment|card\s*autopay|autopay\s*card|\bCRED\b)/i;
const INVESTMENT = /(indmoney|zerodha|groww|kuvera|\bcoin\b|clearing\s*corp|\bnsdl\b|\bcdsl\b|mutual\s*fund|\bsip\b|\biccl\b|\bnps\b)/i;
const EMI_PRINCIPAL = /principal\s+amount\s+amortization/i;
const EMI_COST = /(interest\s+amount\s+amortization|\bigst\b|\bcgst\b|\bsgst\b|processing\s+fee|late\s+payment|finance\s+charge)/i;

const INSTITUTION: Partial<Record<StatementKind, string>> = {
  hdfc_delimited: 'HDFC Bank',
  hdfc_text: 'HDFC Bank',
  icici_savings_pdf: 'ICICI Bank',
  icici_card_pdf: 'ICICI Bank',
  axis_card_pdf: 'Axis Bank',
};

const DAY = 86_400_000;
const daysApart = (a: IsoDate, b: IsoDate): number => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY));

/** What to do with a line that is not a new expense, from what the statement says; null when it is one. */
function skipFor(statement: ParsedStatement, line: StatementLine, ownFirstNames: ReadonlySet<string>): Proposal | null {
  const text = line.raw;
  if (statement.kind === 'gpay_pdf') {
    if (line.selfTransferToLast4 !== undefined) return { action: 'skip', reason: 'own-transfer', sure: true };
    if (line.direction === 'credit') return { action: 'skip', reason: 'money-in', sure: true };
    return null;
  }
  if (statement.accountType === 'card') {
    if (line.direction === 'credit') return CARD_PAYMENT_ON_CARD.test(text) ? { action: 'skip', reason: 'card-payment', sure: true } : { action: 'skip', reason: 'card-credit', sure: true };
    if (EMI_PRINCIPAL.test(text)) return { action: 'skip', reason: 'emi-principal', sure: true };
    return null;
  }
  if (line.direction === 'credit') return { action: 'skip', reason: 'money-in', sure: true };
  if (CARD_PAYMENT_ON_BANK.test(text)) return { action: 'skip', reason: 'card-payment', sure: false };
  // A move to a payee whose first word is a household member's first name is a guess that it is to themselves: shown unfolded, and a person can overrule it.
  const payeeFirst = line.payee === null ? '' : normalisePayee(line.payee.split(/\s+/)[0] ?? '');
  if (payeeFirst.length >= OWN_NAME_FROM && ownFirstNames.has(payeeFirst)) return { action: 'skip', reason: 'own-transfer', sure: false };
  if (INVESTMENT.test(text)) return { action: 'skip', reason: 'investment', sure: false };
  return null;
}

export function matchStatement(input: {
  readonly statement: ParsedStatement;
  readonly lines: readonly HashedLine[];
  readonly accounts: readonly KnownAccount[];
  readonly existing: readonly ExistingEntry[];
  readonly knownLineHashes: ReadonlySet<string>;
  /** The household members' names, so a move to oneself can be guessed from a payee that begins with one. */
  readonly ownNames?: readonly string[];
}): MatchResult {
  const { statement, accounts } = input;
  const ownFirstNames = new Set((input.ownNames ?? []).map((name) => normalisePayee(name.trim().split(/\s+/)[0] ?? '')).filter((first) => first.length >= OWN_NAME_FROM));
  const byLast4 = (last4: string | null | undefined): KnownAccount | undefined => (last4 === null || last4 === undefined ? undefined : accounts.find((account) => account.last4 === last4));
  const toAdd = new Map<string, AccountToAdd>();
  const claimed = new Set<string>();

  /** The account a line was paid from: the statement's, or for a UPI app's statement the line's own. */
  const accountOf = (line: StatementLine): { readonly id: string | null; readonly last4: string | null } => {
    const last4 = statement.kind === 'gpay_pdf' ? (line.fromLast4 ?? null) : statement.last4;
    if (last4 === null) return { id: null, last4: null };
    const known = byLast4(last4);
    if (known === undefined && !toAdd.has(last4)) {
      toAdd.set(last4, { last4, type: statement.kind !== 'gpay_pdf' && statement.accountType === 'card' ? 'card' : 'savings', institution: INSTITUTION[statement.kind] ?? null });
    }
    return { id: known?.id ?? null, last4 };
  };

  const rows = input.lines.map((hashed): MatchedRow => {
    const { line } = hashed;
    const done = (proposal: Proposal): MatchedRow => ({ line, lineHash: hashed.lineHash, proposal });

    if (input.knownLineHashes.has(hashed.lineHash)) return done({ action: 'skip', reason: 'already-imported', sure: true });
    const skip = skipFor(statement, line, ownFirstNames);
    if (skip !== null && skip.action === 'skip' && skip.sure) return done(skip);

    const account = accountOf(line);
    const entry: NewEntry = {
      date: line.date,
      amountMinor: line.amountMinor,
      currency: 'INR',
      // The name the statement gives, or what it printed with any VPA taken out: the preview shows that name, so it is what is written.
      payee: line.payee ?? readableText(line.raw),
      accountId: account.id,
      accountLast4: account.last4,
      method: line.upiReference !== null ? 'upi' : statement.accountType === 'card' ? 'card' : null,
      upiRefLast4: hashed.refLast4,
      upiRefHash: hashed.refHash,
      sourceHash: hashed.lineHash,
      hint: EMI_COST.test(line.raw) && statement.accountType === 'card' ? 'Interest and charges' : line.hint,
      note: line.hint,
    };

    if (skip !== null && skip.action === 'skip') return done({ ...skip, entry });

    // What the line can fill in an entry: only what the entry has empty.
    // A UPI app's statement gives a readable name where a bank cut one short: an entry's payee that is the beginning of the readable name is replaced by it (spending-capture.md
    // section 3), and a payee that is anything else is left.
    const readable = (existing: ExistingEntry): Fill => {
      if (statement.kind !== 'gpay_pdf' || existing.payee === null || line.payee === null) return {};
      const had = normalisePayee(existing.payee);
      const now = normalisePayee(line.payee);
      return had.length >= CUT_SHORT_FROM && now.length > had.length && now.startsWith(had) ? { payee: line.payee, payeeFrom: existing.payee } : {};
    };
    const fillFor = (existing: ExistingEntry): Fill => ({
      ...(existing.payee === null && line.payee !== null ? { payee: line.payee } : readable(existing)),
      ...(existing.accountId === null && account.id !== null ? { accountId: account.id } : {}),
      ...(existing.upiRefHash === null && hashed.refHash !== null && hashed.refLast4 !== null ? { upiRefHash: hashed.refHash, upiRefLast4: hashed.refLast4 } : {}),
    });

    // 2. The UPI reference: an exact match merges.
    if (hashed.refHash !== null) {
      const byRef = input.existing.find((existing) => existing.upiRefHash === hashed.refHash && !claimed.has(existing.id));
      if (byRef !== undefined) {
        claimed.add(byRef.id);
        return done({ action: 'witness', entryId: byRef.id, fill: fillFor(byRef) });
      }
    }

    // 3. A near match waits for a person, and an entry is offered to one line only.
    const near = input.existing
      .filter(
        (existing) =>
          !claimed.has(existing.id) &&
          existing.amountMinor === line.amountMinor &&
          existing.currency === 'INR' &&
          daysApart(existing.date, line.date) <= NEAR_DAYS &&
          !existing.witnessedBy.includes(statement.kind) &&
          (existing.accountId === null || account.id === null || existing.accountId === account.id) &&
          (existing.upiRefHash === null || hashed.refHash === null || existing.upiRefHash === hashed.refHash),
      )
      .sort((a, b) => daysApart(a.date, line.date) - daysApart(b.date, line.date))[0];
    if (near !== undefined) {
      claimed.add(near.id);
      return done({ action: 'suggest', entryId: near.id, fill: fillFor(near), entry });
    }

    return done({ action: 'create', entry });
  });

  return { rows, accountsToAdd: [...toAdd.values()] };
}

/**
 * Moves between the household's own accounts, across the statements read together: a debit on one account and a credit of the same amount on another, a day apart at most, are one
 * move and not an expense and an income. Each line is used once, nearest in date first. It is a guess from amount and date, so a person can change it in the preview; the returned map
 * holds both directions of each pair.
 */
export function pairOwnTransfers(sides: readonly { readonly id: string; readonly account: string; readonly line: StatementLine }[]): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>();
  const debits = sides.filter((side) => side.line.direction === 'debit').sort((a, b) => a.line.date.localeCompare(b.line.date));
  for (const debit of debits) {
    const credit = sides
      .filter(
        (side) =>
          side.line.direction === 'credit' &&
          !pairs.has(side.id) &&
          side.account !== debit.account &&
          side.line.amountMinor === debit.line.amountMinor &&
          daysApart(side.line.date, debit.line.date) <= 1,
      )
      .sort((a, b) => daysApart(a.line.date, debit.line.date) - daysApart(b.line.date, debit.line.date))[0];
    if (credit !== undefined) {
      pairs.set(debit.id, credit.id);
      pairs.set(credit.id, debit.id);
    }
  }
  return pairs;
}
