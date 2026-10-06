import { test, expect } from '@playwright/test';
import { ledgerEntry } from './ledger.ts';

/**
 * The entry flow, end to end.
 *
 * `docs/build-plan.md` names this the project's failure mode: "a full week of
 * your real spending logged without the entry flow annoying you. If it annoys
 * you, fix that before building anything else." A test cannot measure annoyance,
 * but it can hold the floor — that the flow works at all, at both widths, and
 * that what you typed is what was stored.
 *
 * The amount assertion is the one that matters. Money is held as integer minor
 * units and formatted only at the display edge (`CLAUDE.md`), so a figure that
 * survives the round trip unchanged is evidence that nothing rounded, truncated
 * or re-parsed it on the way through.
 */

test('an expense can be added and is listed with the amount as typed', async ({ page }) => {
  const payee = `round-trip-${Date.now()}`;
  const amount = '1234.56';
  const rendered = '1,234.56';

  await page.goto('/#expenses');

  await page.getByLabel(/^Amount \(/).fill(amount);
  await page.getByLabel('Payee').fill(payee);
  await page.getByRole('button', { name: 'Add' }).click();

  const row = ledgerEntry(page, payee);
  await expect(row).toBeVisible();
  await expect(row).toContainText(rendered);

  // The form clears itself, or the next entry inherits the last one's amount —
  // which in a quick-add flow is how a household ends up with a duplicate.
  await expect(page.getByLabel(/^Amount \(/)).toHaveValue('');
});

test('a mistyped entry can be corrected rather than re-entered', async ({ page }) => {
  // `CLAUDE.md`: transactions are freely editable until a figure has been relied
  // upon. Until a snapshot is frozen, editing is the supported path and the user
  // asked for it explicitly.
  const payee = `editable-${Date.now()}`;

  await page.goto('/#expenses');
  await page.getByLabel(/^Amount \(/).fill('100.50');
  await page.getByLabel('Payee').fill(payee);
  await page.getByRole('button', { name: 'Add' }).click();

  await page.getByRole('button', { name: new RegExp(`Edit ${payee}`) }).click();

  await page.getByLabel(/^Amount \(/).last().fill('250.75');
  await page.getByRole('button', { name: /save|update/i }).click();

  const row = ledgerEntry(page, payee);
  // Paise on both figures deliberately: lib/money.ts drops a trailing `.00`
  // on a whole amount ("a fraction that says nothing"), so 250.00 would render
  // as ₹250 and the assertion would be testing the formatter, not the edit.
  await expect(row).toContainText('250.75');
  await expect(row).not.toContainText('100.50');
});

test('an amount is never stored as a float', async ({ page }) => {
  // A figure that cannot be represented exactly in binary floating point. If
  // anything in the path does `parseFloat` and multiplies, this is where it
  // shows: 0.1 + 0.2 arithmetic turns 1070.10 into 1070.09 or 1070.1000000001.
  const payee = `paise-${Date.now()}`;

  await page.goto('/#expenses');
  await page.getByLabel(/^Amount \(/).fill('1070.10');
  await page.getByLabel('Payee').fill(payee);
  await page.getByRole('button', { name: 'Add' }).click();

  const row = ledgerEntry(page, payee);
  await expect(row).toContainText('1,070.10');

  // Reload: the first render came from local state, this one comes from the
  // database. A rounding fault that happens on write only appears here.
  await page.reload();
  await expect(ledgerEntry(page, payee)).toContainText('1,070.10');
});
