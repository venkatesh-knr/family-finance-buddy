/**
 * The charts of the report (docs/design/export-redesign.md section 2, Charts; XR-I4 to XR-I6).
 *
 * ExcelJS has no chart API and drops a chart on a re-save, so the report is written first, without charts, and the charts are added to the finished
 * file: the zip library ExcelJS already depends on opens the buffer, and for each chart this adds the chart part, the drawing that places it on its
 * sheet and that drawing's relationships, the sheet's relationship to the drawing, and the content-type overrides. The chart XML follows the sample
 * workbook's, with each series pointed at the real cells of its own sheet: a chart holds no number of its own, so a figure edited in the file moves it.
 *
 * Four charts, on Summary, Spending and Investments only, in rupees and never adding another currency:
 *   Summary      Investments by type: invested (grey) and latest value (green), clustered horizontal bars.
 *   Summary      Spending by month: green columns with values, and the plan as a grey dashed line on the same axis.
 *   Spending     Spent by category: ranked horizontal bars, read from the small By category block at L1:M.
 *   Investments  Gain on each investment: horizontal bars from zero, a loss coloured apart, a minus sign on its label.
 *
 * Every ranked bar chart lists its first item at the top (its category axis is reversed) and crosses its value axis at the far end, so the figures sit along
 * the bottom, clear of the title; every title is set not to overlay the plot; a label shows the value alone.
 *
 * Pure but for the zip: the chart specs and their XML are built from the report model without I/O.
 */

import type { ReportBlock, ReportSheet, ReportWorkbook } from '../domain/export/report.ts';

const GREEN = '0B7D5E';
const GREY = '7B857F';
const CORAL = 'C0432F';
const GRID = 'E2DBCB';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface ChartSeries {
  /** A cell holding the series' name, or null for a chart with one series (which has no legend). */
  readonly nameRef: string | null;
  readonly color: string;
  /** The categories: a range of text, or of dates (shown as months). */
  readonly categories: { readonly ref: string; readonly kind: 'text' | 'month' };
  readonly values: string;
  /** Show the value on each bar, in this number format. */
  readonly labelFormat?: string;
  /** Positions within the series coloured apart (a loss), and the colour. */
  readonly points?: { readonly indexes: readonly number[]; readonly color: string };
  /** Draw as a dashed line rather than bars. */
  readonly dashed?: boolean;
}

export interface ChartSpec {
  readonly sheet: string;
  readonly title: string;
  /** Horizontal bars (ranked), or columns with an optional line. */
  readonly orientation: 'horizontal' | 'vertical';
  readonly series: readonly ChartSeries[];
  readonly legend: boolean;
  readonly valueFormat: string;
  /** Names sit at the axis's low edge, so a bar that falls below zero never covers them. */
  readonly labelsLow: boolean;
  /** Anchor: the cell its top left is at (zero-based) and its size in EMU. */
  readonly anchor: { readonly col: number; readonly row: number; readonly width: number; readonly height: number };
}

// ───────────────────────────────────────────────────────────── the specs

const absolute = (sheet: string, col: number, row: number): string => `'${sheet}'!$${colLetters(col)}$${String(row)}`;
const range = (sheet: string, col: number, first: number, last: number): string => `${absolute(sheet, col, first)}:$${colLetters(col)}$${String(last)}`;

function colLetters(col: number): string {
  let n = col;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const block = (sheet: ReportSheet, key: string): ReportBlock | undefined => sheet.blocks.find((candidate) => candidate.key === key);
const EMU_ROW = 190500;
const rowsFor = (height: number): number => Math.ceil(height / EMU_ROW);

/** The charts a report has, from where its blocks are. A chart whose data is not there is not made. */
export function chartSpecs(report: ReportWorkbook): ChartSpec[] {
  const specs: ChartSpec[] = [];
  const summary = report.sheets.find((sheet) => sheet.name === 'Summary');
  const spending = report.sheets.find((sheet) => sheet.name === 'Spending');
  const investments = report.sheets.find((sheet) => sheet.name === 'Investments');

  if (summary !== undefined) {
    const types = block(summary, 'investments-by-type');
    const months = block(summary, 'spending-by-month');
    let nextRow = 3;
    if (types !== undefined) {
      const height = 4320000;
      specs.push({
        sheet: 'Summary',
        title: 'Investments by type (INR): what you put in, and what it is worth',
        orientation: 'horizontal',
        series: [
          { nameRef: absolute('Summary', 2, types.headerRow), color: GREY, categories: { ref: range('Summary', 1, types.firstRow, types.lastRow), kind: 'text' }, values: range('Summary', 2, types.firstRow, types.lastRow) },
          { nameRef: absolute('Summary', 3, types.headerRow), color: GREEN, categories: { ref: range('Summary', 1, types.firstRow, types.lastRow), kind: 'text' }, values: range('Summary', 3, types.firstRow, types.lastRow) },
        ],
        legend: true,
        valueFormat: '[>=100000]"₹"##\\,##\\,##0;"₹"##,##0',
        labelsLow: false,
        anchor: { col: 4, row: nextRow, width: 6480000, height },
      });
      nextRow += rowsFor(height) + 4;
    }
    if (months !== undefined) {
      const hasPlan = months.lastCol >= 3;
      const categories = { ref: range('Summary', 1, months.firstRow, months.lastRow), kind: 'month' as const };
      specs.push({
        sheet: 'Summary',
        title: 'Spending by month (INR), against the plan',
        orientation: 'vertical',
        series: [
          { nameRef: absolute('Summary', 2, months.headerRow), color: GREEN, categories, values: range('Summary', 2, months.firstRow, months.lastRow), labelFormat: '"₹"#,##0' },
          ...(hasPlan ? [{ nameRef: absolute('Summary', 3, months.headerRow), color: GREY, categories, values: range('Summary', 3, months.firstRow, months.lastRow), dashed: true }] : []),
        ],
        legend: hasPlan,
        valueFormat: '"₹"##,##0',
        labelsLow: false,
        anchor: { col: 4, row: nextRow, width: 6480000, height: 3240000 },
      });
    }
  }

  if (spending !== undefined) {
    const categories = block(spending, 'by-category');
    if (categories !== undefined) {
      const count = categories.lastRow - categories.firstRow + 1;
      const height = Math.min(6480000, Math.max(2880000, 300000 * count + 1200000));
      specs.push({
        sheet: 'Spending',
        title: 'Spent by category (INR), all entries in this file',
        orientation: 'horizontal',
        series: [{ nameRef: null, color: GREEN, categories: { ref: range('Spending', 12, categories.firstRow, categories.lastRow), kind: 'text' }, values: range('Spending', 13, categories.firstRow, categories.lastRow), labelFormat: '"₹"#,##0' }],
        legend: false,
        valueFormat: '"₹"##,##0',
        labelsLow: false,
        anchor: { col: 11, row: categories.lastRow + 2, width: 5400000, height },
      });
    }
  }

  if (investments !== undefined) {
    const gain = block(investments, 'gain-by-investment');
    if (gain !== undefined) {
      const count = gain.lastRow - gain.firstRow + 1;
      const height = Math.min(6480000, Math.max(2880000, 300000 * count + 1200000));
      specs.push({
        sheet: 'Investments',
        title: 'Gain on each investment (INR): below zero is a loss',
        orientation: 'horizontal',
        series: [
          {
            nameRef: null,
            color: GREEN,
            categories: { ref: range('Investments', 1, gain.firstRow, gain.lastRow), kind: 'text' },
            values: range('Investments', 8, gain.firstRow, gain.lastRow),
            labelFormat: '"₹"#,##0;-"₹"#,##0;"₹"0',
            ...(gain.losses !== undefined && gain.losses.length > 0 ? { points: { indexes: gain.losses, color: CORAL } } : {}),
          },
        ],
        legend: false,
        valueFormat: '"₹"#,##0;-"₹"#,##0;"₹"0',
        labelsLow: true,
        anchor: { col: 13, row: 1, width: 6480000, height },
      });
    }
  }
  return specs;
}

// ───────────────────────────────────────────────────────────── the XML

const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fill = (color: string): string => `<a:solidFill xmlns:a="${A}"><a:srgbClr val="${color}"/></a:solidFill>`;
const barShape = (color: string): string => `<spPr>${fill(color)}<a:ln xmlns:a="${A}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:prstDash val="solid"/></a:ln></spPr>`;

function categoriesXml(series: ChartSeries): string {
  const reference = `<f>${esc(series.categories.ref)}</f>`;
  return series.categories.kind === 'month' ? `<cat><numRef>${reference}</numRef></cat>` : `<cat><strRef>${reference}</strRef></cat>`;
}

function labelsXml(format: string): string {
  // The value alone, never the series or the category name (XR-I5).
  return `<dLbls><numFmt formatCode="${esc(format)}" sourceLinked="0"/><dLblPos val="outEnd"/><showLegendKey val="0"/><showVal val="1"/><showCatName val="0"/><showSerName val="0"/><showPercent val="0"/><showLeaderLines val="0"/></dLbls>`;
}

function barSeriesXml(series: ChartSeries, index: number): string {
  const name = series.nameRef === null ? '' : `<tx><strRef><f>${esc(series.nameRef)}</f></strRef></tx>`;
  const points =
    series.points === undefined
      ? ''
      : series.points.indexes.map((at) => `<dPt><idx val="${String(at)}"/><invertIfNegative val="0"/>${barShape(series.points?.color ?? CORAL)}</dPt>`).join('');
  const labels = series.labelFormat === undefined ? '' : labelsXml(series.labelFormat);
  return `<ser><idx val="${String(index)}"/><order val="${String(index)}"/>${name}${barShape(series.color)}<invertIfNegative val="0"/>${points}${labels}${categoriesXml(series)}<val><numRef><f>${esc(series.values)}</f></numRef></val></ser>`;
}

function lineSeriesXml(series: ChartSeries, index: number): string {
  const name = series.nameRef === null ? '' : `<tx><strRef><f>${esc(series.nameRef)}</f></strRef></tx>`;
  return `<ser><idx val="${String(index)}"/><order val="${String(index)}"/>${name}<spPr><a:ln xmlns:a="${A}" w="22000"><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill><a:prstDash val="dash"/></a:ln></spPr><marker><symbol val="none"/></marker>${categoriesXml(series)}<val><numRef><f>${esc(series.values)}</f></numRef></val><smooth val="0"/></ser>`;
}

/** The XML of one chart part. */
export function chartXml(spec: ChartSpec): string {
  const horizontal = spec.orientation === 'horizontal';
  const bars = spec.series.filter((series) => series.dashed !== true);
  const lines = spec.series.filter((series) => series.dashed === true);
  const barChart = `<barChart><barDir val="${horizontal ? 'bar' : 'col'}"/><grouping val="clustered"/><varyColors val="0"/>${bars.map((series, i) => barSeriesXml(series, i)).join('')}<gapWidth val="${horizontal && bars.length > 1 ? '50' : '60'}"/>${
    horizontal && bars.length > 1 ? '<overlap val="-10"/>' : ''
  }<axId val="10"/><axId val="100"/></barChart>`;
  const lineChart =
    lines.length === 0 ? '' : `<lineChart><grouping val="standard"/><varyColors val="0"/>${lines.map((series, i) => lineSeriesXml(series, bars.length + i)).join('')}<marker val="1"/><axId val="10"/><axId val="100"/></lineChart>`;
  const months = spec.series[0]?.categories.kind === 'month';
  // A ranked bar chart lists its first item at the top, so its category axis is reversed and its value axis crosses at the far end: the figures sit along
  // the bottom, clear of the title (XR-I5).
  const category = `<catAx><axId val="10"/><scaling><orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></scaling><delete val="0"/><axPos val="${horizontal ? 'l' : 'b'}"/><numFmt formatCode="${months ? 'MMM YYYY' : 'General'}" sourceLinked="0"/><majorTickMark val="none"/><minorTickMark val="none"/>${spec.labelsLow ? '<tickLblPos val="low"/>' : ''}<crossAx val="100"/><crosses val="autoZero"/><auto val="1"/><lblAlgn val="ctr"/><lblOffset val="100"/><noMultiLvlLbl val="0"/></catAx>`;
  const value = `<valAx><axId val="100"/><scaling><orientation val="minMax"/></scaling><delete val="0"/><axPos val="${horizontal ? 'b' : 'l'}"/><majorGridlines><spPr><a:ln xmlns:a="${A}"><a:solidFill><a:srgbClr val="${GRID}"/></a:solidFill><a:prstDash val="solid"/></a:ln></spPr></majorGridlines><numFmt formatCode="${esc(spec.valueFormat)}" sourceLinked="0"/><majorTickMark val="none"/><minorTickMark val="none"/><crossAx val="10"/><crosses val="${horizontal ? 'max' : 'autoZero'}"/><crossBetween val="between"/></valAx>`;
  const legend = spec.legend ? '<legend><legendPos val="b"/><overlay val="0"/></legend>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><chartSpace xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="${A}" xmlns:r="${REL}"><roundedCorners val="0"/><chart><title><tx><rich><a:bodyPr/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:t>${esc(spec.title)}</a:t></a:r></a:p></rich></tx><overlay val="0"/></title><autoTitleDeleted val="0"/><plotArea><layout/>${barChart}${lineChart}${category}${value}</plotArea>${legend}<plotVisOnly val="1"/><dispBlanksAs val="gap"/></chart></chartSpace>`;
}

/** The XML of a drawing part that places these charts, in the order given, on one sheet. `first` is the 1-based number of the sheet's first chart relationship. */
export function drawingXml(specs: readonly ChartSpec[]): string {
  const anchors = specs
    .map(
      (spec, i) =>
        `<oneCellAnchor><from><col>${String(spec.anchor.col)}</col><colOff>0</colOff><row>${String(spec.anchor.row)}</row><rowOff>0</rowOff></from><ext cx="${String(spec.anchor.width)}" cy="${String(spec.anchor.height)}"/><graphicFrame macro=""><nvGraphicFramePr><cNvPr id="${String(i + 2)}" name="Chart ${String(i + 1)}"/><cNvGraphicFramePr/></nvGraphicFramePr><xfrm><a:off xmlns:a="${A}" x="0" y="0"/><a:ext xmlns:a="${A}" cx="0" cy="0"/></xfrm><a:graphic xmlns:a="${A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${REL}" r:id="rId${String(i + 1)}"/></a:graphicData></a:graphic></graphicFrame><clientData/></oneCellAnchor>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">${anchors}</wsDr>`;
}

// ───────────────────────────────────────────────────────────── into the file

const CHART_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const DRAWING_TYPE = 'application/vnd.openxmlformats-officedocument.drawing+xml';

/** Add the report's charts to the bytes of the finished file. A report with no chart comes back as it came. */
export async function addCharts(bytes: Uint8Array, report: ReportWorkbook): Promise<Uint8Array> {
  const specs = chartSpecs(report);
  if (specs.length === 0) return bytes;
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);

  let contentTypes = (await zip.file('[Content_Types].xml')?.async('string')) ?? '';
  const overrides: string[] = [];
  let chartNumber = 0;
  let drawingNumber = 0;

  const sheetNames = report.sheets.map((sheet) => sheet.name);
  for (const name of [...new Set(specs.map((spec) => spec.sheet))]) {
    const forSheet = specs.filter((spec) => spec.sheet === name);
    const sheetIndex = sheetNames.indexOf(name) + 1;
    if (sheetIndex === 0) continue;
    const sheetPath = `xl/worksheets/sheet${String(sheetIndex)}.xml`;
    const sheetXml = await zip.file(sheetPath)?.async('string');
    if (sheetXml === undefined) throw new Error(`The report has no ${sheetPath} to put charts on.`);

    drawingNumber += 1;
    const drawingPath = `xl/drawings/drawing${String(drawingNumber)}.xml`;
    const relationships: string[] = [];
    forSheet.forEach((spec, i) => {
      chartNumber += 1;
      const chartPath = `xl/charts/chart${String(chartNumber)}.xml`;
      zip.file(chartPath, chartXml(spec));
      relationships.push(`<Relationship Id="rId${String(i + 1)}" Type="${REL}/chart" Target="/${chartPath}"/>`);
      overrides.push(`<Override PartName="/${chartPath}" ContentType="${CHART_TYPE}"/>`);
    });
    zip.file(drawingPath, drawingXml(forSheet));
    zip.file(`xl/drawings/_rels/drawing${String(drawingNumber)}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
    overrides.push(`<Override PartName="/${drawingPath}" ContentType="${DRAWING_TYPE}"/>`);

    // The sheet's relationship to its drawing, beside any it already has.
    const relsPath = `xl/worksheets/_rels/sheet${String(sheetIndex)}.xml.rels`;
    const existing = await zip.file(relsPath)?.async('string');
    const drawingRelationship = `<Relationship Id="rIdDrawing${String(drawingNumber)}" Type="${REL}/drawing" Target="/${drawingPath}"/>`;
    zip.file(
      relsPath,
      existing === undefined
        ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRelationship}</Relationships>`
        : existing.replace('</Relationships>', `${drawingRelationship}</Relationships>`),
    );

    // `<drawing>` comes after the page setup and before anything that follows it in a worksheet; end of the sheet when nothing does.
    const element = `<drawing xmlns:r="${REL}" r:id="rIdDrawing${String(drawingNumber)}"/>`;
    const follows = /<(legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[ >/]/.exec(sheetXml);
    zip.file(sheetPath, follows === null ? sheetXml.replace('</worksheet>', `${element}</worksheet>`) : `${sheetXml.slice(0, follows.index)}${element}${sheetXml.slice(follows.index)}`);
  }

  contentTypes = contentTypes.replace('</Types>', `${overrides.join('')}</Types>`);
  zip.file('[Content_Types].xml', contentTypes);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
