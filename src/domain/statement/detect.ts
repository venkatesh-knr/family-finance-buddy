/**
 * Which statement a file is (docs/build-plan.md step 7): a person chooses a file and not a format, so what it says is read to find which parser it is for. A file none of them
 * recognises is said to be one, and is never guessed at. Pure: the file's text, or its rows, in; the parsed statement out.
 */

import type { ParsedStatement } from './common.ts';
import { parseAxisCard } from './axisCard.ts';
import { parseGpay } from './gpay.ts';
import { parseIciciCard } from './iciciCard.ts';
import { parseIciciSavings } from './iciciSavings.ts';
import { rowText, type PdfPage } from './pdfRows.ts';
import { parseHdfcDelimited, parseHdfcText, parseQif } from './textFormats.ts';

export interface Detected {
  /** The statement, or null when the file is none the app reads. Its own `problems` can still name lines it could not read. */
  readonly statement: ParsedStatement | null;
  /** Why there is no statement. */
  readonly problem: string | null;
}

const UNKNOWN = 'That is not a statement the app reads. It reads HDFC delimited, text and QIF files, and ICICI savings, ICICI card, Axis card and Google Pay PDFs.';

export function parseTextStatement(text: string): Detected {
  if (/^\s*!Type:/i.test(text)) return { statement: parseQif(text), problem: null };
  if (/Date\s*,\s*Narration/i.test(text)) return { statement: parseHdfcDelimited(text), problem: null };
  if (/Narration/.test(text) && /Withdrawal/.test(text) && /^-+(\s+-+)+\s*$/m.test(text)) return { statement: parseHdfcText(text), problem: null };
  return { statement: null, problem: UNKNOWN };
}

export function parsePdfStatement(pages: readonly PdfPage[]): Detected {
  const lines = pages.flatMap((page) => page.rows).map(rowText);
  if (lines.some((line) => /Statement of Transactions in Account no/i.test(line))) return { statement: parseIciciSavings(pages), problem: null };
  if (lines.some((line) => /^CREDIT CARD STATEMENT/.test(line))) return { statement: parseIciciCard(pages), problem: null };
  if (lines.some((line) => /Axis Bank.*Credit Card/i.test(line))) return { statement: parseAxisCard(pages), problem: null };
  if (lines.some((line) => /^Transaction statement period/.test(line))) return { statement: parseGpay(pages), problem: null };
  return { statement: null, problem: UNKNOWN };
}
