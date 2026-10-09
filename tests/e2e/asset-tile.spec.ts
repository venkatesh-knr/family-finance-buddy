import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { ASSET_CLASSES, GLYPHS, GLYPH_STROKE, classColour } from '../../src/ui/assetClass.ts';

/**
 * A tile's glyph, measured as painted.
 *
 * `src/ui/tileContrast.test.ts` holds each glyph to 3:1 against its own fill using the token colours,
 * which is the contrast of a solid stroke. It cannot see how a stroke is rasterised: a dot a little
 * over a pixel across, centred on a pixel boundary, is smeared into a pale block at device pixel ratio
 * 1 and never reaches its colour. A desktop monitor at 100% is that ratio. So this renders the real
 * stylesheet, tokens and path data at 1x, in both themes, and measures the strongest glyph pixel
 * against the tile fill beside it (docs/design/icons.md §5).
 *
 * It does not need the app or a household: the demo household holds no `other`, so the tile that
 * most needs measuring is on no screen. The page is built from the shipped CSS and the shipped paths.
 */

test.use({ deviceScaleFactor: 1 });

const css = ['tokens.css', 'base.css'].map((f) => readFileSync(`src/styles/${f}`, 'utf8')).join('\n');

const svg = (paths: readonly string[]): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${String(GLYPH_STROKE)}" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;

const page = (theme: 'light' | 'dark'): string =>
  `<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>` +
  `<body style="margin:0;background:var(--bg)"><div style="display:flex;gap:16px;padding:16px;background:var(--surface)">` +
  ASSET_CLASSES.map(
    (c) =>
      `<span class="asset-tile" data-kind="${c.kind}" style="--tile:${classColour(c)}">${svg(GLYPHS[c.glyph])}</span>`,
  ).join('') +
  `</div></body></html>`;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme, device pixel ratio 1`, () => {
    for (const c of ASSET_CLASSES) {
      test(`${c.kind} holds its glyph at 3:1 against the fill as painted`, async ({ page: p }) => {
        await p.setContent(page(theme));
        const tile = p.locator(`.asset-tile[data-kind="${c.kind}"]`);
        const box = await tile.boundingBox();
        if (box === null) throw new Error(`no ${c.kind} tile`);
        // The inside of the border, so the border and the rounded corners are not measured as glyph.
        const png = await p.screenshot({
          clip: { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 },
        });
        const read = await p.evaluate(async (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const cv = document.createElement('canvas');
          cv.width = img.width;
          cv.height = img.height;
          const cx = cv.getContext('2d');
          if (cx === null) throw new Error('no canvas');
          cx.drawImage(img, 0, 0);
          const d = cx.getImageData(0, 0, cv.width, cv.height).data;
          const lin = (v: number): number => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          const lum = (i: number): number =>
            0.2126 * lin(d[i] as number) + 0.7152 * lin(d[i + 1] as number) + 0.0722 * lin(d[i + 2] as number);
          // The fill: the left edge at mid-height, which no glyph reaches.
          const fill = lum((Math.floor(cv.height / 2) * cv.width) * 4);
          let best = 1;
          for (let i = 0; i < d.length; i += 4) {
            const l = lum(i);
            const r = (Math.max(l, fill) + 0.05) / (Math.min(l, fill) + 0.05);
            if (r > best) best = r;
          }
          return best;
        }, png.toString('base64'));
        expect(read, `${c.kind}, ${theme}: strongest glyph pixel against the fill`).toBeGreaterThanOrEqual(3);
      });
    }
  });
}
