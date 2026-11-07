import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The field and the stepper of docs/design/simple-layout.md, as a person uses them: a choice is a field that opens a sheet of options,
 * and Add a holding is a form in steps. Found by role and visible label, not by placeholder or class, so they survive the next restyle.
 */

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The field named `label`, anywhere on the page or inside `scope`. Its name is its label and its value, so it is matched from the start. */
export function choiceField(page: Page, label: string | RegExp, scope?: Locator): Locator {
  const name = typeof label === 'string' ? new RegExp(`^${escaped(label)}`) : label;
  return (scope ?? page).getByRole('combobox', { name });
}

/** Open a choice and pick an option from its sheet. */
export async function choose(page: Page, label: string | RegExp, option: string | RegExp, scope?: Locator): Promise<void> {
  await choiceField(page, label, scope).click();
  const sheet = page.getByRole('dialog').last();
  await sheet.getByRole('option', { name: option }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

/** The texts of a choice's options, read by opening its sheet and closing it again without choosing. */
export async function optionsOf(page: Page, label: string | RegExp, scope?: Locator): Promise<string[]> {
  await choiceField(page, label, scope).click();
  const texts = (await page.getByRole('listbox').getByRole('option').allInnerTexts()).map((text) => text.replace(/\s*✓$/, '').trim());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  return texts;
}

/** Press Next on a stepped form, and wait for the next step. */
export async function next(page: Page): Promise<void> {
  const before = await page.getByTestId('step-count').innerText();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('step-count')).not.toHaveText(before);
}

/** The stepped form on the screen, by its name. */
export function stepper(page: Page): Locator {
  return page.getByRole('form', { name: 'Add a holding' });
}
