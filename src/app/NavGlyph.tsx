import { NAV_GLYPHS } from './navGlyphs.ts';
import type { Screen } from './useScreen.ts';

/** The mark above a label in the bottom bar. Decorative: the word beside it is the name. */
export function NavGlyph({ screen }: { screen: keyof typeof NAV_GLYPHS & Screen }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_GLYPHS[screen].map((part) => (
        <path key={part.d} d={part.d} {...(part.filled === true ? { fill: 'currentColor', stroke: 'none' } : {})} />
      ))}
    </svg>
  );
}
