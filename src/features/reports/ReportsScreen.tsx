import { useState } from 'react';
import type { HouseholdRole } from '../../repo/types.ts';
import { formatIsoDate, istCalendarDate } from '../../lib/dates.ts';
import { Button, Problem, SampleBar } from '../../ui/primitives.tsx';
import { CodeForm } from './CodeForm.tsx';
import { readLastExport } from './exportFile.ts';
import { exportOffer } from './exportOffer.ts';
import { runReport } from './runExport.ts';
import { runTemplate } from './runTemplate.ts';
import { UploadPanel } from './UploadPanel.tsx';

/**
 * Reports (docs/design/vibrant-canvas.html, Reports; docs/design/export-redesign.md section 4; docs/blueprint.md sections 14 and 17).
 *
 * *Download a report* is the main action: the household's figures as a workbook a person reads, with sheets, charts and live formulas. *Download the template*
 * sits beside it, for adding a lot at once, and *Bring a workbook back* (`UploadPanel.tsx`) below it takes a filled template, or a complete backup that was edited,
 * back in. The complete backup, the file for a restore, is in Settings under Data. The year-end pack, the capital-gains statement and the rest of the board are
 * step 5's later work and are not drawn here until they exist.
 *
 * The files are made on this device from what the signed-in person can already read; nothing is uploaded. A fresh authenticator code is asked for before the report,
 * since it takes the household's figures out of the app. The template holds only the household's names and is made without one.
 */
export function ReportsScreen({ householdId, isDemo, privacy, role }: { householdId: string | null; isDemo: boolean; privacy: boolean; role: HouseholdRole | null }) {
  const [asking, setAsking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState(() => (householdId === null ? null : readLastExport(householdId)));
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateSaved, setTemplateSaved] = useState<string | null>(null);
  const [templateProblem, setTemplateProblem] = useState<string | null>(null);

  if (householdId === null) return null;
  const offer = exportOffer(role);

  const downloadTemplate = async () => {
    setTemplateBusy(true);
    setTemplateProblem(null);
    setTemplateSaved(null);
    try {
      const made = await runTemplate(householdId);
      setTemplateSaved(made.filename);
    } catch (error) {
      setTemplateProblem(error instanceof Error ? error.message : 'Could not make the template.');
    } finally {
      setTemplateBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      {isDemo && (
        <SampleBar title="Sample figures">
          This is the demo household. Its files are marked as a sample in the file&rsquo;s name and on its first sheet, so they cannot be
          taken for a real household&rsquo;s.
        </SampleBar>
      )}
      <section className="card card-lift" aria-label="Download a report">
        <div className="label">Report</div>
        <h2 className="card-title mt-1.5 text-[1.1875rem] leading-snug">Your household, in a workbook to read</h2>
        <p className="note mt-1.5">
          Sheets for your spending, investments, deposits and the rest, with a summary and charts on the first. The figures are live: change one and the totals follow.
          {offer.template && ' To add a lot at once, download the template, fill it in and bring it back below.'}
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

        {offer.report &&
          (asking ? (
            <CodeForm
              label="Confirm the download"
              submitLabel="Download a report"
              busyLabel="Making the report…"
              note="A report takes the household’s figures out of the app, so it asks for a fresh code first."
              run={async (code) => {
                const made = await runReport(householdId, code);
                setLastExport(made.exportedAt);
                return made;
              }}
              onDone={(made) => {
                setSaved(made.filename);
                setAsking(false);
              }}
              onCancel={() => {
                setAsking(false);
              }}
            />
          ) : (
            <div className="export-row mt-3.5 flex flex-wrap gap-2">
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
                <span>Download a report</span>
              </Button>
              {offer.template && (
                <Button
                  type="button"
                  variant="quiet"
                  disabled={templateBusy}
                  onClick={() => {
                    void downloadTemplate();
                  }}
                >
                  {templateBusy ? 'Making the template…' : 'Download the template'}
                </Button>
              )}
            </div>
          ))}

        {saved !== null && (
          <p className="note mt-2.5" role="status" data-testid="export-saved">
            Saved <span className="tabular-nums">{saved}</span> to your downloads.
          </p>
        )}
        {templateSaved !== null && (
          <p className="note mt-2.5" role="status" data-testid="template-saved">
            Saved <span className="tabular-nums">{templateSaved}</span> to your downloads.
          </p>
        )}
        {templateProblem !== null && (
          <div className="mt-2.5">
            <Problem>{templateProblem}</Problem>
          </div>
        )}
        <p className="note mt-2 text-center tabular-nums" data-testid="last-export">
          {lastExport === null
            ? 'Not downloaded from this device yet'
            : `Last downloaded on this device ${formatIsoDate(istCalendarDate(new Date(lastExport)))}`}
        </p>
      </section>

      <UploadPanel householdId={householdId} privacy={privacy} />
    </div>
  );
}
