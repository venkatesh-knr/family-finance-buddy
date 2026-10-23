import { test, expect, type Page } from '@playwright/test';
import { POLICY_NAME } from './created.ts';

/**
 * Insurance: a policy has a cover and no value, and the household's cover gap is a stated calculation.
 *
 * It writes to the demo household, so it uses one policy of its own and puts it back: it is added once and
 * lapsed at the end, and a later run finds it and brings it back rather than adding another. A policy is
 * lapsed and not deleted (the table has no delete grant), so this is the tidy way to leave it.
 */

const NAME = POLICY_NAME;

test.use({ actionTimeout: 15_000 });

async function openInsurance(page: Page) {
  await page.goto('/#insurance');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Is the household covered?' })).toBeVisible({ timeout: 20_000 });
}

/** The policy's row on the list. A row is a list item: the tile, the name, a line, the cover. */
const row = (page: Page) => page.locator('li.policy-item').filter({ hasText: NAME });

/** What opens under the row: the figures that can be changed in place, the details, and the lapse. */
const editor = (page: Page) => row(page).getByRole('group', { name: `Edit ${NAME}` });

/** The name on the row is the button that opens it. */
async function openEditor(page: Page) {
  const toggle = row(page).getByRole('button', { name: new RegExp(`^${NAME}`) });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(editor(page)).toBeVisible();
}

/** The policy exists, is in force, and has no cover to begin with. */
async function ensurePolicy(page: Page) {
  await openInsurance(page);
  if ((await row(page).count()) === 0) {
    await page.getByRole('button', { name: 'Add a policy' }).click();
    const add = page.locator('form', { hasText: 'Add a policy' });
    await add.getByLabel('Name', { exact: true }).fill(NAME);
    await add.getByLabel(/^Premium \(/).fill('1000');
    await add.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(row(page)).toBeVisible({ timeout: 20_000 });
  } else if ((await row(page).getByText('Lapsed', { exact: true }).count()) > 0) {
    await openEditor(page);
    await editor(page).getByRole('button', { name: `Reinstate ${NAME}` }).click();
    await expect(row(page).getByText('Lapsed', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  }
}

async function setCover(page: Page, value: string) {
  await openEditor(page);
  const input = editor(page).getByLabel('Cover', { exact: true });
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toHaveValue(value, { timeout: 20_000 });
}

async function lapse(page: Page) {
  await openInsurance(page);
  if ((await row(page).count()) > 0 && (await row(page).getByText('Lapsed', { exact: true }).count()) === 0) {
    await openEditor(page);
    await editor(page).getByRole('button', { name: `Lapse ${NAME}` }).click();
    await expect(row(page).getByText('Lapsed', { exact: true })).toBeVisible({ timeout: 20_000 });
  }
}

test('the Insurance screen opens on the cover gap, with every input on its face, and a place to add a policy', async ({
  page,
}) => {
  await openInsurance(page);
  const card = page.getByRole('region', { name: 'Is the household covered?' });
  // The answer says what it is (PF-C12): a stated calculation over the household's own figures, never advice.
  await expect(card).toContainText('a calculation, not advice');
  await expect(card.getByTestId('cover-gap-result')).toContainText(/Short by|Not short/);
  // The working: four lines, each figure on the face, with the years one press at a time.
  for (const label of ['Still owed on loans', 'Less what could be had', 'Suggested cover']) {
    await expect(card.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(card.getByRole('group', { name: 'Years of dependency' })).toBeVisible();

  // What the calculation is, and is not, is behind a fold.
  const fold = card.getByRole('button', { name: 'How this is worked out' });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByText(/not a recommendation/)).toHaveCount(0);
  await fold.click();
  await expect(card.getByText(/not a recommendation/)).toBeVisible();

  await expect(page.getByRole('button', { name: 'Add a policy' })).toBeVisible();
  // More is where the screen lives, so More is lit.
  await expect(page.getByRole('group', { name: 'Screen' }).getByRole('button', { name: 'More' })).toHaveAttribute('aria-pressed', 'true');
});

test('policies are grouped, health has no suggested figure, and a savings policy links to the holding with its value', async ({
  page,
}) => {
  await openInsurance(page);
  await expect(page.getByRole('heading', { name: 'Policies' })).toBeVisible();
  const health = page.getByRole('heading', { name: /^Health/ });
  await expect(health).toContainText('no suggested figure');

  // Every row is a list item with its cover on it, and nothing is an input until it is opened.
  const rows = page.locator('li.policy-item');
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(page.locator('li.policy-item input')).toHaveCount(0);

  // A policy with a surrender value says so and links to the holding that carries it.
  const link = page.getByRole('link', { name: /surrender value/ }).first();
  if ((await link.count()) > 0) {
    await link.click();
    await expect(page).toHaveURL((url) => /holding/.test(url.hash));
  }
});

test('the years of dependency go up and down one at a time, and the figure moves with them', async ({ page }) => {
  await openInsurance(page);
  const card = page.getByRole('region', { name: 'Is the household covered?' });
  const years = card.getByRole('group', { name: 'Years of dependency' });
  test.skip((await years.getByRole('button', { name: 'More years' }).count()) === 0, 'this role cannot change the years');
  const total = card.locator('.cover-line-total dd');
  const before = Number(await years.locator('output').innerText());
  const suggestedBefore = await total.innerText();

  try {
    await years.getByRole('button', { name: 'More years' }).click();
    await expect(years.locator('output')).toHaveText(String(before + 1), { timeout: 20_000 });
    await expect(total).not.toHaveText(suggestedBefore, { timeout: 20_000 });
  } finally {
    // The household's own setting: put it back.
    const now = Number(await years.locator('output').innerText());
    if (now !== before) {
      await years.getByRole('button', { name: 'Fewer years' }).click();
      await expect(years.locator('output')).toHaveText(String(before), { timeout: 20_000 });
    }
  }
});

test('PF-C2 — a policy with a cover of ten crore leaves net worth exactly where it was', async ({ page }) => {
  test.setTimeout(150_000);
  const heroOnOverview = async (): Promise<string> => {
    await page.goto('/#overview');
    await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
    const text = async (): Promise<string> => (await page.locator('.figure').first().innerText()).replace(/\s+/g, '');
    await expect.poll(text, { timeout: 20_000 }).toMatch(/^[₹$][\d.,]+[A-Za-z]*$/);
    return text();
  };

  let failure: unknown = null;
  try {
    await ensurePolicy(page);
    await setCover(page, '');
    const before = await heroOnOverview();

    await openInsurance(page);
    await setCover(page, '100000000');
    const after = await heroOnOverview();

    // Asserted on the total a person reads, not on the absence of a column.
    expect(after, 'net worth moved when a policy was given a cover').toBe(before);
  } catch (error) {
    failure = error;
  }
  try {
    await openInsurance(page);
    if ((await row(page).count()) > 0) await setCover(page, '');
    await lapse(page);
  } catch (restore) {
    throw new Error(`${String(failure)} — and putting the policy back failed too: ${String(restore)}`);
  }
  if (failure !== null) throw failure;
});

test('with amounts hidden, a policy\'s cover and premium are not in the document, inputs included', async ({
  page,
}) => {
  // The cover half of PF-C15; the income half arrives with the income ledger. An input's value is its digits
  // in the markup, so the row's own fields are what this is about (ui-review finding 22).
  test.setTimeout(150_000);
  let failure: unknown = null;
  try {
    await ensurePolicy(page);
    await setCover(page, '12345678');
    const stored = await editor(page).locator('input[inputmode="decimal"]').evaluateAll((inputs) =>
      inputs.map((el) => (el as HTMLInputElement).value).filter((v) => v.replace(/\D/g, '').length >= 4),
    );
    expect(stored.length, 'a stored figure in an editable field to look for').toBeGreaterThan(0);

    await page.getByRole('button', { name: /Amounts shown/ }).click();
    await expect(page.getByRole('button', { name: /Amounts hidden/ })).toBeVisible();

    const markup = await page.evaluate(() => document.documentElement.outerHTML);
    for (const value of stored) {
      expect(markup, `${value} is still in the page as an input's value under privacy mode`).not.toContain(
        `value="${value}"`,
      );
    }
    // And the figure as text: ₹1,23,45,678 is 1.23 Cr compact and this is not a digit-for-digit search, so the
    // thing to look for is the amount shown anywhere on the row.
    await expect(row(page).getByText(/₹•+/).first()).toBeVisible();
    await expect(editor(page).getByText(/₹•+/).first()).toBeVisible();
  } catch (error) {
    failure = error;
  }
  try {
    await openInsurance(page);
    // A hash-only navigation does not reload, so privacy mode is still on: turn it off to change a figure.
    const hidden = page.getByRole('button', { name: /Amounts hidden/ });
    if ((await hidden.count()) > 0) await hidden.click();
    if ((await row(page).count()) > 0) await setCover(page, '');
    await lapse(page);
  } catch (restore) {
    throw new Error(`${String(failure)} — and putting the policy back failed too: ${String(restore)}`);
  }
  if (failure !== null) throw failure;
});
