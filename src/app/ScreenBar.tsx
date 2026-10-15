import type { HouseholdKind } from '../repo/types.ts';
import { EyeIcon } from '../ui/primitives.tsx';
import { DemoBadge } from './household.tsx';

/**
 * The bar on a screen that is one level down from More (docs/design/vibrant-canvas.html: Tax, Insurance, Profile,
 * Settings): a way back to More, the screen's name in the serif face, and the privacy switch.
 *
 * On a phone it replaces the app's own header and the household strip, because the screen is the thing, and the
 * way back is the one thing a person on it needs. The demo badge stays: a screen of fake money must never be
 * read as real because the bar changed. Wide screens keep the full header and the tabs, which have room.
 */
export function ScreenBar({
  title,
  backLabel,
  onBack,
  privacy,
  onTogglePrivacy,
  showPrivacy,
  householdKind,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  privacy: boolean;
  onTogglePrivacy: () => void;
  /** The artboards draw the switch on Tax and Insurance, where there are amounts, and not on Profile or Settings. */
  showPrivacy: boolean;
  householdKind: HouseholdKind | null;
}) {
  return (
    <header className="screen-bar hide-wide inset-safe-top inset-safe-x">
      <button type="button" className="screen-bar-back" onClick={onBack}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        <span>{backLabel}</span>
      </button>
      <h1 className="app-title min-w-0 truncate">{title}</h1>
      <span className="screen-bar-end">
        {householdKind !== null && <DemoBadge kind={householdKind} />}
        {showPrivacy && (
        <button
          type="button"
          className="iconbtn"
          aria-pressed={privacy}
          aria-label={privacy ? 'Amounts hidden. Show them.' : 'Amounts shown. Hide them.'}
          onClick={onTogglePrivacy}
        >
          <EyeIcon crossed={privacy} />
        </button>
        )}
      </span>
    </header>
  );
}
