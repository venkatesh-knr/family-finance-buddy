import type { AppScreen } from '../domain/access.ts';
import { Card } from '../ui/primitives.tsx';

/**
 * Where the screens that are not opened daily are.
 *
 * The bar has five slots and they are full, so Tax (a quarterly screen), Insurance, Profile and Settings
 * are behind the fifth. Each is a plain button with a line saying what it is for: a list of four, not a
 * menu, because a menu is one more thing to open before the thing you came for.
 */
const DESCRIPTIONS: Partial<Record<AppScreen, readonly [string, string]>> = {
  tax: ['Tax', 'What the year’s gains and income come to, on the rules that applied.'],
  insurance: ['Insurance', 'Policies, what they cover and when they renew, and whether the household is covered.'],
  profile: ['Profile', 'Your name, your sign-in and your second factor.'],
  settings: ['Settings', 'The theme, how amounts are shown, and the household’s own settings.'],
};

export function MoreScreen({
  screens,
  onOpen,
}: {
  screens: readonly AppScreen[];
  onOpen: (screen: AppScreen) => void;
}) {
  return (
    <Card title="More">
      <ul className="row-separated">
        {screens.flatMap((id) => {
          const entry = DESCRIPTIONS[id];
          if (entry === undefined) return [];
          return [
            <li key={id}>
              <button
                type="button"
                className="more-link"
                onClick={() => {
                  onOpen(id);
                }}
              >
                <span className="more-link-name">{entry[0]}</span>
                <span className="note">{entry[1]}</span>
              </button>
            </li>,
          ];
        })}
      </ul>
    </Card>
  );
}
