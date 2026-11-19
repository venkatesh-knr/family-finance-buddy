import { describe, expect, it } from 'vitest';
import { rowsFromItems, rowText } from './pdfRows.ts';

/** Rows from a PDF's text items: baselines, columns and runs that touch (docs/build-plan.md step 7). */
const item = (text: string, x: number, y: number, width = text.length * 5) => ({ text, x, y, width });

describe('rows from text items', () => {
  it('groups items on one baseline, top to bottom, whatever order they were drawn in', () => {
    const rows = rowsFromItems([item('B', 100, 700), item('top', 10, 800), item('A', 10, 700), item('C', 50, 699.2)]);
    expect(rows.map(rowText)).toEqual(['top', 'A C B']);
  });

  it('keeps each piece’s column, and where it ends', () => {
    const [row] = rowsFromItems([item('224.00', 427, 600, 26), item('19335.06', 536, 600, 35)]);
    expect(row?.cells).toEqual([
      { x: 427, right: 453, text: '224.00' },
      { x: 536, right: 571, text: '19335.06' },
    ]);
  });

  it('joins runs that touch into one cell, and leaves a gap between cells', () => {
    const [row] = rowsFromItems([item('HOTEL', 10, 500, 25), item('ARIY', 35.5, 500, 20), item('224.00', 400, 500, 26)]);
    expect(row?.cells.map((cell) => cell.text)).toEqual(['HOTELARIY', '224.00']);
  });

  it('drops text that is only space', () => {
    expect(rowsFromItems([item('  ', 10, 100), item('x', 20, 100)]).map(rowText)).toEqual(['x']);
  });
});
