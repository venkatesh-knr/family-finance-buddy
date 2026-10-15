/**
 * Settings: this device, this household, its members, and the one thing that destroys data.
 *
 * Drawn as docs/design/vibrant-canvas.html draws it: a few groups of plain rows, each a name and its value, with
 * a switch where it is a switch and a chevron where it opens a choice. The separation is still the design:
 * "Device settings need nobody's permission and affect only you. Household settings change the app for everyone,
 * owners and partners edit them, everyone else sees them read-only." A screen that mixed them would leave every
 * member guessing which of their changes the household is about to notice.
 *
 * Minimal and growing, on purpose. Each row here is one somebody can actually change today, or one that says
 * what is true; a row showing a value nothing reads would be a promise the app has not made yet.
 */

import { useEffect, useState } from 'react';
import { HouseholdScreen } from '../household/HouseholdScreen.tsx';
import { ThemeToggle, type ThemeChoice } from '../../app/theme.tsx';
import { Button, Problem } from '../../ui/primitives.tsx';
import { DemoBadge, useHouseholdChoice } from '../../app/household.tsx';
import { resetDemoHousehold } from '../../repo/households.ts';
import { listRates } from '../../repo/rates.ts';

function Chevron() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="setrow-chevron"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function SettingsScreen({
  householdId,
  theme,
  onTheme,
  hideAmountsByDefault,
  onHideAmountsByDefault,
  displayCurrency,
  onDisplayCurrency,
}: {
  householdId: string | null;
  theme: ThemeChoice;
  onTheme: (next: ThemeChoice) => void;
  hideAmountsByDefault: boolean;
  onHideAmountsByDefault: (next: boolean) => void;
  /** Empty means the household's base currency. */
  displayCurrency: string;
  onDisplayCurrency: (next: string) => void;
}) {
  const { current, reload } = useHouseholdChoice();
  const household = current?.household ?? null;
  const role = current?.role ?? null;

  // Bumped by a reset so the members list below remounts and reads again: the
  // reset replaces the members nobody signs in as, and a list still showing
  // the old ones would be describing a household that no longer exists.
  const [resets, setResets] = useState(0);

  /**
   * Which currencies this household can actually be read in.
   *
   * Its base, plus every currency it has recorded a rate against, in either
   * direction, since a rate reads both ways. Offering the full ISO list would
   * be offering a hundred and fifty choices that all answer "there is no rate
   * for that", which is a menu of disappointments.
   */
  const [convertible, setConvertible] = useState<readonly string[]>([]);
  // A rate list that did not load is a different thing from one with nothing in it, and the screen says which.
  const [ratesFailed, setRatesFailed] = useState(false);

  useEffect(() => {
    if (householdId === null) return;
    let live = true;
    listRates(householdId)
      .then((rates) => {
        if (live) {
          setConvertible([...new Set(rates.flatMap((r) => [r.base, r.quote]))]);
          setRatesFailed(false);
        }
      })
      .catch(() => {
        // A rate list that will not load is not worth a broken settings screen. The base currency alone is a
        // correct, if narrow, set of options, and the row says the rates could not be read.
        if (live) {
          setConvertible([]);
          setRatesFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [householdId]);

  const base = household?.baseCurrency ?? 'INR';
  const reading = displayCurrency === '' ? base : displayCurrency;
  // What the device is reading in is always offered: the setting belongs to the device and the rates to the
  // household, so after a switch (or a failed read) the device can still be on a currency this household has no
  // rate for, and the only way off it is this list.
  const options = [...new Set([base, reading, ...convertible])];

  return (
    <div className="flex flex-col gap-4.5">
      <section>
        <div className="grouphead">
          <h2>This device</h2>
          <span className="who">remembered here only</span>
        </div>

        <div className="setgrp">
          <div className="setrow">
            <span className="sk">Theme</span>
            <ThemeToggle choice={theme} onChange={onTheme} />
          </div>

          <div className="setrow">
            <span className="setrow-text">
              <span className="sk" id="hide-amounts-label">
                Hide amounts when the app opens
              </span>
              <span className="sd">for a device other people pick up</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={hideAmountsByDefault}
              aria-labelledby="hide-amounts-label"
              className="switch"
              onClick={() => {
                onHideAmountsByDefault(!hideAmountsByDefault);
              }}
            >
              <span />
            </button>
          </div>

          {/*
            A row that opens a choice. The choice is the browser's own select laid invisibly over the row, so the
            whole row is the target and the picker is the one the device already knows how to draw.
          */}
          <label className="setrow setrow-select">
            <span className="setrow-text">
              <span className="sk">Read amounts in</span>
              {ratesFailed ? (
                <span className="sd">The exchange rates could not be read just now.</span>
              ) : (
                options.length === 1 && <span className="sd">Only {base} until a rate is recorded on Overview.</span>
              )}
            </span>
            <span className="sv">{reading}</span>
            {options.length > 1 && <Chevron />}
            <select
              aria-label="Read amounts in"
              disabled={options.length === 1}
              value={reading}
              onChange={(event) => {
                // The base currency is stored as "no choice", so a household
                // that later changes its base takes this device with it.
                onDisplayCurrency(event.target.value === base ? '' : event.target.value);
              }}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section>
        <div className="grouphead">
          <h2>This household</h2>
        </div>

        <div className="setgrp">
          <div className="setrow">
            <span className="sk">Name</span>
            <span className="sv">{household?.name ?? '—'}</span>
            {household !== null && <DemoBadge kind={household.kind} />}
          </div>
          <div className="setrow">
            <span className="sk">Base currency</span>
            <span className="sv">{household?.baseCurrency ?? '—'}</span>
          </div>
          <div className="setrow">
            <span className="sk">Tax year starts</span>
            <span className="sv">1 April</span>
          </div>
        </div>
      </section>

      <HouseholdScreen key={resets} householdId={householdId} />

      {/*
        Data. The prototype's group also holds the template, the upload, the export and deleting a household; each
        arrives with the thing behind it. Only the reset exists today, and only a demo household has one: on a real
        household the row would be offering something the database will always refuse.
      */}
      {household?.kind === 'demo' && householdId !== null && (
        <section>
          <div className="grouphead">
            <h2>Data</h2>
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
 * without a second factor, and any household not marked demo; this screen only
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
        <button
          type="button"
          className="setrow setrow-button"
          disabled={!isOwner}
          aria-expanded={isOwner ? confirming : undefined}
          onClick={() => {
            setConfirming((was) => !was);
            setDone(false);
            setProblem(null);
          }}
        >
          <span className="setrow-text">
            <span className="sk" style={{ color: isOwner ? 'var(--coral)' : 'var(--muted)' }}>
              Reset the demo household
            </span>
            <span className="sd">
              {isOwner ? 'Wipes and reseeds it. Your real household is untouched.' : 'Only the owner can reset it.'}
            </span>
          </span>
          {isOwner && <Chevron />}
        </button>
      </div>

      {confirming && isOwner && (
        <div className="mt-3">
          <p className="text-caption" style={{ color: 'var(--ink-2)' }}>
            Reset <strong>{householdName}</strong>? Every expense, category, budget, holding,
            purchase, sale, valuation, rate, loan and policy in it is permanently deleted, and so is
            anyone in it who does not sign in. Then the sample data goes back in. Anything you have
            typed into this household yourself is lost and cannot be restored.
          </p>
          <p className="text-caption mt-2" style={{ color: 'var(--ink-2)' }}>
            What stays: the household itself, everyone who signs in and their roles, invitations,
            and the activity history, which will record each deletion under your name.
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
