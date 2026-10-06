import type { Page, Locator } from '@playwright/test';

/**
 * One entry in the expense ledger, whatever shape the ledger is in.
 *
 * At desktop width the ledger is a table and an entry is a `<tr>`. On a phone
 * it is a list and an entry is an `<li>` — the right call, since a five-column
 * table at 412px is either a horizontal scroll or four columns of nothing. But
 * it means `getByRole('row')` finds the entry at one width and not the other,
 * and a spec written against either one alone passes on half the matrix while
 * claiming to cover both.
 *
 * So: match either. If the ledger's markup changes again, this is the single
 * place that needs to know.
 */
export function ledgerEntry(page: Page, payee: string): Locator {
  return page
    .getByRole('row')
    .filter({ hasText: payee })
    .or(page.getByRole('listitem').filter({ hasText: payee }));
}
