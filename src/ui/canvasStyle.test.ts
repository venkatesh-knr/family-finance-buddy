import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV_GLYPHS } from '../app/navGlyphs.ts';
import { ratio, resolve, ruleFor } from './contrastKit.ts';

/**
 * The style pass that follows docs/design/vibrant-canvas.html: no layout or information changes, only
 * how four things are drawn. The canvas is a reference, and tokens.md wins where they disagree, so
 * every colour here is a token and every claim is measured against the shipped stylesheet.
 */

describe('the avatar', () => {
  const rule = ruleFor('.avatar');

  it('is a gradient of two tokens, with the primary button’s ink', () => {
    expect(rule).toMatch(/background:\s*linear-gradient\([^)]*var\(--brass\)[^)]*var\(--c7\)[^)]*\)/);
    expect(rule).toMatch(/color:\s*var\(--surface\)/);
  });

  it.each(['light', 'dark'] as const)('keeps its initial at 4.5:1 against both ends of it, in %s', (theme) => {
    const ink = resolve(theme, '--surface');
    for (const stop of ['--brass', '--c7']) {
      expect(ratio(ink, resolve(theme, stop)), stop).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is sized in em, so the circle grows with the letter', () => {
    expect(rule).toMatch(/height:\s*2\.4em/);
    expect(rule).toMatch(/width:\s*2\.4em/);
  });
});

describe('the privacy switch on a phone', () => {
  it('is a circle once its words are gone, sized with its text', () => {
    const phone = /@media \(max-width: 519px\) \{[\s\S]*?\.iconbtn \{([\s\S]*?)\}/.exec(
      readFileSync('src/styles/base.css', 'utf8'),
    )?.[1];
    expect(phone, 'a rule for .iconbtn under 520px, the width at which .hide-narrow hides the words').toBeDefined();
    expect(phone).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(phone).toMatch(/height:\s*2\.4em/);
    expect(phone).toMatch(/width:\s*2\.4em/);
  });
});

describe('a Needs attention row', () => {
  const rule = ruleFor('.attention');

  it('takes the card radius from the token and a hairline border', () => {
    expect(rule).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(rule).toMatch(/border:\s*1px solid/);
  });

  it('draws its chevron as a stroked glyph and not a text character', () => {
    const source = readFileSync('src/ui/primitives.tsx', 'utf8');
    expect(source).not.toContain('▸');
    expect(source).toMatch(/className="attention-chevron"[\s\S]*?<Chevron \/>/);
    expect(source).toMatch(/export function Chevron\(\)[\s\S]*?<svg[\s\S]*?stroke="currentColor"/);
  });
});

describe('the bottom bar', () => {
  const screens = ['overview', 'summary', 'expenses', 'holdings', 'tax', 'fire'] as const;

  it.each(screens)('draws %s as a stroked glyph', (screen) => {
    const glyph = NAV_GLYPHS[screen];
    expect(glyph.length).toBeGreaterThan(0);
    for (const part of glyph) expect(part.d).toMatch(/^[Mm]/);
  });

  it('gives no screen a text character to stand in for a glyph', () => {
    const source = readFileSync('src/app/App.tsx', 'utf8');
    for (const ch of ['◉', '◧', '△', '§', '₹']) {
      expect(source, `${ch} in a nav entry`).not.toMatch(new RegExp(`'[A-Za-z]+',\\s*'[A-Za-z]+',\\s*'${ch}'`));
    }
  });
});

describe('the avatar border and the currency cards', () => {
  it('keeps a transparent 1px border on the avatar: forced-colours mode drops a gradient and keeps a border', () => {
    expect(ruleFor('.avatar')).toMatch(/border:\s*1px solid transparent/);
  });

  it('sets a currency card’s figure at the stat step, not the hero’s', () => {
    const rule = ruleFor('.stat-card-value');
    expect(rule).toMatch(/font-size:\s*1\.0625rem/);
    expect(rule).toMatch(/font-weight:\s*500/);
  });
});
