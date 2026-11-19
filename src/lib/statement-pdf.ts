/**
 * Opening a bank, card or UPI statement PDF, on the device (docs/build-plan.md step 7).
 *
 * The browser's own PDF engine takes the password and decrypts the file, so this needs no service and no key of ours, and a statement that lists every transaction is never
 * uploaded anywhere. Like `ecas-pdf.ts` it reads bytes and returns text, and is the whole of the I/O: what the text means is `src/domain/statement/`, which is pure. The difference
 * is that a bank statement's columns say which way money went, so each row keeps its cells and where they sit (`rowsFromItems`), not a line joined with spaces.
 *
 * Loaded on demand, nothing is rendered so no fonts are built (the content-security policy forbids what that needs), and the password is used once and not kept.
 */

import { rowsFromItems, type PdfPage } from '../domain/statement/pdfRows.ts';
import { PasswordNeeded } from './ecas-pdf.ts';

interface Item {
  readonly str?: string;
  readonly transform?: readonly number[];
  readonly width?: number;
}

/** The pages of a statement as rows of cells. A file that needs a password, or was given the wrong one, throws `PasswordNeeded`. */
export async function readStatementPages(bytes: ArrayBuffer, password: string): Promise<readonly PdfPage[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  // Same origin, which `worker-src 'self'` requires.
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password, disableFontFace: true });
  let document;
  try {
    document = await task.promise;
  } catch (error) {
    await task.destroy();
    // pdf.js reports "needs a password" and "that password is wrong" as one exception, and to somebody holding the file they are the same problem.
    if (error !== null && typeof error === 'object' && 'name' in error && error.name === 'PasswordException') {
      throw new PasswordNeeded('That did not open the file. A bank or card statement is usually protected by a password the bank gave you, often built from your name and date of birth.');
    }
    throw new Error('That file could not be read as a PDF.');
  }

  const pages: PdfPage[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    pages.push({
      rows: rowsFromItems(
        (content.items as readonly Item[]).map((item) => ({ text: item.str ?? '', x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0, width: item.width ?? 0 })),
      ),
    });
    page.cleanup();
  }
  await task.destroy();
  return pages;
}
