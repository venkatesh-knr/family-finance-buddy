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

import { HouseholdScreen } from '../household/HouseholdScreen.tsx';
import { ThemeToggle, type ThemeChoice } from '../../app/theme.tsx';
import { Card, Pill } from '../../ui/primitives.tsx';
import { useHouseholdChoice } from '../../app/household.tsx';

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
  const { current } = useHouseholdChoice();
  const household = current?.household ?? null;
  const role = current?.role ?? null;
  const canEdit = role === 'owner' || role === 'partner';

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
        <HouseholdScreen householdId={householdId} />
      </section>

      <Card title="Expense categories">
        <p className="note">
          Categories and their budgeted figures are managed together on the Expenses screen,
          because they are the same decision: naming a category and saying what it should cost are
          one thought, and separating them would mean two screens to set one envelope. The
          household-wide parts of that — nesting, reordering, archiving policy — move here when
          they exist.
        </p>
      </Card>

      <Card title="Not here yet">
        <p className="note">
          Number grouping, auto-lock, biometric unlock, the opening screen, allocation profile,
          price sources, the monthly snapshot and the export flows all belong on this screen. Each
          arrives with the thing it configures rather than ahead of it.
        </p>
      </Card>
    </div>
  );
}
