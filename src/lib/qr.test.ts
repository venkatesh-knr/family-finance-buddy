import { describe, expect, it } from 'vitest';
import { svgMarkupFromQr } from './qr.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';

describe('svgMarkupFromQr', () => {
  it('strips the data-URI prefix from raw markup, which is what the auth server sends', () => {
    expect(svgMarkupFromQr(`data:image/svg+xml;utf-8,${SVG}`)).toBe(SVG);
  });

  it('decodes percent-encoded markup', () => {
    expect(svgMarkupFromQr(`data:image/svg+xml;utf-8,${encodeURIComponent(SVG)}`)).toBe(SVG);
  });

  it('accepts the charset spelling and a base64 payload', () => {
    expect(svgMarkupFromQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`)).toBe(SVG);
    expect(svgMarkupFromQr(`data:image/svg+xml;base64,${btoa(SVG)}`)).toBe(SVG);
  });

  it('leaves markup that is already markup alone', () => {
    expect(svgMarkupFromQr(SVG)).toBe(SVG);
  });

  it('keeps a literal percent sign in raw markup instead of failing to decode it', () => {
    const withPercent = '<svg xmlns="http://www.w3.org/2000/svg"><text>100%</text></svg>';
    expect(svgMarkupFromQr(`data:image/svg+xml;utf-8,${withPercent}`)).toBe(withPercent);
  });

  it('is null for something that is not an svg, so the screen can fall back to typing the secret', () => {
    expect(svgMarkupFromQr('')).toBeNull();
    expect(svgMarkupFromQr('data:image/svg+xml;utf-8,')).toBeNull();
    expect(svgMarkupFromQr('data:text/html;utf-8,<p>hello</p>')).toBeNull();
    expect(svgMarkupFromQr('not a qr code')).toBeNull();
  });

  it('refuses markup that could run script, since it is injected as markup', () => {
    expect(svgMarkupFromQr('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).toBeNull();
    expect(svgMarkupFromQr('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')).toBeNull();
    expect(svgMarkupFromQr('<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>')).toBeNull();
    expect(svgMarkupFromQr('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><p>x</p></foreignObject></svg>')).toBeNull();
  });
});
