/**
 * Settings — two groups, deliberately separated.
 *
 * "Device settings need nobody's permission and affect only you. Household
 * settings change the app for everyone — owners and partners edit them,
 * everyone else sees them read-only, so the rules are never a mystery."
 *
 * The separation is the design. A screen that mixed them would leave every
 * member guessing which of their changes the household is about to notice,
 * and the honest answer to "why can't I edit this?" should be legible from
 * where the row sits rather than from an error after trying.
 *
 * Minimal and growing, on purpose. Each row here is one somebody can actually
 * change today; a row showing a value nothing reads would be a promise the app
 * has not made yet. The prototype's fuller list arrives a row at a time, as
 * the thing behind each one gets built.
 */

import { useState } from 'react';
import { HouseholdScreen } from '../household/HouseholdScreen.tsx';
import { ThemeToggle, type ThemeChoice } from '../../app/theme.tsx';
import { Button, Card, Pill, Problem } from '../../ui/primitives.tsx';
import { useHouseholdChoice } from '../../app/household.tsx';
import { resetDemoHousehold } from '../../repo/households.ts';

export function SettingsScreen({
  householdId,
  theme,
  onTheme,
  hideAmountsByDefault,
  onHideAmountsByDefault,
}: {
  householdId: string | null;
  theme: ThemeChoice;
  onTheme: (next: ThemeChoice) => void;
  hideAmountsByDefault: boolean;
  onHideAmountsByDefault: (next: boolean) => void;
}) {
  const { current, reload } = useHouseholdChoice();
  const household = current?.household ?? null;
  const role = current?.role ?? null;
  const canEdit = role === 'owner' || role === 'partner';

  // Bumped by a reset so the members list below remounts and reads again: the
  // reset replaces the members nobody signs in as, and a list still showing
  // the old ones would be describing a household that no longer exists.
  const [resets, setResets] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="grouphead">
          <h2>This device</h2>
          <span className="who">Yours alone · no permission needed</span>
        </div>

        <div className="setgrp">
          <div className="setrow">
            <div>
              <div className="sk">Theme</div>
              <div className="sd">Light, dark, or follow the system</div>
            </div>
            <ThemeToggle choice={theme} onChange={onTheme} />
          </div>

          <div className="setrow">
            <div>
              <div className="sk">Hide amounts by default</div>
              <div className="sd">
                Opens with figures masked; one tap in the top bar reveals them. Worth turning on
                for a device other people pick up.
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hideAmountsByDefault}
                onChange={(event) => {
                  onHideAmountsByDefault(event.target.checked);
                }}
              />
              <span className="sv">{hideAmountsByDefault ? 'On' : 'Off'}</span>
            </label>
          </div>
        </div>

        <p className="note mt-2">
          Both are remembered on this device only. A different phone, or a private window, starts
          from the default again.
        </p>
      </section>

      <section>
        <div className="grouphead">
          <h2>This household</h2>
          <span className="who">
            {canEdit ? 'You can edit these' : 'Owner and partner can edit · you see them read-only'}
          </span>
        </div>

        <div className="setgrp">
          <div className="setrow">
            <div>
              <div className="sk">Household name</div>
              <div className="sd">Shown in the switcher and on exports</div>
            </div>
            <span className="sv">{household?.name ?? '—'}</span>
          </div>

          <div className="setrow">
            <div>
              <div className="sk">Base currency</div>
              <div className="sd">Net worth, FIRE and allocation are computed in this</div>
            </div>
            <span className="sv">{household?.baseCurrency ?? '—'}</span>
          </div>

          <div className="setrow">
            <div>
              <div className="sk">Tax year starts</div>
              <div className="sd">
                Foreign-asset reporting still uses the calendar year — the two calendars both
                apply and neither replaces the other
              </div>
            </div>
            <span className="sv">1 April</span>
          </div>

          <div className="setrow">
            <div>
              <div className="sk">Kind</div>
              <div className="sd">
                A demo household carries a badge everywhere, so there is never a moment of
                wondering which figures you are looking at
              </div>
            </div>
            {household?.kind === 'demo' ? (
              <Pill tone="warn">Demo</Pill>
            ) : (
              <Pill tone="own">Real</Pill>
            )}
          </div>
        </div>

        <p className="note mt-2">
          These are shown rather than editable for now. Each becomes editable as the screen that
          depends on it is built — a settable value nothing reads yet would be a promise the app
          has not made.
        </p>
      </section>

      {/*
        Members and invitations, which used to be a tab of its own.
        Administering who is in a household is a household setting, and having
        it as a peer of Expenses implied it was somewhere you go regularly. It
        is somewhere you go twice a year.
      */}
      <section>
        <div className="grouphead">
          <h2>Members and invitations</h2>
          <span className="who">Invite-only, single use, expiring</span>
        </div>
        <HouseholdScreen key={resets} householdId={householdId} />
      </section>

      {/*
        Data. The prototype's group also holds the template, the upload, the
        export and deleting a household; each arrives with the thing behind
        it. Only the reset exists today, and only a demo household has one — on
        a real household the row would be offering something the database will
        always refuse.
      */}
      {household?.kind === 'demo' && householdId !== null && (
        <section>
          <div className="grouphead">
            <h2>Data</h2>
            <span className="who">
              {role === 'owner' ? 'Owner only' : 'Owner only · you see it read-only'}
            </span>
          </div>

          <ResetDemoHousehold
            householdId={householdId}
            householdName={household.name}
            isOwner={role === 'owner'}
            onReset={() => {
              setResets((n) => n + 1);
              reload();
            }}
          />
        </section>
      )}

      <Card title="Spending plan">
        <p className="note">
          Categories and their planned figures live together on the Expenses screen, because they
          are the same decision: naming a category and saying what it should cost is one thought,
          and separating them would mean visiting two screens to set one envelope. The
          household-wide parts — nesting, reordering, archiving policy — move here when they
          exist.
        </p>
      </Card>

      <Card
        title="Not here yet"
        collapsible
        defaultOpen={false}
        summary="What this screen will hold as the things behind each row get built."
      >
        <p className="note">
          Number grouping, auto-lock, biometric unlock, the opening screen, allocation profile,
          price sources, the monthly snapshot and the export flows all belong on this screen. Each
          arrives with the thing it configures rather than ahead of it.
        </p>
      </Card>
    </div>
  );
}

/**
 * The one control in the app that destroys data.
 *
 * Behind a confirmation that says exactly what goes and what stays, because
 * the two lists are the whole decision: somebody who has been logging real
 * spending in the demo household to try the entry flow should find that out
 * here, not afterwards. The database refuses anyone but the owner, anything
 * without a second factor, and any household not marked demo — this screen only
 * avoids offering what would be refused.
 */
function ResetDemoHousehold({
  householdId,
  householdName,
  isOwner,
  onReset,
}: {
  householdId: string;
  householdName: string;
  isOwner: boolean;
  onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <>
      <div className="setgrp">
        <div className="setrow">
          <div>
            <div className="sk">Reset the demo household</div>
            <div className="sd">Wipes and reseeds it — your real household is untouched</div>
          </div>
          {isOwner ? (
            !confirming && (
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setConfirming(true);
                  setDone(false);
                  setProblem(null);
                }}
              >
                Reset…
              </Button>
            )
          ) : (
            <Pill tone="neutral">Owner only</Pill>
          )}
        </div>
      </div>

      {confirming && (
        <div className="mt-3">
          <p className="text-caption" style={{ color: 'var(--ink-2)' }}>
            Reset <strong>{householdName}</strong>? Every expense, category, budget, holding,
            purchase, sale, valuation, rate, loan and policy in it is permanently deleted, and so is
            anyone in it who does not sign in. Then the sample data goes back in. Anything you have
            typed into this household yourself is lost and cannot be restored.
          </p>
          <p className="text-caption mt-2" style={{ color: 'var(--ink-2)' }}>
            What stays: the household itself, everyone who signs in and their roles, invitations,
            and the activity history — which will record each deletion under your name.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setProblem(null);
                resetDemoHousehold(householdId)
                  .then(() => {
                    setDone(true);
                    setConfirming(false);
                    onReset();
                  })
                  .catch((error: unknown) => {
                    setProblem(
                      error instanceof Error ? error.message : 'Could not reset the demo household.',
                    );
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {busy ? 'Resetting…' : 'Yes, wipe and reseed it'}
            </Button>
            <button
              type="button"
              className="note underline"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setProblem(null);
              }}
            >
              Keep it as it is
            </button>
          </div>
        </div>
      )}

      {problem !== null && (
        <div className="mt-2">
          <Problem>{problem}</Problem>
        </div>
      )}

      {done && (
        <p className="note mt-2" role="status">
          Reset. The demo household holds the sample data again, edge cases and all.
        </p>
      )}
    </>
  );
}
