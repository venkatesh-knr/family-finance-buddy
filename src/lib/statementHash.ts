/**
 * Hashing a statement's lines, on the device (docs/design/spending-capture.md section 4; SC-I8).
 *
 * A line's hash recognises the line when its statement is imported again, and a UPI reference's hash is how a bank's line, a UPI app's line and an alert are known to be one
 * payment. Both are sha256, computed here, so that a line, which carries a narration, and a reference are never what is stored: the hash and the reference's last four are. It is
 * not in `src/domain/statement` because Web Crypto is asynchronous and belongs to the platform, as `hash.ts` says of the eCAS lines.
 */

import type { ParsedStatement } from '../domain/statement/common.ts';
import { lineKey, occurrences } from '../domain/statement/lineIdentity.ts';
import type { HashedLine } from '../domain/statement/match.ts';
import { sha256Hex } from './hash.ts';

export async function hashStatement(statement: ParsedStatement): Promise<HashedLine[]> {
  const numbers = occurrences(statement.lines);
  return Promise.all(
    statement.lines.map(
      async (line, index): Promise<HashedLine> => ({
        line,
        lineHash: await sha256Hex(lineKey(statement.kind, line, numbers[index] ?? 1)),
        refHash: line.upiReference === null ? null : await sha256Hex(line.upiReference),
        refLast4: line.upiReference === null ? null : line.upiReference.slice(-4),
      }),
    ),
  );
}
