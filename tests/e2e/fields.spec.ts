import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { choiceField, choose, next, stepper } from './fields.ts';
import { openList, rowFor } from './holdings.ts';

/**
 * The underline field and the stepped form (docs/design/simple-layout.md sections 3 and 4): SL-I3 every input has a visible label that is not
 * its placeholder, SL-I5 a field is at least 44px tall at 375px, SL-I6 going back keeps every value and nothing is written until the last
 * step's button. (SL-I4, the underline's contrast and the focus width, is measured on the shipped stylesheet in src/ui/fieldStyle.test.ts.)
 *
 * Nothing here is added: the forms are filled, read and closed.
 */

test.use({ actionTimeout: 15_000 });

/** The controls on the page that take a person's input and are on show, with how each is named. */
async function audit(page: Page): Promise<{ problems: string[]; checked: number }> {
  return page.evaluate(() => {
    const text = (el: Element | null): string => (el === null ? '' : (el.textContent ?? '').replace(/\s+/g, ' ').trim());
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [role=combobox]',
      ),
    ).filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
    const problems: string[] = [];
    for (const el of controls) {
      const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => text(document.getElementById(id)))
        .join(' ')
        .trim();
      const labels = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        ? Array.from(el.labels ?? []).map((label) => text(label)).join(' ').trim()
        : '';
      const visible = labels !== '' ? labels : labelledBy;
      const placeholder = el.getAttribute('placeholder') ?? '';
      const where = `${el.tagName.toLowerCase()}${el.id !== '' ? `#${el.id}` : ''} (${visible || el.getAttribute('aria-label') || placeholder || 'no name'})`;
      if (visible === '') problems.push(`${where}: no visible label`);
      else if (placeholder !== '' && visible === placeholder.trim()) problems.push(`${where}: its label is its placeholder`);
    }
    return { problems, checked: controls.length };
  });
}

async function waitLoaded(page: Page) {
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

const SCREENS = ['#/overview', '#/money', '#/holdings', '#/tax', '#/fire', '#/insurance', '#/reports', '#/more', '#/profile', '#/settings', '#/property'];

test('SL-I3 — every input on every screen has a visible label that is not its placeholder', async ({ page }) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  let checked = 0;
  for (const screen of SCREENS) {
    await page.goto(`/${screen}`);
    await waitLoaded(page);
    const result = await audit(page);
    checked += result.checked;
    for (const problem of result.problems) found.push(`${screen}: ${problem}`);
  }
  expect(checked, 'the audit looked at some controls').toBeGreaterThan(0);
  expect(found, found.join('\n')).toEqual([]);
});

test('SL-I3 — every field of Add a holding, on every step of every type, has a visible label that is not its placeholder', async ({ page }) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  await openList(page);
  for (const type of [/^A fund/, /^A deposit/, /^A retirement/, /^Gold/]) {
    await page.getByRole('button', { name: /^Add\b/ }).click();
    await choose(page, 'Type', type);
    const form = stepper(page);
    const steps = Number((await page.getByTestId('step-count').innerText()).replace(/.*of /, ''));
    // Name what is needed to go on, where a step needs it, and read each step as it opens.
    for (let at = 1; at <= steps; at++) {
      const result = await audit(page);
      for (const problem of result.problems) found.push(`${String(type)}, step ${String(at)}: ${problem}`);
      const name = form.getByLabel(/^(Name|What it is)$/);
      if ((await name.count()) > 0 && (await name.first().inputValue()) === '') await name.first().fill('e2e-never-added');
      if (at < steps) {
        const button = page.getByRole('button', { name: 'Next', exact: true });
        if (await button.isEnabled()) await next(page);
        else break;
      }
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  expect(found, found.join('\n')).toEqual([]);
});

test('SL-I3 — axe finds no unlabelled field on the screens a form opens on', async ({ page }) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  for (const screen of ['#/holdings', '#/money', '#/settings', '#/tax', '#/insurance', '#/property']) {
    await page.goto(`/${screen}`);
    await waitLoaded(page);
    const result = await new AxeBuilder({ page }).withRules(['label', 'select-name', 'aria-input-field-name']).analyze();
    for (const violation of result.violations) found.push(`${screen} · ${violation.id}: ${String(violation.nodes.length)} · ${violation.nodes[0]?.html.slice(0, 120) ?? ''}`);
  }
  expect(found, found.join('\n')).toEqual([]);
});

test('SL-I5 — every field is at least 44px tall at 375px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'measured at the phone width');
  test.setTimeout(240_000);
  const short: string[] = [];
  const measure = async (where: string) => {
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.field, .select-trigger, .text-tabs > button'))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({ label: (el.getAttribute('aria-label') ?? el.id) || el.tagName, height: el.getBoundingClientRect().height })),
    );
    for (const field of found) if (field.height < 43.5) short.push(`${where}: ${field.label} is ${field.height.toFixed(1)}px`);
    return found.length;
  };
  let seen = 0;
  for (const screen of ['#/money', '#/settings', '#/tax', '#/insurance', '#/property']) {
    await page.goto(`/${screen}`);
    await waitLoaded(page);
    seen += await measure(screen);
  }
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  seen += await measure('Add a holding, step 1');
  expect(seen, 'some fields were measured').toBeGreaterThan(0);
  expect(short, short.join('\n')).toEqual([]);
});

test('SL-I6 — going back keeps every value, and closing the form half-way writes nothing', async ({ page }) => {
  test.setTimeout(150_000);
  const name = `e2e-never-written-${Date.now()}`;
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  await choose(page, 'Type', /^Gold/);
  const form = stepper(page);

  // Step one, then step two, then back, then forward: nothing typed is lost.
  await form.getByLabel('What it is').fill(name);
  await choose(page, 'Purity', '24K');
  await next(page);
  await form.getByLabel('Weight (g)').fill('7.5');
  await form.getByRole('button', { name: 'Rate per gram' }).click();
  await form.getByLabel('Rate per gram (INR)').fill('7000');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(form.getByLabel('What it is')).toHaveValue(name);
  await expect(choiceField(page, 'Purity')).toContainText('24K');
  await next(page);
  await expect(form.getByLabel('Weight (g)')).toHaveValue('7.5');
  await expect(form.getByLabel('Rate per gram (INR)')).toHaveValue('7000');

  // Close it on step two, by Escape, and nothing has been written: not on the list, and not after a reload.
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await openList(page);
  expect(await (await rowFor(page, name)).count()).toBe(0);
});
