import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiftTray } from './LiftTray.tsx';

/**
 * The tray's markup (docs/tokens.md section 1, Depth). The fade is a band that holds nothing: its middle is a mid-green where neither cream nor dark ink reaches 4.5:1, so the chart and
 * its legend are in the tray beneath it, never in it.
 */
describe('LiftTray', () => {
  const markup = renderToStaticMarkup(createElement(LiftTray, null, createElement('p', null, 'Legend')));

  it('has a fade that is hidden from assistive technology and holds nothing', () => {
    expect(markup).toContain('<div class="lift-tray-fade" aria-hidden="true"></div>');
  });

  it('puts what it is given in the tray, after the fade and never in it', () => {
    expect(markup.indexOf('lift-tray-fade')).toBeLessThan(markup.indexOf('class="lift-tray"'));
    expect(markup).toContain('<div class="lift-tray"><p>Legend</p></div>');
  });
});
