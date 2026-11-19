/**
 * What the PDF reader hands the PDF parsers (docs/build-plan.md step 7): rows of text with their columns.
 *
 * A bank statement's columns are what tells a withdrawal from a deposit, and a line of text joined with spaces has lost them, so a row keeps each cell with where it sits on the
 * page. Pure types: `src/lib/statement-pdf.ts` fills them from the file, on the device, and the parsers in this folder read them without touching a file.
 */

/** A piece of text and the horizontal span it occupies on the page, in points. */
export interface PdfCell {
  readonly x: number;
  /** Where the text ends: a figure is right-aligned in its column, so this says which column it is in. */
  readonly right: number;
  readonly text: string;
}

/** The cells that share a baseline, left to right. */
export interface PdfRow {
  readonly cells: readonly PdfCell[];
}

export interface PdfPage {
  /** Top to bottom. */
  readonly rows: readonly PdfRow[];
}

/** A row's text on one line, cells separated by a space. */
export const rowText = (row: PdfRow): string => row.cells.map((cell) => cell.text).join(' ').replace(/\s+/g, ' ').trim();

/** A piece of text as the PDF engine reports it: where its baseline starts, and how wide it is. */
export interface PdfItem {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** Two points of tolerance on a baseline, because a superscript or a different font size shifts one by a fraction without starting a new row. */
const BASELINE = 2;
/** Pieces of text closer than this are one cell: a PDF often draws a phrase in several runs. */
const SAME_CELL = 2;

/**
 * Rows from a page's text items: items on one baseline are a row, top to bottom; within a row they are left to right, and runs that touch are one cell. A PDF's text arrives in
 * whatever order it was drawn, which for a table is often column by column, so nothing here depends on the order it comes in.
 */
export function rowsFromItems(items: readonly PdfItem[]): PdfRow[] {
  const byBaseline: { y: number; items: PdfItem[] }[] = [];
  for (const item of items) {
    if (item.text.trim() === '') continue;
    const found = byBaseline.find((row) => Math.abs(row.y - item.y) <= BASELINE);
    if (found === undefined) byBaseline.push({ y: item.y, items: [item] });
    else found.items.push(item);
  }
  return byBaseline
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const cells: PdfCell[] = [];
      for (const item of row.items.sort((a, b) => a.x - b.x)) {
        const last = cells[cells.length - 1];
        if (last !== undefined && item.x - last.right <= SAME_CELL) cells[cells.length - 1] = { x: last.x, right: item.x + item.width, text: `${last.text}${item.text}` };
        else cells.push({ x: item.x, right: item.x + item.width, text: item.text });
      }
      return { cells: cells.map((cell) => ({ ...cell, text: cell.text.trim() })) };
    });
}
