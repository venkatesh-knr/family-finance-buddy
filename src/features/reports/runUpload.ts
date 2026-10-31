import { ENTITY_BY_KEY } from '../../domain/export/entities.ts';
import { planUpload, toApplyPayload, type UploadPlan } from '../../domain/export/plan.ts';
import { readWorkbook, type Problem } from '../../domain/export/workbook.ts';
import { readWorkbookFile } from '../../lib/workbookFile.ts';
import { verifyTotpCode } from '../../repo/auth.ts';
import { readEverything } from '../../repo/export.ts';
import { applyTemplate, reverseTemplate, type Applied, type Reversed } from '../../repo/upload.ts';

/** A workbook this large is not a household's records. It is refused before it is read into memory twice. */
const MAX_BYTES = 15 * 1024 * 1024;

export interface Preview {
  readonly filename: string;
  /** Problems with the file itself (a version, a missing column, a cell that is not an amount). Nothing is planned while there are any. */
  readonly readProblems: readonly Problem[];
  readonly plan: UploadPlan | null;
}

/** Read a chosen file and say what uploading it would do. Nothing is written. */
export async function previewUpload(householdId: string, file: File): Promise<Preview> {
  if (file.size > MAX_BYTES) throw new Error('That file is too large to be a household’s workbook.');
  let sheets;
  try {
    sheets = await readWorkbookFile(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('That is not an .xlsx workbook, or it is damaged. Export the household, or download the template, and use that.');
  }
  const read = readWorkbook(sheets);
  if (read.problems.length > 0) return { filename: file.name, readProblems: read.problems, plan: null };

  const source = await readEverything(householdId);
  const plan = planUpload({ read, existing: source.tables, existingRefs: source.refs, newId: () => crypto.randomUUID() });
  return { filename: file.name, readProblems: [], plan };
}

/**
 * The label an upload is remembered by: what the person typed, or a neutral one made from the day. Never the file's name: a file is
 * often called after what is in it (a PAN, an account), and the household reads this label and the audit log it is written to.
 */
export function labelFor(typed: string, isoDate: string): string {
  const cleaned = typed.trim().replace(/\s+/g, ' ').slice(0, 120);
  return cleaned === '' ? `Upload of ${isoDate}` : cleaned;
}

/**
 * Write what the preview showed. A fresh authenticator code first, as for an export: an upload changes the household's whole record,
 * and a device left unlocked should not be enough. The database refuses all of it or accepts all of it.
 */
export async function commitUpload(householdId: string, label: string, plan: UploadPlan, code: string): Promise<Applied> {
  if (plan.problems.length > 0) throw new Error('There are problems in the workbook; nothing is written until they are put right.');
  await verifyTotpCode(code);
  return applyTemplate(householdId, label, toApplyPayload(plan));
}

export async function reverseUpload(batchId: string, code: string): Promise<Reversed> {
  await verifyTotpCode(code);
  return reverseTemplate(batchId);
}

/** The sheet's name for an entity, for a message. */
export const sheetName = (entity: string): string => ENTITY_BY_KEY.get(entity)?.sheet ?? entity;
