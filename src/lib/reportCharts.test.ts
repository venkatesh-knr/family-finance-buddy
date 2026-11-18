import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { REPORT_SHEETS, buildReport } from '../domain/export/report.ts';
import { REPORT_META, reportFixture } from '../domain/export/reportFixture.ts';
import { chartSpecs, chartXml } from './reportCharts.ts';
import { writeReportFile } from './reportFile.ts';

/**
 * The report's charts (docs/design/export-redesign.md section 2, Charts; XR-I4, XR-I5, XR-I6): each reads cells on its own sheet and holds no number of its own,
 * a ranked bar chart keeps its figures clear of its title, a loss is coral with a minus sign, and the file's parts are listed and related as Excel needs them.
 */

const report = buildReport(reportFixture(), REPORT_META);
const finished = async () => JSZip.loadAsync(await writeReportFile(report, { householdName: REPORT_META.householdName }));
const text = async (zip: JSZip, path: string): Promise<string> => (await zip.file(path)?.async('string')) ?? '';

/** Every opening tag has its closing tag, in order: the well-formedness an XML part needs to open at all. */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const match of xml.replace(/<\?[\s\S]*?\?>/g, '').matchAll(/<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing === '/') continue;
    if (closing === '/') {
      if (stack.pop() !== name) return false;
    } else stack.push(name ?? '');
  }
  return stack.length === 0;
}

describe('which charts a report has', () => {
  it('makes four: two on Summary, one on Spending and one on Investments, and none on any other sheet', () => {
    const specs = chartSpecs(report);
    expect(specs.map((spec) => [spec.sheet, spec.title])).toEqual([
      ['Summary', 'Investments by type (INR): what you put in, and what it is worth'],
      ['Summary', 'Spending by month (INR), against the plan'],
      ['Spending', 'Spent by category (INR), all entries in this file'],
      ['Investments', 'Gain on each investment (INR): below zero is a loss'],
    ]);
  });

  it('makes no chart for a sheet that has no data to read, and has no Planned line without a plan', () => {
    const everything = reportFixture();
    const only = buildReport({ member: everything['member'] ?? [], expense_category: everything['expense_category'] ?? [], expense_txn: everything['expense_txn'] ?? [] }, REPORT_META);
    const specs = chartSpecs(only);
    expect(specs.map((spec) => spec.sheet)).toEqual(['Summary', 'Spending']);
    expect(specs[0]?.series).toHaveLength(1);
    expect(specs[0]?.legend).toBe(false);
  });
});

describe('XR-I4 — each chart reads cells on its own sheet and holds no number of its own', () => {
  it('points every series at a range on the sheet the chart is drawn on, and never at a literal', () => {
    for (const spec of chartSpecs(report)) {
      for (const series of spec.series) {
        for (const ref of [series.values, series.categories.ref, ...(series.nameRef === null ? [] : [series.nameRef])]) {
          expect(ref, `${spec.title}: ${ref}`).toMatch(new RegExp(`^'${spec.sheet}'!\\$[A-Z]+\\$\\d+`));
        }
      }
      const xml = chartXml(spec);
      expect(xml).not.toMatch(/numLit|strLit|<v>/);
    }
  });

  it('reads the rupee rows only: the dollar holding is outside the Summary’s ranges and the gain chart’s', () => {
    const [types, months, categories, gain] = chartSpecs(report);
    const summary = report.sheets.find((sheet) => sheet.name === 'Summary');
    const block = summary?.blocks.find((candidate) => candidate.key === 'investments-by-type');
    expect(types?.series[0]?.values).toBe(`'Summary'!$B$${String(block?.firstRow)}:$B$${String(block?.lastRow)}`);
    expect(months?.series[0]?.categories.kind).toBe('month');
    expect(categories?.series[0]?.values).toBe("'Spending'!$M$2:$M$4");
    // Investments are sorted rupees first: three rupee rows and then the dollar one, so the gain chart ends at row 4.
    expect(gain?.series[0]?.values).toBe("'Investments'!$H$2:$H$4");
  });
});

describe('XR-I5 — ranked bar charts keep their figures clear of the title, a loss is coral, and a label shows its value alone', () => {
  const ranked = chartSpecs(report).filter((spec) => spec.orientation === 'horizontal');

  it('reverses the category axis and crosses the value axis at the far end, on every ranked bar chart', () => {
    expect(ranked).toHaveLength(3);
    for (const spec of ranked) {
      const xml = chartXml(spec);
      expect(xml, spec.title).toMatch(/<catAx>[\s\S]*<orientation val="maxMin"\/>[\s\S]*<\/catAx>/);
      expect(xml, spec.title).toMatch(/<valAx>[\s\S]*<crosses val="max"\/>[\s\S]*<\/valAx>/);
    }
  });

  it('sets every title not to overlay its plot, and every legend too', () => {
    for (const spec of chartSpecs(report)) {
      const xml = chartXml(spec);
      expect(xml, spec.title).toMatch(/<title>[\s\S]*<overlay val="0"\/><\/title>/);
      if (spec.legend) expect(xml).toMatch(/<legend>[\s\S]*<overlay val="0"\/><\/legend>/);
    }
  });

  it('shows the value alone on a label, never the series or the category name', () => {
    for (const spec of chartSpecs(report)) {
      const xml = chartXml(spec);
      for (const labels of xml.matchAll(/<dLbls>[\s\S]*?<\/dLbls>/g)) {
        expect(labels[0]).toContain('<showVal val="1"/>');
        expect(labels[0]).toContain('<showCatName val="0"/>');
        expect(labels[0]).toContain('<showSerName val="0"/>');
        expect(labels[0]).toContain('<showPercent val="0"/>');
      }
    }
  });

  it('draws a loss coral by data point, with a minus sign on its label and the names at the axis’s low edge', () => {
    const tables = reportFixture();
    // A holding worth less than was put in: the mutual fund's latest value is below its cost.
    tables['valuation_snapshot'] = (tables['valuation_snapshot'] ?? []).map((row) => (row['id'] === '00000000-0000-4000-8000-0000000000v2' ? { ...row, value_minor: '8000000' } : row));
    const withLoss = buildReport(tables, REPORT_META);
    const gain = chartSpecs(withLoss).find((spec) => spec.sheet === 'Investments');
    const xml = chartXml(gain ?? (undefined as never));
    expect(xml).toMatch(/<dPt><idx val="1"\/>[\s\S]*C0432F[\s\S]*<\/dPt>/);
    expect(xml).toContain('&quot;₹&quot;#,##0;-&quot;₹&quot;#,##0;&quot;₹&quot;0');
    expect(xml).toContain('<tickLblPos val="low"/>');
  });

  it('uses the Linen marks: green for what is made, grey for the context, coral for a loss', () => {
    const [types] = chartSpecs(report);
    expect(types?.series.map((series) => series.color)).toEqual(['7B857F', '0B7D5E']);
  });
});

// The first test loads the spreadsheet library, which takes seconds on a busy machine.
describe('XR-I6 — the file opens in Excel without a repair prompt: its parts are listed and related', { timeout: 30_000 }, () => {
  it('lists every part, relates every relationship target that exists, and has well-formed XML', async () => {
    const zip = await finished();
    const types = await text(zip, '[Content_Types].xml');
    const names = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir);
    for (const name of names.filter((candidate) => /^xl\/(worksheets\/sheet\d+|drawings\/drawing\d+|charts\/chart\d+)\.xml$/.test(candidate))) {
      expect(types, name).toContain(`PartName="/${name}"`);
    }
    for (const name of names.filter((candidate) => candidate.endsWith('.rels'))) {
      for (const target of (await text(zip, name)).matchAll(/Target="([^"]+)"/g)) {
        const path = (target[1] ?? '').replace(/^\//, '');
        const resolved = path.startsWith('xl/') || path.startsWith('docProps/') || path === 'xl' ? path : name.startsWith('xl/worksheets/_rels') || name.startsWith('xl/drawings/_rels') ? path : `xl/${path}`;
        expect(zip.file(resolved) !== null || zip.file(`xl/${path}`) !== null, `${name} -> ${path}`).toBe(true);
      }
    }
    for (const name of names.filter((candidate) => candidate.endsWith('.xml') || candidate.endsWith('.rels'))) expect(wellFormed(await text(zip, name)), name).toBe(true);
  });

  it('draws each chart once: every chart is related by one drawing, every drawing by one sheet, and each sheet names its drawing', async () => {
    const zip = await finished();
    const charts = Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name));
    expect(charts).toHaveLength(4);
    const drawingRels = Object.keys(zip.files).filter((name) => /^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/.test(name));
    const related = (await Promise.all(drawingRels.map(async (name) => [...(await text(zip, name)).matchAll(/Target="\/(xl\/charts\/chart\d+\.xml)"/g)].map((match) => match[1])))).flat();
    expect([...related].sort()).toEqual([...charts].sort());

    for (const sheetName of ['Summary', 'Spending', 'Investments']) {
      const n = REPORT_SHEETS.indexOf(sheetName as (typeof REPORT_SHEETS)[number]) + 1;
      const sheet = await text(zip, `xl/worksheets/sheet${String(n)}.xml`);
      const id = /<drawing [^>]*r:id="([^"]+)"/.exec(sheet)?.[1];
      expect(id, sheetName).toBeDefined();
      expect(await text(zip, `xl/worksheets/_rels/sheet${String(n)}.xml.rels`), sheetName).toContain(`Id="${id ?? ''}"`);
    }
  });

  it('puts the drawing element where a worksheet allows it, after its page setup and before the end', async () => {
    const zip = await finished();
    const n = REPORT_SHEETS.indexOf('Summary') + 1;
    const sheet = await text(zip, `xl/worksheets/sheet${String(n)}.xml`);
    expect(sheet.indexOf('<drawing ')).toBeGreaterThan(sheet.indexOf('<sheetData'));
    expect(sheet.indexOf('<drawing ')).toBeLessThan(sheet.indexOf('</worksheet>'));
    const pageSetup = sheet.search(/<pageSetup|<pageMargins/);
    if (pageSetup >= 0) expect(sheet.indexOf('<drawing ')).toBeGreaterThan(pageSetup);
  });
});
