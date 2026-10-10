import { test, expect } from '@playwright/test';
import { ledgerEntry } from './ledger.ts';

/**
 * Privacy mode must remove the amount, not hide it.
 *
 * `docs/tokens.md` §8: "Implement as a formatter switch, not a CSS blur — a
 * blur is recoverable from a screenshot and this needs to survive one."
 *
 * That is a promise made to a family about a screen somebody else might glance
 * at, and until this spec existed nothing verified it. A blurred figure, a
 * figure clipped by overflow, a figure behind `visibility: hidden`, and a figure
 * sitting in an `aria-label` while the text is masked would all pass a visual
 * check and fail the promise. So the assertion is not "cannot be seen" but "is
 * not in the document at all" — text, attributes and accessible names together.
 */

test('an amount is absent from the page, not merely hidden', async ({ page }) => {
  // Distinctive enough that a substring match cannot collide with a seeded
  // figure, a date, a percentage or an element id.
  const amount = '4242.42';
  const rendered = '4,242.42';
  const payee = `privacy-${Date.now()}`;

  await page.goto('/#expenses');

  await page.getByLabel(/^Amount \(/).fill(amount);
  await page.getByLabel('Payee').fill(payee);
  await page.getByRole('button', { name: 'Add' }).click();

  // Scoped to the entry: a bare getByText(payee) matches both the span
  // holding the name and the cell containing it — a strict-mode violation —
  // and the entry is a table row at desktop width and a list item on a phone.
  const row = ledgerEntry(page, payee);

  // Shown first, or the rest of the test proves nothing.
  await expect(row).toBeVisible();
  await expect(row).toContainText(rendered);

  // And the form has finished. The new row is on screen as soon as the ledger reloads, and the quick-add
  // form is cleared after that (it waits on the save), so for a moment the typed amount is still the
  // value of its input. Switching privacy on in that moment finds the digits in the markup and calls it a
  // leak; it is the test getting ahead of the form, which finding 22 in the UI review records.
  await expect(page.getByLabel(/^Amount \(/)).toHaveValue('');

  const privacyToggle = page.getByRole('button', { name: /Amounts shown/ });
  await privacyToggle.click();

  // The whole claim, in one assertion: the digits are gone from the served
  // markup. outerHTML rather than innerText because it also covers aria-label,
  // title, alt, data attributes and inline SVG text — every place a figure can
  // hide from the eye while remaining in a screenshot's source.
  const markup = await page.evaluate(() => document.documentElement.outerHTML);
  expect(markup, 'the amount is still in the DOM while privacy mode is on').not.toContain(rendered);
  expect(markup).not.toContain(amount);

  // And the row itself is still there — masking is not deletion. A person in
  // privacy mode must still be able to see that an entry exists, and for whom.
  await expect(row).toBeVisible();

  // §8: percentages, dates, labels and chart shapes stay visible. If this fails,
  // privacy mode has been applied too broadly and the screen is now unreadable
  // rather than discreet.
  await expect(page.getByRole('button', { name: /Amounts hidden/ })).toBeVisible();
});

test('privacy mode survives moving between screens', async ({ page }) => {
  await page.goto('/#overview');
  await page.getByRole('button', { name: /Amounts shown/ }).click();

  for (const screen of ['Expenses', 'Holdings', 'Overview']) {
    await page.getByRole('group', { name: 'Screen' }).first().getByText(screen, { exact: true }).click();
    await expect(
      page.getByRole('button', { name: /Amounts hidden/ }),
      `privacy mode was lost on ${screen}`,
    ).toBeVisible();
  }
});

test('a stored figure in an editable field is not left in the document', async ({ page }) => {
  // The plan on the FIRE screen is a column of inputs holding the household's own figures. An input's value
  // is its digits in the markup, so unlike a masked figure it survives "privacy mode removes the amount".
  await page.goto('/#fire');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Spending plan', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Whatever is stored, read from the page: three digits or more, so a multiple or an inflation rate is not
  // a figure to look for. Shown first, or the test proves nothing.
  const stored = await page.locator('input[inputmode="decimal"]').evaluateAll((inputs) =>
    inputs.map((el) => (el as HTMLInputElement).value).filter((v) => v.replace(/D/g, '').length >= 3),
  );
  expect(stored.length, 'a stored figure in an editable field to look for').toBeGreaterThan(0);

  await page.getByRole('button', { name: /Amounts shown/ }).click();
  await expect(page.getByRole('button', { name: /Amounts hidden/ })).toBeVisible();

  const markup = await page.evaluate(() => document.documentElement.outerHTML);
  for (const value of stored) {
    expect(markup, `${value} is still in the page, as an input's value, under privacy mode`).not.toContain(
      `value="${value}"`,
    );
  }
});
