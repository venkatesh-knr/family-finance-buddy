/**
 * What identifies a statement line (docs/design/spending-capture.md section 4): the text it is hashed from, and which of like lines it is.
 *
 * A statement can hold two lines that are alike in everything it prints (two card swipes of the same amount at the same shop on one day), and both are real, so a line's identity
 * includes its number among them. A statement read again numbers them the same way, which is what recognises it. The kind of statement is in the text, so a Google Pay line and a bank
 * line for one payment have two hashes and are two witnesses. Pure: the hashing itself is `src/lib/statementHash.ts`.
 */

import type { StatementKind, StatementLine } from './common.ts';

const normalised = (text: string): string => text.replace(/\s+/g, ' ').trim();

const alike = (line: StatementLine): string => `${line.date}|${line.direction}|${String(line.amountMinor)}|${normalised(line.raw)}`;

/** For each line, which of the identical lines it is: 1 for the first, 2 for the second, in the order the statement has them. */
export function occurrences(lines: readonly StatementLine[]): number[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = alike(line);
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);
    return next;
  });
}

/** The text a line is hashed from. Never stored: only its sha256 is. */
export function lineKey(kind: StatementKind, line: StatementLine, occurrence: number): string {
  return `${kind}|${alike(line)}|#${String(occurrence)}`;
}
