import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { REPORT_SHEETS, buildReport } from '../domain/export/report.ts';
import { REPORT_META, reportFixture } from '../domain/export/reportFixture.ts';
import { cellRef, writeReportFile } from './reportFile.ts';

/**
 * The report as a file (docs/design/export-redesign.md section 2): the parts of the .xlsx are listed and related as Excel needs them, the sheets are the
 * report's, in its order, and the formulas are formulas in the file. The charts, which are added to the finished file, are tested in `reportCharts.test.ts`.
 */

const written = async () => {
  const report = buildReport(reportFixture(), REPORT_META);
  const bytes = await writeReportFile(report, { householdName: REPORT_META.householdName });
  const zip = await JSZip.loadAsync(bytes);
  return { zip, report };
};

describe('cellRef', () => {
  it('names a cell as a spreadsheet does', () => {
    expect(cellRef(1, 1)).toBe('A1');
    expect(cellRef(12, 13)).toBe('M12');
    expect(cellRef(3, 27)).toBe('AA3');
  });
});

// Loading the spreadsheet library the first time takes seconds on a busy machine, which is longer than a test's default.
describe('the report file', { timeout: 30_000 }, () => {
  it('has the report’s sheets, in order, in the workbook part', async () => {
    const { zip } = await written();
    const workbook = await zip.file('xl/workbook.xml')?.async('string');
    const names = [...(workbook ?? '').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'));
    expect(names).toEqual([...REPORT_SHEETS]);
  });

  it('lists every part in the content types and relates every sheet, so it opens without a repair prompt', async () => {
    const { zip } = await written();
    const types = (await zip.file('[Content_Types].xml')?.async('string')) ?? '';
    const sheets = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    expect(sheets).toHaveLength(REPORT_SHEETS.length);
    for (const sheet of sheets) expect(types, sheet).toContain(`PartName="/${sheet}"`);
    const rels = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
    for (const sheet of sheets) expect(rels, sheet).toContain(`Target="${sheet.replace('xl/', '/xl/')}"`.replace('/xl/', '') === '' ? sheet : sheet.replace('xl/', ''));
    // Charts are in the file, and each is in the content types.
    for (const part of Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name) || /^xl\/drawings\/drawing\d+\.xml$/.test(name))) expect(types, part).toContain(`PartName="/${part}"`);
  });

  it('writes the gains and totals as formulas, not values', async () => {
    const { zip, report } = await written();
    const index = REPORT_SHEETS.indexOf('Investments') + 1;
    const xml = (await zip.file(`xl/worksheets/sheet${String(index)}.xml`)?.async('string')) ?? '';
    expect(xml).toContain('<f>IF(OR(E2=&quot;&quot;,F2=&quot;&quot;),&quot;&quot;,F2-E2)</f>');
    const property = (await zip.file(`xl/worksheets/sheet${String(REPORT_SHEETS.indexOf('Property') + 1)}.xml`)?.async('string')) ?? '';
    expect(property).toContain('<f>SUM(E2:G2)</f>');
    expect(report.sheets.find((sheet) => sheet.name === 'Summary')?.cells.some((cell) => typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value)).toBe(true);
  });

  it('asks the reader to work the formulas out when it opens the file', async () => {
    const { zip } = await written();
    const workbook = (await zip.file('xl/workbook.xml')?.async('string')) ?? '';
    expect(workbook).toContain('fullCalcOnLoad="1"');
  });

  it('freezes the first row and filters the table of a data sheet', async () => {
    const { zip } = await written();
    const spending = (await zip.file(`xl/worksheets/sheet${String(REPORT_SHEETS.indexOf('Spending') + 1)}.xml`)?.async('string')) ?? '';
    expect(spending).toContain('state="frozen"');
    expect(spending).toMatch(/<autoFilter ref="A1:J\d+"/);
  });
});
