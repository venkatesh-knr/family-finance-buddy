/**
 * An asset class as a small tile: its glyph, in its colour, on a tint of the same colour.
 *
 * Decorative by design. The class is always named in words beside it, and the glyph's shape is what
 * tells one class from another, so the tile is hidden from assistive technology rather than read
 * out as a second, worse copy of the label.
 *
 * The colour comes from the class's own ramp slot (`assetClass.ts`), as a custom property the
 * stylesheet reads, so the tile is right in both themes and nothing here names a colour.
 */

import type { CSSProperties } from 'react';
import { GLYPHS, assetClass, rampColour } from './assetClass.ts';

export function AssetTile({ kind }: { kind: string }) {
  const spec = assetClass(kind);
  return (
    <span
      className="asset-tile"
      aria-hidden="true"
      style={{ '--tile': rampColour(spec.ramp) } as CSSProperties}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[spec.glyph].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
