import { useCallback, useEffect, useState } from 'react';
import { formatIsoDate, istCalendarDate } from '../../lib/dates.ts';
import { buildTemplate } from '../../domain/export/template.ts';
import { saveFile, writeWorkbookFile, XLSX_MIME } from '../../lib/workbookFile.ts';
import { UploadError, listUploads, type UploadBatch } from '../../repo/upload.ts';
import { Button, Field, Problem } from '../../ui/primitives.tsx';
import { commitUpload, previewUpload, reverseUpload, sheetName, type Preview } from './runUpload.ts';

/**
 * Bringing a workbook back (docs/blueprint.md section 17, docs/build-plan.md step 5; docs/decisions.md, Upload).
 *
 * A person chooses the workbook they exported and edited, and sees what uploading it would do before anything is written: the rows
 * to add, the rows to change and in which columns, the rows that are the same, and every problem by sheet, row and column. The
 * button that writes is offered only when there is none, and asks for a fresh authenticator code. It is all or none: the database
 * writes every row or none of them. The uploads made are listed, and the person who made one can reverse it as a unit.
 *
 * The file is read on this device. Nothing is uploaded to be turned into rows.
 */

const SHOWN = 15;

function ago(instant: string): string {
  return formatIsoDate(istCalendarDate(new Date(instant)));
}

export function UploadPanel({ householdId }: { householdId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadBatch[]>([]);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reverseCode, setReverseCode] = useState('');
  const [fileKey, setFileKey] = useState(0);

  const reloadUploads = useCallback(async () => {
    try {
      setUploads(await listUploads(householdId));
    } catch {
      // Until the upload migration is applied there is no list, and that is not a failure of the screen.
      setUploads([]);
    }
  }, [householdId]);

  useEffect(() => {
    void reloadUploads();
  }, [reloadUploads]);

  const downloadTemplate = async () => {
    setProblem(null);
    try {
      const bytes = await writeWorkbookFile(buildTemplate(new Date().toISOString()).sheets, { sample: false });
      saveFile(bytes, 'family-finance-buddy-template.xlsx', XLSX_MIME);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not make the template.');
    }
  };

  const choose = async (file: File | undefined) => {
    setPreview(null);
    setProblem(null);
    setDone(null);
    setCode('');
    if (file === undefined) return;
    setReading(true);
    try {
      setPreview(await previewUpload(householdId, file));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not read that file.');
    } finally {
      setReading(false);
    }
  };

  const plan = preview?.plan ?? null;
  const created = plan?.rows.filter((row) => row.action === 'create' && row.entity !== 'instrument').length ?? 0;
  const changed = plan?.rows.filter((row) => row.action === 'update' || (row.action === 'create' && row.entity === 'instrument')).length ?? 0;
  const unchanged = Object.values(plan?.unchanged ?? {}).reduce((sum, count) => sum + count, 0);
  const clean = plan !== null && plan.problems.length === 0 && (preview?.readProblems.length ?? 0) === 0;
  const total = plan?.rows.length ?? 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (plan === null || preview === null) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setProblem('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const applied = await commitUpload(householdId, preview.filename, plan, code);
      setDone(`Done. ${String(applied.inserted)} added and ${String(applied.updated)} changed, in one go. You can reverse it below.`);
      setPreview(null);
      setCode('');
      setFileKey((key) => key + 1);
      await reloadUploads();
    } catch (error) {
      if (error instanceof UploadError && error.entity !== undefined) {
        setProblem(`${sheetName(error.entity)}${error.row === undefined ? '' : `, row ${String(error.row)}`}: ${error.message} Nothing was written.`);
      } else {
        setProblem(error instanceof Error ? error.message : 'Could not write the workbook.');
      }
    } finally {
      setBusy(false);
    }
  };

  const reverse = async (event: React.FormEvent, batch: UploadBatch) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(reverseCode.trim())) {
      setProblem('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const reversed = await reverseUpload(batch.id, reverseCode);
      setDone(`Reversed. ${String(reversed.restored)} put back as they were and ${String(reversed.removed)} removed.`);
      setReversing(null);
      setReverseCode('');
      // What a file would do changed with the household, so a preview made before is no longer true.
      setPreview(null);
      setFileKey((key) => key + 1);
      await reloadUploads();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not reverse that upload.');
    } finally {
      setBusy(false);
    }
  };

  const problems = [...(preview?.readProblems ?? []), ...(plan?.problems ?? [])];
  const updates = plan?.rows.filter((row) => row.action === 'update' && row.changes.length > 0) ?? [];
  const lines = updates.flatMap((row) => row.changes.map((change) => `${row.sheet}, row ${String(row.sheetRow)}: ${change.column}: ${change.from ?? 'empty'} → ${change.to ?? 'empty'}`));

  return (
    <section className="card mt-3" aria-label="Bring a workbook back">
      <div className="label">Bring a workbook back</div>
      <h2 className="card-title mt-1.5 text-[1.1875rem] leading-snug">Upload what you edited</h2>
      <p className="note mt-1.5">
        Choose the workbook you exported and changed. You see what it would do before anything is written, and it is all or none.
        Rows you leave out are left alone: an upload never deletes.
      </p>

      <div className="mt-3">
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            void downloadTemplate();
          }}
        >
          Download a blank template
        </Button>
        <p className="note mt-1.5">Headers, a dropdown on every column with fixed choices, and instructions. Nothing about your household is in it.</p>
      </div>

      <div className="mt-3">
        <label className="label" htmlFor="upload-file">
          Workbook (.xlsx)
        </label>
        <input
          key={fileKey}
          id="upload-file"
          className="field mt-1.5"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={reading || busy}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
          }}
        />
      </div>

      {reading && (
        <p className="note mt-2.5" role="status">
          Reading the workbook…
        </p>
      )}

      {problem !== null && (
        <div className="mt-2.5">
          <Problem>{problem}</Problem>
        </div>
      )}
      {done !== null && (
        <p className="note mt-2.5" role="status" data-testid="upload-done">
          {done}
        </p>
      )}

      {preview !== null && (
        <div className="mt-3" data-testid="upload-preview">
          <h3 className="label">What uploading {preview.filename} would do</h3>

          {problems.length > 0 ? (
            <div className="mt-1.5" data-testid="upload-problems">
              <Problem>
                {String(problems.length)} {problems.length === 1 ? 'thing needs' : 'things need'} putting right in the workbook. Nothing is written until
                they are.
              </Problem>
              <ul className="note mt-1.5 list-disc pl-5">
                {problems.slice(0, SHOWN).map((item, index) => (
                  <li key={`${item.sheet}-${String(item.row)}-${item.column}-${String(index)}`}>
                    {item.sheet}, row {item.row}, {item.column}: {item.message}
                  </li>
                ))}
              </ul>
              {problems.length > SHOWN && <p className="note mt-1">and {problems.length - SHOWN} more.</p>}
            </div>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1" data-testid="upload-counts">
              <li>
                <strong data-testid="upload-add">{created}</strong> to add
              </li>
              <li>
                <strong data-testid="upload-change">{changed}</strong> to change
              </li>
              <li>
                <strong data-testid="upload-same">{unchanged}</strong> the same as now, left alone
              </li>
            </ul>
          )}

          {clean && lines.length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer">What changes ({lines.length})</summary>
              <ul className="note mt-1.5 list-disc pl-5">
                {lines.slice(0, 40).map((line, index) => (
                  <li key={`${line}-${String(index)}`} className="tabular-nums">
                    {line}
                  </li>
                ))}
              </ul>
              {lines.length > 40 && <p className="note mt-1">and {lines.length - 40} more.</p>}
            </details>
          )}

          {clean && (plan?.warnings.length ?? 0) > 0 && (
            <p className="note mt-2.5" data-testid="upload-warnings">
              {plan?.warnings.length} new {plan?.warnings.length === 1 ? 'row has' : 'rows have'} no ref, so the same file uploaded again would add{' '}
              {plan?.warnings.length === 1 ? 'it' : 'them'} twice. Give a new row a ref of your own to avoid that.
            </p>
          )}

          {clean && total > 0 && (
            <form
              className="mt-3 flex flex-col gap-2.5"
              aria-label="Confirm the upload"
              onSubmit={(event) => {
                void submit(event);
              }}
            >
              <Field
                label="Code from your authenticator app"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
              <p className="note">An upload changes the household&rsquo;s record, so it asks for a fresh code first.</p>
              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Writing…' : `Add ${String(created)} and change ${String(changed)}`}
                </Button>
              </div>
            </form>
          )}
          {clean && total === 0 && (
            <p className="note mt-2.5" role="status" data-testid="upload-nothing">
              There is nothing to write: every row is the same as the household holds.
            </p>
          )}
        </div>
      )}

      {uploads.length > 0 && (
        <div className="mt-4" data-testid="upload-list">
          <h3 className="label">Recent uploads</h3>
          <ul className="row-separated mt-1">
            {uploads.map((batch) => (
              <li key={batch.id} className="flex flex-col gap-1.5 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    {batch.label ?? 'A workbook'} <span className="note">· {ago(batch.createdAt)} · {batch.rowCount} rows</span>
                  </span>
                  {batch.reversedAt !== null ? (
                    <span className="note">Reversed {ago(batch.reversedAt)}</span>
                  ) : batch.mine ? (
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={busy}
                      onClick={() => {
                        setReversing(reversing === batch.id ? null : batch.id);
                        setReverseCode('');
                        setProblem(null);
                      }}
                    >
                      Reverse
                    </Button>
                  ) : null}
                </div>
                {reversing === batch.id && (
                  <form
                    className="flex flex-col gap-2"
                    aria-label="Confirm the reversal"
                    onSubmit={(event) => {
                      void reverse(event, batch);
                    }}
                  >
                    <p className="note">
                      Puts back the rows this upload changed and removes the ones it added, if nothing has changed them since. It is all or none.
                    </p>
                    <Field
                      label="Code from your authenticator app"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={reverseCode}
                      onChange={(event) => {
                        setReverseCode(event.target.value);
                      }}
                    />
                    <div>
                      <Button type="submit" disabled={busy}>
                        Reverse this upload
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
