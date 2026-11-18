import { useState } from 'react';
import { Button, Field, Problem } from '../../ui/primitives.tsx';
import { ExportBlocked } from './runExport.ts';

/**
 * The step before a file that takes the household's figures out of the app: a fresh code from the authenticator, then the file is made on this device.
 *
 * Shared by the report on Reports and the complete backup in Settings, so the two ask the same way and say the same things when the code is wrong or the
 * data cannot be written to a spreadsheet exactly. What it runs, and what it says afterwards, belong to whoever opens it.
 */
export function CodeForm({
  label,
  submitLabel,
  busyLabel,
  note,
  run,
  onDone,
  onCancel,
}: {
  /** The form's accessible name. */
  label: string;
  submitLabel: string;
  busyLabel: string;
  note: string;
  run: (code: string) => Promise<{ readonly filename: string }>;
  onDone: (made: { readonly filename: string }) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ExportBlocked | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setProblem('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setBlocked(null);
    try {
      const made = await run(code);
      setCode('');
      onDone(made);
    } catch (error) {
      if (error instanceof ExportBlocked) setBlocked(error);
      else setProblem(error instanceof Error ? error.message : 'Could not make the file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form
        className="mt-3.5 flex flex-col gap-2.5"
        aria-label={label}
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
          // The field appears because the person asked for the file, so it is where they are about to type.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
        <p className="note">{note}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} className="btn btn-primary export-action">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
            <span>{busy ? busyLabel : submitLabel}</span>
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={() => {
              setCode('');
              setProblem(null);
              setBlocked(null);
              onCancel();
            }}
          >
            Cancel
          </Button>
        </div>
      </form>

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
          {blocked.problems.length > 8 && <p className="note mt-1">and {blocked.problems.length - 8} more. Fix these, and the file will list what is left.</p>}
        </div>
      )}
    </>
  );
}
