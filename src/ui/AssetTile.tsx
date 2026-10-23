/**
 * An asset class as a small tile: its glyph, in its colour, on a tint of the same colour.
 *
 * Decorative by design. The class is always named in words beside it, and the glyph's shape is what
 * tells one class from another, so the tile is hidden from assistive technology rather than read
 * out as a second, worse copy of the label.
 *
 * The colour comes from the class (`assetClass.ts`: its ramp slot, or the neutral grey for `other`), as
 * a custom property the stylesheet reads, so the tile is right in both themes and nothing here names
 * a colour or a size. 40px, a 20px glyph on a 24-unit box, stroke 1.9, round caps and joins; the
 * radius is `--radius` and the 1px border is there for the same reason the pressed segment has one:
 * it survives forced-colours mode, which drops a tint. Shapes and assignments are
 * `docs/design/icons.md`.
 */

import type { CSSProperties } from 'react';
import { GLYPHS, GLYPH_STROKE, PROTECTION_TILE, assetClass, classColour } from './assetClass.ts';

export function AssetTile({ kind, compact = false, muted = false }: { kind: string; compact?: boolean; muted?: boolean }) {
  const spec = assetClass(kind);
  // A policy is not a holding and is not an asset class; its tile is its own (icons.md section 4).
  const tile = kind === 'insurance' ? PROTECTION_TILE : { glyph: spec.glyph, colour: classColour(spec) };
  return (
    <span
      className={compact ? 'asset-tile asset-tile-compact' : 'asset-tile'}
      aria-hidden="true"
      style={{ '--tile': muted ? 'var(--muted)' : tile.colour } as CSSProperties}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={GLYPH_STROKE} strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[tile.glyph].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
