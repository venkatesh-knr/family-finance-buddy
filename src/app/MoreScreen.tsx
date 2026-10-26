import type { ReactNode } from 'react';
import type { AppScreen } from '../domain/access.ts';
import { formatMoney } from '../lib/money.ts';
import { GLYPHS as GLYPH_PATHS } from '../ui/assetClass.ts';
import { hashFor } from './route.ts';
import { policiesPhrase, profileLine, renewalPill, taxLine, taxYearLabel } from './moreGlance.ts';
import { useMoreGlance } from './useMoreGlance.ts';

/**
 * Where the screens that are not opened daily are (docs/design/vibrant-canvas.html, More).
 *
 * The bar has five slots and they are full, so Tax (a quarterly screen), Insurance, Profile and Settings
 * are behind the fifth. Each row carries the one thing worth knowing before opening it: a tile, the name, a line
 * of what is true now, and where there is something to do, a pill. The line is read from the same figures the
 * screen behind it uses; until it arrives the row says what the screen is for, and it opens either way.
 */

const GLYPHS: Partial<Record<AppScreen, ReactNode>> = {
  tax: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </>
  ),
  insurance: (
    <>
      <path d="M3 12a9 9 0 0 1 18 0Z" />
      <path d="M12 12v6a2.5 2.5 0 0 0 5 0" />
    </>
  ),
  // The tile's own house, so the two are one drawing (icons.md section 4).
  property: (
    <>
      {GLYPH_PATHS.house.map((d) => (
        <path key={d} d={d} />
      ))}
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3" />
      <path d="M12 18.5v3" />
      <path d="M2.5 12h3" />
      <path d="M18.5 12h3" />
      <path d="m5.3 5.3 2.1 2.1" />
      <path d="m16.6 16.6 2.1 2.1" />
      <path d="m5.3 18.7 2.1-2.1" />
      <path d="m16.6 7.4 2.1-2.1" />
    </>
  ),
};

const TITLES: Partial<Record<AppScreen, string>> = {
  tax: 'Tax',
  insurance: 'Insurance',
  property: 'Property',
  profile: 'Profile',
  settings: 'Settings',
};

/** What a row says before its line has arrived, and for a screen that has no live line. */
const PURPOSE: Partial<Record<AppScreen, string>> = {
  tax: 'What the year’s gains and income come to, on the rules that applied.',
  insurance: 'Policies, what they cover and when they renew.',
  property: 'What each cost, what it is thought to be worth, and how old that is.',
  settings: 'Theme, how amounts show, members',
};

export function MoreScreen({
  screens,
  role,
  householdId,
  privacy,
  onOpen,
}: {
  screens: readonly AppScreen[];
  role: string | null;
  householdId: string | null;
  privacy: boolean;
  onOpen: (screen: AppScreen) => void;
}) {
  const { tax, insurance } = useMoreGlance({
    householdId,
    wantsTax: screens.includes('tax'),
    wantsInsurance: screens.includes('insurance'),
  });

  const line = (id: AppScreen): { text: string; pill: string | null } => {
    switch (id) {
      case 'tax': {
        if (tax === null) return { text: PURPOSE.tax ?? '', pill: null };
        const year = taxYearLabel(tax.fy);
        const said = taxLine({
          hasTotal: tax.tax !== null,
          unplacedSales: tax.unplacedSales,
          atSlabMinor: tax.atSlab.minor,
        });
        // Named as the Tax screen names it, and stated only when nothing was left out of it; the allowance pill
        // is withheld under the same condition, since an unplaced equity sale would overstate what is unused.
        if (said.kind === 'unplaced') {
          return { text: `${year} · ${String(said.sales)} ${said.sales === 1 ? 'sale' : 'sales'} not counted`, pill: null };
        }
        if (said.kind === 'see-the-working' || tax.tax === null) return { text: `${year} · the working is on the Tax screen`, pill: null };
        const unused =
          tax.allowanceUnused !== null && tax.allowanceUnused.minor > 0n
            ? `${formatMoney(tax.allowanceUnused, { privacy })} allowance unused`
            : null;
        return { text: `${year} · tax on gains ${formatMoney(tax.tax, { privacy })}`, pill: unused };
      }
      case 'insurance':
        return insurance === null
          ? { text: PURPOSE.insurance ?? '', pill: null }
          : { text: policiesPhrase(insurance.inForce), pill: renewalPill(insurance.due) };
      case 'profile':
        return { text: profileLine(role), pill: null };
      default:
        return { text: PURPOSE[id] ?? '', pill: null };
    }
  };

  return (
    <nav aria-label="More" className="card more-card">
      {/* The board draws no title: the bar says where you are. A screen still has a heading to be found by. */}
      <h2 className="sr-only">More</h2>
      <ul className="more-list">
        {screens.flatMap((id) => {
          const title = TITLES[id];
          if (title === undefined) return [];
          const { text, pill } = line(id);
          return [
            <li key={id}>
              <a
                className="more-row"
                href={hashFor(id)}
                onClick={() => {
                  onOpen(id);
                }}
              >
                <span className="asset-tile" aria-hidden="true" style={{ ['--tile' as string]: 'var(--muted)' }}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {GLYPHS[id]}
                  </svg>
                </span>
                <span className="more-text">
                  <span className="more-title">{title}</span>
                  <span className="more-status tabular-nums">{text}</span>
                  {pill !== null && <span className="more-pill tabular-nums">{pill}</span>}
                </span>
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
                  className="more-chevron"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </a>
            </li>,
          ];
        })}
      </ul>
    </nav>
  );
}
