/**
 * The Departures table of docs/design/conformance.md, and the one thing about it a machine can check:
 * that every row says whose decision it is.
 *
 * A departure is the owner's to accept (conformance.md, "Departures"). A reason written down by whoever
 * built the screen is not a decision, and a table where every row read as one is how a running app came to
 * differ from its canvas with nobody having chosen it. So each row carries a Status, and a row with none,
 * or with a word that is not one of the three, fails the build.
 */

export const STATUSES = ['unreviewed', 'proposed', 'decided'];

/**
 * The rows of the Departures table: the text before the first pipe and the last cell, which is the Status.
 * Only the table under the `## Departures` heading is read, and only its body rows.
 */
export function departureRows(markdown) {
  const text = markdown.replace(/\r\n/g, '\n');
  const start = text.indexOf('\n## Departures');
  if (start < 0) return null;
  const lines = text.slice(start + 1).split('\n');

  const rows = [];
  let inTable = false;
  for (const [index, line] of lines.entries()) {
    if (/^\| What \|/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^\|[-| ]+\|$/.test(line)) continue;
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|');
    rows.push({
      what: (cells[0] ?? '').trim(),
      cells: cells.length,
      status: (cells[cells.length - 1] ?? '').trim(),
      line: index + 1,
    });
  }
  return rows;
}

/** Problems with the table: no table, a missing Status column, or a Status that is not one of the three. */
export function checkDepartures(markdown) {
  const rows = departureRows(markdown);
  if (rows === null || rows.length === 0) return ['The Departures table could not be read. Has its heading or header row changed?'];

  const problems = [];
  for (const row of rows) {
    if (!STATUSES.includes(row.status)) {
      problems.push(
        `Departure "${row.what}" has no valid Status (${row.status === '' ? 'blank' : `"${row.status}"`}). ` +
          `It is ${STATUSES.map((s) => `\`${s}\``).join(', ')}: a departure is the owner's to accept, so say whose call it still is.`,
      );
    }
  }
  return problems;
}
