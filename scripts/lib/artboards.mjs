/**
 * The Artboard column of the Screens table in docs/design/conformance.md, and the one thing about it a machine
 * can check: that every screen names the artboard it is drawn on in docs/design/vibrant-canvas.html, or says
 * `none`, and that a name is a board that exists.
 *
 * Layout and hierarchy come from the artboard (CLAUDE.md), so a screen with neither an artboard nor an
 * explicit `none` is a screen nobody has looked for a board for. Whether the screen matches the board is a
 * person with both open; this only stops the column being left blank or naming a board that was renamed.
 */

/** The ids of the boards in the canvas, as `<section class="board" id="…">` declares them. */
export function artboardIds(canvasHtml) {
  return [...canvasHtml.matchAll(/<section class="board"[^>]*\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
}

/**
 * One problem per screen row whose Artboard cell is empty, or names a board the canvas does not have.
 * `rows` are `{ item, artboard }`; a cell is `none` or a comma-separated list of board ids.
 */
export function checkArtboards(rows, ids) {
  const problems = [];
  for (const { item, artboard } of rows) {
    const cell = (artboard ?? '').replace(/`/g, '').trim();
    if (cell === '') {
      problems.push(`"${item}" has no Artboard. Name its board in vibrant-canvas.html, or write none.`);
      continue;
    }
    if (cell === 'none') continue;
    for (const name of cell.split(',').map((part) => part.trim())) {
      if (!ids.includes(name)) {
        problems.push(`"${item}" names the artboard "${name}", which vibrant-canvas.html does not have (${ids.join(', ')}).`);
      }
    }
  }
  return problems;
}
