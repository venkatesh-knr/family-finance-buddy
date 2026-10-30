import { describe, expect, it } from 'vitest';
import { ENTITIES } from '../domain/export/entities.ts';
import { exportFixture } from '../domain/export/fixture.ts';
import { buildWorkbook, canonicalRow, readWorkbook } from '../domain/export/workbook.ts';
import { readWorkbookFile, writeWorkbookFile } from './workbookFile.ts';

const META = { exportedAt: '2026-10-30T06:30:00.000Z', householdName: 'The Rao household', baseCurrency: 'INR', demo: false };

describe('the workbook as an .xlsx file', { timeout: 30_000 }, () => {
  it('is read back from the file to exactly the rows that were written', async () => {
    const tables = exportFixture();
    const { workbook, problems } = buildWorkbook(tables, META);
    expect(problems).toEqual([]);

    const bytes = await writeWorkbookFile(workbook.sheets, { sample: false });
    // An .xlsx is a zip: it starts with the bytes PK.
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK');

    const back = readWorkbook(await readWorkbookFile(bytes));
    expect(back.problems).toEqual([]);
    const inFile = ENTITIES.filter((entity) => entity.sheet !== null || ENTITIES.some((other) => other.joins?.entity === entity.key));
    for (const entity of inFile) {
      const written = (tables[entity.key] ?? []).map((row) => canonicalRow(entity, row));
      expect(back.tables[entity.key] ?? [], entity.key).toEqual(written);
    }
  });

  it('keeps a text that looks like a formula as text, and a negative amount negative', async () => {
    const { workbook } = buildWorkbook(exportFixture(), META);
    const back = readWorkbook(await readWorkbookFile(await writeWorkbookFile(workbook.sheets, { sample: false })));
    expect(back.tables['expense_txn']?.[0]?.['payee']).toBe('=SUM(A1:A9)');
    expect(back.tables['ppf_entry']?.map((row) => row['amount_minor'])).toEqual(['5000000', '-1000000']);
  });

  it('marks the first sheet of a sample household’s file, and still reads back', async () => {
    const { workbook } = buildWorkbook(exportFixture(), { ...META, demo: true });
    const sheets = await readWorkbookFile(await writeWorkbookFile(workbook.sheets, { sample: true }));
    const about = sheets.find((sheet) => sheet.name === 'About');
    expect(about?.rows.some((row) => typeof row[1] === 'string' && row[1].startsWith('Yes'))).toBe(true);
  });
});
