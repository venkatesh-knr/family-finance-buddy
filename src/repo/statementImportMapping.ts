/**
 * An entry as statement matching needs it (docs/design/spending-capture.md section 4): a pure function that takes `unknown`, as the other mappings do, so the point where the
 * provider's response shape stops is one place. Money is selected `::text` and read exactly.
 */

import type { StatementKind } from '../domain/statement/common.ts';
import type { ExistingEntry } from '../domain/statement/match.ts';
import { optionalString, requireRecord, requireString, toBigIntExact } from '../lib/guards.ts';
import { requireIsoDate } from './mapping.ts';

const KINDS: readonly StatementKind[] = ['hdfc_delimited', 'hdfc_text', 'qif', 'icici_savings_pdf', 'icici_card_pdf', 'axis_card_pdf', 'gpay_pdf'];

/** The entry, and the member it is under, which a witness added to it must carry. */
export interface ExistingRow {
  readonly entry: ExistingEntry;
  readonly memberId: string;
}

export function toExistingEntry(raw: unknown, witnessKinds: readonly string[]): ExistingRow {
  const row = requireRecord(raw, 'expense_txn');
  const kinds = KINDS.filter((kind) => witnessKinds.includes(kind));
  return {
    entry: {
      id: requireString(row['id'], 'expense_txn.id'),
      date: requireIsoDate(row['txn_date'], 'expense_txn.txn_date'),
      amountMinor: toBigIntExact(row['amount_minor'], 'expense_txn.amount_minor'),
      currency: requireString(row['currency'], 'expense_txn.currency'),
      payee: optionalString(row['payee'], 'expense_txn.payee'),
      accountId: optionalString(row['account_id'], 'expense_txn.account_id'),
      upiRefHash: optionalString(row['upi_ref_hash'], 'expense_txn.upi_ref_hash'),
      witnessedBy: kinds,
    },
    memberId: requireString(row['member_id'], 'expense_txn.member_id'),
  };
}
