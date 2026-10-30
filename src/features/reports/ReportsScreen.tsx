import { useState } from 'react';
import { formatIsoDate, istCalendarDate } from '../../lib/dates.ts';
import { Button, Field, Problem, SampleBar } from '../../ui/primitives.tsx';
import { readLastExport } from './exportFile.ts';
import { ExportBlocked, runFullExport } from './runExport.ts';

/**
 * Reports (docs/design/vibrant-canvas.html, Reports; docs/blueprint.md sections 14 and 17; docs/build-plan.md, step 5).
 *
 * Only Export everything is built: the household as one workbook, a sheet for each kind of record, in the shape the upload
 * template will take. The year-end pack, the capital-gains statement and the rest of the board are step 5's later work and are
 * not drawn here until they exist.
 *
 * The file is made on this device from what the signed-in person can already read; nothing is uploaded. A fresh authenticator
 * code is asked for first, since an export takes the whole record out of the app; the board draws the button alone.
 */
export function ReportsScreen({ householdId, isDemo }: { householdId: string | null; isDemo: boolean }) {
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ExportBlocked | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState(() => (householdId === null ? null : readLastExport(householdId)));

  if (householdId === null) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setProblem('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setBlocked(null);
    setSaved(null);
    try {
      const made = await runFullExport(householdId, code);
      setSaved(made.filename);
      setLastExport(made.exportedAt);
      setCode('');
      setAsking(false);
    } catch (error) {
      if (error instanceof ExportBlocked) setBlocked(error);
      else setProblem(error instanceof Error ? error.message : 'Could not make the export.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {isDemo && (
        <SampleBar title="Sample figures">
          This is the demo household. Its export is marked as a sample in the file&rsquo;s name and on its first sheet, so it cannot be
          taken for a real household&rsquo;s.
        </SampleBar>
      )}
      <section className="card card-lift" aria-label="Export everything">
        <div className="label">Export everything</div>
        <h2 className="card-title mt-1.5 text-[1.1875rem] leading-snug">Your whole household, as one workbook</h2>
        <p className="note mt-1.5">
          A sheet for each kind of record, in the same shape as the upload template, so you can edit it in Excel and bring it back.
        </p>
        <ul className="note mt-3 flex flex-col gap-1.5">
          <li className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Made on this device. Nothing is uploaded.
          </li>
          <li className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 11v5" />
              <path d="M12 8h.01" />
            </svg>
            Holds what you can see; others&rsquo; private entries stay out.
          </li>
        </ul>

        {asking ? (
          <form
            className="mt-3.5 flex flex-col gap-2.5"
            aria-label="Confirm the export"
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
              // The field appears because the person asked to export, so it is where they are about to type.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
            <p className="note">An export takes the whole record out of the app, so it asks for a fresh code first.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy} className="btn btn-primary export-action">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
                <span>{busy ? 'Making the workbook…' : 'Export everything · Excel'}</span>
              </Button>
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={() => {
                  setAsking(false);
                  setCode('');
                  setProblem(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-3.5">
            <Button
              type="button"
              className="btn btn-primary export-action"
              onClick={() => {
                setAsking(true);
                setSaved(null);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
              <span>Export everything · Excel</span>
            </Button>
          </div>
        )}

        {problem !== null && (
          <div className="mt-2.5">
            <Problem>{problem}</Problem>
          </div>
        )}
        {blocked !== null && (
          <div className="mt-2.5">
            <Problem>{blocked.message} Nothing was saved.</Problem>
            <ul className="note mt-1.5 list-disc pl-5">
              {blocked.problems.slice(0, 8).map((item) => (
                <li key={`${item.sheet}-${String(item.row)}-${item.column}`}>
                  {item.sheet}, row {item.row}, {item.column}: {item.message}
                </li>
              ))}
            </ul>
            {blocked.problems.length > 8 && (
              <p className="note mt-1">and {blocked.problems.length - 8} more. Fix these, and the export will list what is left.</p>
            )}
          </div>
        )}
        {saved !== null && (
          <p className="note mt-2.5" role="status" data-testid="export-saved">
            Saved <span className="tabular-nums">{saved}</span> to your downloads.
          </p>
        )}
        <p className="note mt-2 text-center tabular-nums" data-testid="last-export">
          {lastExport === null
            ? 'Not exported from this device yet'
            : `Last exported on this device ${formatIsoDate(istCalendarDate(new Date(lastExport)))}`}
        </p>
      </section>
    </div>
  );
}
