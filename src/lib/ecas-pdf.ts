/**
 * Opening a consolidated account statement, on the device.
 *
 * "The browser's own PDF engine takes the password and decrypts the file, so
 * this needs no service and no key of ours — which is also the only reason it
 * is possible at all in an architecture with no server" (docs/build-plan.md).
 * And §894: "Doing it on the device means a document listing every folio, your
 * PAN and your address is never uploaded anywhere. That is better than any
 * server-side design, not a compromise with one."
 *
 * So this module reads bytes and returns lines of text. It is the whole of the
 * I/O; `src/domain/ecas.ts` does the reading-of-meaning and is pure, which is
 * why the fixtures there are lines of text and not a PDF.
 *
 * ── three deliberate choices ────────────────────────────────────────────
 *
 * Loaded on demand. pdf.js is larger than the rest of the application put
 * together, and somebody adding an expense should not pay for a parser they
 * are not using. The dynamic import is what keeps it out of the initial
 * bundle.
 *
 * Nothing is rendered, so no fonts are built. `disableFontFace` says that
 * outright. It also matters for the content-security policy the bundle ships
 * with — `script-src 'self'`, no `unsafe-eval` (see vite.config.ts) — which
 * earlier pdf.js versions needed an `isEvalSupported: false` to respect when
 * compiling font programs. Version 6 removed that path and the option with it;
 * this is noted because the flag appears in every older example and its
 * absence here is deliberate, not an oversight.
 *
 * Text, not pixels. Both registrars generate these statements digitally, so
 * the characters are really there: "extraction is a layout problem — reading
 * positioned text and rebuilding rows — not character recognition."
 */

/** A page's worth of text, already rebuilt into printed rows. */
export interface StatementText {
  readonly lines: readonly string[];
  readonly pages: number;
}

/** Thrown when the file needs a password, or the one given is wrong. */
export class PasswordNeeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordNeeded';
  }
}

/**
 * Items on one line share a baseline. Two points of tolerance, because a
 * superscript or a slightly different font size shifts a baseline by a
 * fraction without starting a new row.
 */
const LINE_TOLERANCE = 2;

interface TextItem {
  readonly str?: string;
  readonly transform?: readonly number[];
}

/**
 * Read a statement's printed rows.
 *
 * The bytes never leave this function: nothing is uploaded, cached or written
 * to storage, and the password is used once and not kept.
 */
export async function readStatementLines(
  bytes: ArrayBuffer,
  password: string,
): Promise<StatementText> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');

  // Same origin, which `worker-src 'self'` requires. Vite fingerprints the
  // file and serves it from our own domain rather than a CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

  // The loading task is kept, not just its promise: it owns the worker, and
  // destroying it at the end is what stops a worker per imported file.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    password,
    // Nothing here draws anything, so the font machinery is dead weight.
    disableFontFace: true,
  });

  let document;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy();

    // pdf.js reports both "needs a password" and "that password is wrong" as
    // a PasswordException. To somebody holding the file they are the same
    // problem, and the message says what to do about it.
    if (error !== null && typeof error === 'object' && 'name' in error) {
      if (error.name === 'PasswordException') {
        throw new PasswordNeeded(
          'That did not open the file. An eCAS is password-protected — the password is the one named in the email it came with.',
        );
      }
    }
    throw new Error('That file could not be read as a PDF.');
  }

  const lines: string[] = [];
  // Read before the document is destroyed below, which takes the count with it.
  const pages = document.numPages;

  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();

    // Group by baseline, then order left to right. A PDF's text items arrive
    // in whatever order they were drawn, which for a table is often column by
    // column — reading them in that order would interleave every row.
    const rows = new Map<number, { x: number; text: string }[]>();

    for (const raw of content.items as readonly TextItem[]) {
      const text = raw.str ?? '';
      if (text.trim() === '') continue;

      const transform = raw.transform ?? [];
      const x = transform[4] ?? 0;
      const y = transform[5] ?? 0;

      const key = [...rows.keys()].find((at) => Math.abs(at - y) <= LINE_TOLERANCE) ?? y;
      const row = rows.get(key) ?? [];
      row.push({ x, text });
      rows.set(key, row);
    }

    // Down the page: a PDF's y grows upward, so the largest baseline is the
    // top row.
    const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);

    for (const [, row] of ordered) {
      const line = row
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (line !== '') lines.push(line);
    }

    page.cleanup();
  }

  await task.destroy();

  return { lines, pages };
}
