import { useCallback, useEffect, useState } from 'react';
import { buildTemplate } from '../../domain/export/template.ts';
import { formatIsoDate, istCalendarDate } from '../../lib/dates.ts';
import { saveFile, writeWorkbookFile, XLSX_MIME } from '../../lib/workbookFile.ts';
import { UploadError, listUploads, type UploadBatch } from '../../repo/upload.ts';
import { Button, Field, Problem } from '../../ui/primitives.tsx';
import { commitUpload, labelFor, previewUpload, reverseUpload, sheetName, type Preview } from './runUpload.ts';

/**
 * Bringing a workbook back (docs/blueprint.md section 17, docs/build-plan.md step 5; docs/decisions.md, Upload).
 *
 * A person chooses the workbook they exported and edited, and sees what uploading it would do before anything is written: every row
 * to add, every row to change and in which columns, the rows that are the same, and every problem by sheet, row and column. The
 * button that writes is offered only when there is no problem, and asks for a fresh authenticator code. It is all or none: the
 * database writes every row or none of them. The uploads made are listed, and the person who made one can reverse it as a unit.
 *
 * The file is read on this device. Nothing is uploaded to be turned into rows. An upload is remembered by a name the person gives it
 * and never by the file's, which may be called after what is in it.
 */

/** How many problems are shown before the rest are behind a disclosure. */
const SHOWN = 15;
/** The most rows a list shows: a workbook of more is listed to here and counted beyond it. */
const CEILING = 500;

const MASK = '•••••';

const when = (instant: string): string => formatIsoDate(istCalendarDate(new Date(instant)));

export function UploadPanel({ householdId, privacy }: { householdId: string; privacy: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadBatch[]>([]);
  const [listProblem, setListProblem] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reverseCode, setReverseCode] = useState('');
  const [fileKey, setFileKey] = useState(0);

  const reloadUploads = useCallback(async () => {
    try {
      setUploads(await listUploads(householdId));
      setListProblem(null);
    } catch (error) {
      // Before the upload migration is applied there is no table to read, and no uploads to list: not a failure. Anything else is one,
      // and is said, so a failed read is never taken for having made no uploads.
      if (error instanceof UploadError && (error.code === '42P01' || error.code === 'PGRST205')) {
        setUploads([]);
        setListProblem(null);
      } else {
        setListProblem(error instanceof Error ? error.message : 'Could not read the uploads.');
      }
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
    setName('');
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
  const added = plan?.rows.filter((row) => row.action === 'create' && row.entity !== 'instrument') ?? [];
  const changedRows = plan?.rows.filter((row) => row.action === 'update' || (row.action === 'create' && row.entity === 'instrument')) ?? [];
  const unchanged = Object.values(plan?.unchanged ?? {}).reduce((sum, count) => sum + count, 0);
  const problems = [...(preview?.readProblems ?? []), ...(plan?.problems ?? [])];
  const clean = plan !== null && problems.length === 0;
  const total = plan?.rows.length ?? 0;

  const addedLines = added.map((row) => `${row.sheet}, row ${String(row.sheetRow)}: ${row.label ?? 'a new row'}`);
  const changeLines = (plan?.rows ?? [])
    .filter((row) => row.changes.length > 0)
    .flatMap((row) =>
      row.changes.map((change) => {
        const show = (value: string | null): string => (value === null ? 'empty' : privacy && change.money ? MASK : value);
        const shared = row.entity === 'instrument' ? ' (shared by every holding of it)' : '';
        return `${row.sheet}, row ${String(row.sheetRow)}: ${change.column}: ${show(change.from)} → ${show(change.to)}${shared}`;
      }),
    );
  const problemLines = problems.map((item) => `${item.sheet}, row ${String(item.row)}, ${item.column}: ${item.message}`);

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
      const label = labelFor(name, formatIsoDate(istCalendarDate(new Date())));
      const applied = await commitUpload(householdId, label, plan, code);
      setDone(`Done. ${String(applied.inserted)} added and ${String(applied.updated)} changed, in one go. You can reverse it below.`);
      setPreview(null);
      setCode('');
      setName('');
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

  return (
    <section className="card mt-3" aria-label="Bring a workbook back">
      <div className="label">Bring a workbook back</div>
      <h2 className="card-title mt-1.5 text-[1.1875rem] leading-snug">Upload what you edited</h2>
      <p className="note mt-1.5">
        Choose the workbook you exported and changed. You see what it would do before anything is written, and it is all or none. Rows
        you leave out are left alone: an upload never deletes.
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
                {String(problems.length)} {problems.length === 1 ? 'thing needs' : 'things need'} putting right in the workbook. Nothing is
                written until they are.
              </Problem>
              <ul className="note mt-1.5 list-disc pl-5">
                {problemLines.slice(0, SHOWN).map((line, index) => (
                  <li key={`${line}-${String(index)}`}>{line}</li>
                ))}
              </ul>
              {problemLines.length > SHOWN && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer">All {problemLines.length} problems</summary>
                  <ul className="note mt-1.5 list-disc pl-5">
                    {problemLines.slice(0, CEILING).map((line, index) => (
                      <li key={`all-${line}-${String(index)}`}>{line}</li>
                    ))}
                  </ul>
                  {problemLines.length > CEILING && <p className="note mt-1">and {problemLines.length - CEILING} more.</p>}
                </details>
              )}
            </div>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1" data-testid="upload-counts">
              <li>
                <strong data-testid="upload-add">{added.length}</strong> to add
              </li>
              <li>
                <strong data-testid="upload-change">{changedRows.length}</strong> to change
              </li>
              <li>
                <strong data-testid="upload-same">{unchanged}</strong> the same as now, left alone
              </li>
            </ul>
          )}

          {clean && addedLines.length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer">What will be added ({addedLines.length})</summary>
              <ul className="note mt-1.5 list-disc pl-5">
                {addedLines.slice(0, CEILING).map((line, index) => (
                  <li key={`add-${line}-${String(index)}`}>{line}</li>
                ))}
              </ul>
              {addedLines.length > CEILING && <p className="note mt-1">and {addedLines.length - CEILING} more.</p>}
            </details>
          )}

          {clean && changeLines.length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer">What changes ({changeLines.length})</summary>
              <ul className="note mt-1.5 list-disc pl-5">
                {changeLines.slice(0, CEILING).map((line, index) => (
                  <li key={`change-${line}-${String(index)}`} className="tabular-nums">
                    {line}
                  </li>
                ))}
              </ul>
              {changeLines.length > CEILING && <p className="note mt-1">and {changeLines.length - CEILING} more.</p>}
            </details>
          )}

          {clean && (plan?.warnings.length ?? 0) > 0 && (
            <p className="note mt-2.5" data-testid="upload-warnings">
              {plan?.warnings.length} new {plan?.warnings.length === 1 ? 'row has' : 'rows have'} no ref, so the same file uploaded again would
              add {plan?.warnings.length === 1 ? 'it' : 'them'} twice. Give a new row a ref of your own to avoid that.
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
                label="Name this upload (optional)"
                hint="So you can find it later. It is not the file's name."
                maxLength={120}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
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
                  {busy ? 'Writing…' : `Add ${String(added.length)} and change ${String(changedRows.length)}`}
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

      {listProblem !== null && (
        <div className="mt-3">
          <Problem>{listProblem}</Problem>
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
                    {batch.label ?? 'An upload'}{' '}
                    <span className="note">
                      · {when(batch.createdAt)} · {batch.rowCount} rows
                    </span>
                  </span>
                  {batch.reversedAt !== null ? (
                    <span className="note">Reversed {when(batch.reversedAt)}</span>
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
