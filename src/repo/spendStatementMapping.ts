/**
 * The mapping from a stated spend's row to the app's vocabulary (docs/design/spending-capture.md section 11.5): a pure function that takes `unknown`, as
 * `ledgerMapping.ts` does, so the point where the provider's response shape stops is one place. Money is selected `::text` and read exactly.
 */

import { MalformedRowError, optionalString, requireRecord, requireString, toBigIntExact } from '../lib/guards.ts';
import { money } from '../lib/money.ts';
import { requireIsoDate } from './mapping.ts';
import type { SpendStatement } from './types.ts';

export function toSpendStatement(raw: unknown): SpendStatement {
  const row = requireRecord(raw, 'spend_statement');
  const currency = requireString(row['currency'], 'spend_statement.currency');
  const first = requireIsoDate(row['month'], 'spend_statement.month');
  // A statement is about a whole month, so a row that names any other day is refused and not rounded to one.
  if (!first.endsWith('-01')) throw new MalformedRowError('spend_statement.month', `is not the first day of a month: ${first}`);
  return {
    id: requireString(row['id'], 'spend_statement.id'),
    householdId: requireString(row['household_id'], 'spend_statement.household_id'),
    month: first.slice(0, 7),
    amount: money(toBigIntExact(row['amount_minor'], 'spend_statement.amount_minor'), currency),
    note: optionalString(row['note'], 'spend_statement.note'),
  };
}
