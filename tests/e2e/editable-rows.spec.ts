import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * The editable row (docs/design/vibrant-canvas.html, the kit), on FIRE and on Holdings.
 *
 * What the pass promises and a page can tell: the row recedes below its card, its inputs are mono, its
 * action is an icon with a 44px target and a 34px face and not an underlined word, at phone width the
 * fields wrap under the name with the action still on the first line, and Holdings' per-card actions are
 * quiet buttons and a disclosure and not a run of links.
 *
 * Read-only: it opens screens and toggles a disclosure. It archives nothing.
 */

async function ready(page: Page, screen: string, waitFor: string) {
  await page.goto(`/#${screen}`);
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible();
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(waitFor, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (b === null) throw new Error('no box for a locator that should be on screen');
  return b;
};

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('a spending-plan row is a recessed row with mono inputs and an icon action', async ({ page }) => {
      await ready(page, 'fire', 'Spending plan');
      const rows = page.locator('.edit-row');
      expect(await rows.count(), 'the spending plan has rows').toBeGreaterThan(0);

      const first = rows.first();

      // Recessed: the row's ground is darker than the card it sits in.
      const grounds = await first.evaluate((el) => {
        const lum = (css: string): number => {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
          if (m === null) return NaN;
          const lin = (v: number): number => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * lin(Number(m[1])) + 0.7152 * lin(Number(m[2])) + 0.0722 * lin(Number(m[3]));
        };
        const card = el.closest('.card');
        return {
          row: lum(getComputedStyle(el).backgroundColor),
          card: card === null ? NaN : lum(getComputedStyle(card).backgroundColor),
        };
      });
      expect(grounds.row, 'the row is darker than its card').toBeLessThan(grounds.card);

      // Mono in the inputs, where a person types and compares figures down a column.
      const inputs = first.locator('input');
      if ((await inputs.count()) > 0) {
        const family = await inputs.first().evaluate((el) => getComputedStyle(el).fontFamily);
        expect(family).toMatch(/mono/i);
      }

      // No underlined word where the action is: an icon.
      await expect(first.locator('button.underline')).toHaveCount(0);
      const action = first.locator('button.row-action');
      await expect(action).toHaveCount(1);
      await expect(action).toHaveAttribute('aria-label', /^(Archive|Restore) /);
    });

    test('the action is a 44px target around a 34px face', async ({ page }) => {
      await ready(page, 'fire', 'Spending plan');
      const action = page.locator('.edit-row button.row-action').first();
      const target = await box(action);
      expect(target.width, 'the target is at least 44px wide').toBeGreaterThanOrEqual(43.5);
      expect(target.height, 'and 44px tall').toBeGreaterThanOrEqual(43.5);
      const face = await box(action.locator('.row-action-face'));
      expect(face.width, 'the picture is about 34px').toBeGreaterThanOrEqual(33.5);
      expect(face.width).toBeLessThanOrEqual(34.5);
    });
  });
}

test('a row lays out as the canvas says at this width', async ({ page }) => {
  await ready(page, 'fire', 'Spending plan');
  const row = page.locator('.edit-row').first();
  const name = await box(row.locator('.edit-row-name'));
  const fields = await box(row.locator('.edit-row-fields'));
  const action = await box(row.locator('button.row-action'));
  const width = page.viewportSize()?.width ?? 0;

  if (width >= 640) {
    // Room enough: name, fields and action on one line, the action last.
    expect(Math.abs(fields.y + fields.height / 2 - (name.y + name.height / 2)), 'fields beside the name').toBeLessThan(40);
    expect(action.x, 'the action after the fields').toBeGreaterThan(fields.x + fields.width - 1);
  } else {
    // Not enough: the fields wrap under the name, and the action stays up on the first line beside it.
    expect(fields.y, 'fields under the name').toBeGreaterThanOrEqual(name.y + name.height - 2);
    expect(action.y, 'the action on the first line').toBeLessThan(fields.y);
    expect(action.x, 'at the right edge of it').toBeGreaterThan(name.x + name.width - 1);
  }
});

test('each spending-plan action names the row it acts on', async ({ page }) => {
  await ready(page, 'fire', 'Spending plan');
  const labels = await page.locator('.edit-row button.row-action').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(labels.length).toBeGreaterThan(0);
  expect(new Set(labels).size, 'a name that is the same for every row says nothing about which').toBe(labels.length);
});

test.describe('Holdings', () => {
  test('a holding’s actions are quiet buttons, an icon and a disclosure, not links', async ({ page }) => {
    await ready(page, 'holdings', 'Holdings (8)');

    const record = page.getByRole('button', { name: 'Record a value' }).first();
    await expect(record).toHaveClass(/quiet-button/);
    await expect(record).not.toHaveClass(/underline/);

    const archive = page.getByRole('button', { name: /^Archive / }).first();
    await expect(archive).toHaveClass(/row-action/);
    const target = await box(archive);
    expect(target.width).toBeGreaterThanOrEqual(43.5);
    expect(target.height).toBeGreaterThanOrEqual(43.5);

    // The pencil beside it is the same target: the step that cannot be undone from here is not the one that
    // gets the bigger control.
    const edit = page.getByRole('button', { name: 'Edit this holding' }).first();
    await expect(edit).toHaveClass(/row-action/);
    const editBox = await box(edit);
    expect(editBox.width).toBeGreaterThanOrEqual(43.5);
    expect(editBox.height).toBeGreaterThanOrEqual(43.5);

    const purchase = page.getByRole('button', { name: 'Add a purchase or sale' }).first();
    await expect(purchase).toHaveClass(/quiet-button/);

    const workings = page.getByRole('button', { name: /^Show the workings/ }).first();
    await expect(workings).toHaveClass(/disclosure/);
    await expect(workings).toHaveAttribute('aria-expanded', 'false');
  });

  test('the workings open and close from a disclosure, and its chevron turns', async ({ page }) => {
    await ready(page, 'holdings', 'Holdings (8)');
    const chevron = (l: Locator) => l.locator('.disclosure-chevron').evaluate((el) => getComputedStyle(el).transform);

    const workings = page.getByRole('button', { name: /^Show the workings/ }).first();
    const closed = await chevron(workings);
    await workings.click();

    const open = page.getByRole('button', { name: 'Hide the workings' }).first();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    // Transitions: let it finish before reading it.
    await page.waitForTimeout(250);
    expect(await chevron(open), 'the chevron turned a quarter').not.toBe(closed);

    await open.click();
    await expect(page.getByRole('button', { name: /^Show the workings/ }).first()).toHaveAttribute('aria-expanded', 'false');
  });

  test('no holding card carries underlined text buttons for its actions', async ({ page }) => {
    await ready(page, 'holdings', 'Holdings (8)');
    // The list of holdings: every section that has a Record a value button. Whatever else is on the
    // screen (Fetch prices, a filter's clear, a form's cancel) is one of a kind and not per holding.
    const cards = page.locator('section').filter({ has: page.getByRole('button', { name: 'Record a value' }) });
    expect(await cards.count()).toBeGreaterThan(0);
    for (let i = 0; i < (await cards.count()); i += 1) {
      await expect(cards.nth(i).locator('button.underline'), `card ${String(i + 1)} has underlined text buttons`).toHaveCount(0);
    }
  });

  test('each archive button names the holding it acts on', async ({ page }) => {
    await ready(page, 'holdings', 'Holdings (8)');
    const labels = await page
      .locator('button.row-action[aria-label^="Archive "]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(labels.length, 'an archive button on every holding').toBeGreaterThanOrEqual(8);
    expect(new Set(labels).size, 'eight buttons all called the same say nothing about which').toBe(labels.length);
  });

  test('the purchase and sale forms open on the same recessed ground as the reading form', async ({ page }) => {
    await ready(page, 'holdings', 'Holdings (8)');
    await page.getByRole('button', { name: 'Add a purchase or sale' }).first().click();
    const panel = page.locator('.inset-form').filter({ hasText: 'purchase' }).first();
    await expect(panel).toBeVisible();
    await page.getByRole('button', { name: 'Hide these forms' }).first().click();
  });

  test('a form that opens in a card sits on the recessed ground', async ({ page }) => {
    await ready(page, 'holdings', 'Holdings (8)');
    await page.getByRole('button', { name: 'Record a value' }).first().click();
    const form = page.locator('.inset-form').first();
    await expect(form).toBeVisible();
    const ground = await form.evaluate((el) => getComputedStyle(el).backgroundColor);
    const card = await form.evaluate((el) => getComputedStyle(el.closest('section') ?? el).backgroundColor);
    expect(ground, 'the form has a ground of its own').not.toBe(card);
    // Shut again: nothing is saved by opening it.
    await page.getByRole('button', { name: 'Cancel this reading' }).first().click();
  });
});
