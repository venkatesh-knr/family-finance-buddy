import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ASSET_CLASSES, GLYPH_STROKE } from './assetClass.ts';
import { AssetTile } from './AssetTile.tsx';
import { ruleFor } from './contrastKit.ts';

/**
 * The tile as it is drawn: the parts of docs/design/icons.md §1 that a stylesheet and a markup string can
 * answer. What colour it measures is `tileContrast.test.ts`; which glyph a kind gets is `assetClass.test.ts`.
 */

describe('a tile as rendered', () => {
  it.each(ASSET_CLASSES.map((c) => c.kind))(
    'IC-R10 — draws %s stroked and never filled, at the registry stroke, with round caps and joins',
    (kind) => {
      const html = renderToStaticMarkup(createElement(AssetTile, { kind }));
      expect(html).toContain('fill="none"');
      expect(html).toContain(`stroke-width="${String(GLYPH_STROKE)}"`);
      expect(html).toContain('stroke-linecap="round"');
      expect(html).toContain('stroke-linejoin="round"');
      // A glyph that turns into a blob the moment the hue is dark is the reason it is never filled.
      expect(html).not.toMatch(/fill="(?!none)/);
    },
  );

  it('IC-R10 — is decorative: hidden from assistive technology, since its label is beside it', () => {
    expect(renderToStaticMarkup(createElement(AssetTile, { kind: 'bond' }))).toContain('aria-hidden="true"');
  });
});

describe('the tile’s rule', () => {
  const rule = ruleFor('.asset-tile');

  it('IC-R11 — is 2.5rem square, which is 40px at the default root and grows with the text', () => {
    expect(rule).toMatch(/height:\s*2\.5rem/);
    expect(rule).toMatch(/width:\s*2\.5rem/);
  });

  it('IC-R11 — takes its radius from the token and not from a pixel value', () => {
    expect(rule).toMatch(/border-radius:\s*var\(--radius\)/);
  });

  it('IC-R11 — always has a 1px border, because forced-colours mode drops a tint and keeps a border', () => {
    expect(rule).toMatch(/border:\s*1px solid/);
  });
});
