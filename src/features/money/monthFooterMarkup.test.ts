import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hashFor } from '../../app/route.ts';
import { AccountsAction } from './AccountsNudge.tsx';
import { MonthFooter } from './MonthFooter.tsx';
import { monthFooterStatus } from './monthFooter.ts';
import type { LastMonthView } from './lastMonth.ts';

/**
 * The foot of the month card, as markup (docs/drafts/month-actions.md): Close is absent for a closed month, the Accounts link targets the Accounts tab,
 * and the document order is the reading order. What needs a browser (the width of Close at 375px, nothing overflowing at 200% text) is in
 * tests/e2e/month-footer.spec.ts.
 */

const closedLast: LastMonthView = { kind: 'closed', month: '2026-10', cameIn: [], spent: [], saved: [], counted: 1, total: 1, unnamedEntries: 0 };
const render = (status: ReturnType<typeof monthFooterStatus>) =>
  renderToStaticMarkup(
    createElement(MonthFooter, {
      closeMonthKey: '2026-10',
      status,
      onClose: () => undefined,
      moneyIn: createElement('button', { type: 'button', className: 'btn btn-quiet' }, '+ Money in'),
      accounts: createElement(AccountsAction, { nudge: { kind: 'manage', count: 1 } }),
    }),
  );

describe('the month card’s foot', () => {
  it('has Close October, and its status line, when a month is waiting', () => {
    const html = render(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: true, lastMonth: null }));
    expect(html).toContain('October is ready to close');
    expect(html).toContain('from your balances · about 2 minutes');
    expect(html).toMatch(/<button[^>]*class="btn month-close"[^>]*>Close October<\/button>/);
  });

  it('has no Close for a month that is closed, and says it is', () => {
    const html = render(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: false, lastMonth: closedLast }));
    expect(html).toContain('October is closed');
    expect(html).not.toContain('month-close');
    expect(html).not.toMatch(/>Close /);
  });

  it('has no status and no Close when nothing is waiting and nothing was closed', () => {
    const html = render(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: false, lastMonth: null }));
    expect(html).not.toContain('month-footer-right');
    expect(html).not.toContain('month-close');
  });

  it('reads in the order Money in, Accounts, the status, Close, which the phone’s layout does not change', () => {
    const html = render(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: true, lastMonth: null }));
    const at = (text: string) => html.indexOf(text);
    expect(at('+ Money in')).toBeGreaterThan(-1);
    expect(at('+ Money in')).toBeLessThan(at('Accounts'));
    expect(at('Accounts')).toBeLessThan(at('October is ready to close'));
    expect(at('October is ready to close')).toBeLessThan(at('>Close October<'));
  });
});

describe('the Accounts link', () => {
  it('goes to the Accounts tab, as a link and not a button', () => {
    const html = renderToStaticMarkup(createElement(AccountsAction, { nudge: { kind: 'manage', count: 3 } }));
    expect(html).toContain(`href="${hashFor('accounts')}"`);
    expect(html).toMatch(/^<a /);
    expect(html).not.toContain('<button');
  });

  it('carries the count in a badge with its own name, and a chevron that is not read', () => {
    const html = renderToStaticMarkup(createElement(AccountsAction, { nudge: { kind: 'manage', count: 3 } }));
    expect(html).toMatch(/<span class="month-badge" role="img" aria-label="3 accounts">3<\/span>/);
    expect(html).toContain('aria-hidden="true"');
  });

  it('names one account in the singular', () => {
    expect(renderToStaticMarkup(createElement(AccountsAction, { nudge: { kind: 'manage', count: 1 } }))).toContain('aria-label="1 account"');
  });

  it('asks to add accounts while none is in use, with no badge', () => {
    const html = renderToStaticMarkup(createElement(AccountsAction, { nudge: { kind: 'add' } }));
    expect(html).toContain('Add accounts');
    expect(html).not.toContain('month-badge');
  });
});
