import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContributorMonth } from './ContributorMonth.tsx';

/**
 * A contributor's month card as it first draws (SC-I19; the MoneyMonthStated board, screen 7). No contributor signs in to the e2e suite, so the card is read here as
 * markup: it says what it is and who keeps the household's month, and has no figure of the household's and no action.
 */
describe('a contributor’s month card', () => {
  const html = renderToStaticMarkup(createElement(ContributorMonth, { householdId: 'h', memberId: 'm', members: [], today: '2026-11-18', currency: 'INR', privacy: false }));

  it('is Spent by you, and says who keeps the household’s month', () => {
    expect(html).toContain('Spent by you');
    expect(html).toContain('The household&#x27;s month, its total and how it was worked out are kept by the owner and the partner.'.replace('&#x27;', '’'));
  });

  it('names the month, with a way to read last month, and says it is being read before it has a figure', () => {
    expect(html).toContain('November so far');
    expect(html).toContain('This month');
    expect(html).toContain('Last month');
    expect(html).toContain('Reading…');
  });

  it('has no household total, no saved, no stated figure and no action but the two month buttons', () => {
    expect(html).not.toMatch(/Came in|Saved|stated|State |Close /);
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});
