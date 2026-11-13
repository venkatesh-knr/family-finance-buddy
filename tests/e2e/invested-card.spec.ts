import { test, expect, type Page } from '@playwright/test';
import { archiveByName, openFixedForm, typeTerms } from './holdings.ts';

/**
 * Investing this month, on the Overview (docs/design/spending-capture.md section 10; the invested half of the MonthMoney board).
 *
 * The arithmetic is proved in `src/domain/invested.test.ts`. This proves the card is on the screen, that it follows a deposit being
 * opened, and that the month can be stepped back and forward. A deposit is the entry used because its date is the one the spec
 * chooses, and it is archived after: archiving ends a holding and does not take its start out of the month it began in.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Today in India, which is the day the app counts the month by. */
function todayInIst(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function onOverview(page: Page) {
  await page.goto('/#overview');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('invested-card')).toBeVisible({ timeout: 20_000 });
  // The card says it is reading the PPF payments until they have come, and its rows are not there yet: count nothing before then.
  await expect(page.getByText('Reading PPF payments…')).toHaveCount(0, { timeout: 20_000 });
}

const heading = (page: Page) => page.getByRole('heading', { name: /investing in / });

test('the card names whose it is and the month, and shows this month or last month', async ({ page }) => {
  await onOverview(page);
  const month = MONTHS[Number(todayInIst().slice(5, 7)) - 1] ?? '';
  await expect(heading(page)).toHaveText(`Your investing in ${month}`);
  await expect(page.getByTestId('invested-card')).toContainText('Month to date');

  const thisMonth = page.getByRole('button', { name: 'This month' });
  const lastMonth = page.getByRole('button', { name: 'Last month' });
  await expect(thisMonth).toHaveAttribute('aria-pressed', 'true');
  await expect(lastMonth).toHaveAttribute('aria-pressed', 'false');

  await lastMonth.click();
  await expect(heading(page)).not.toHaveText(`Your investing in ${month}`);
  await expect(page.getByTestId('invested-card')).not.toContainText('Month to date');
  await expect(lastMonth).toHaveAttribute('aria-pressed', 'true');

  await thisMonth.click();
  await expect(heading(page)).toHaveText(`Your investing in ${month}`);
});

test('a deposit opened this month is put in, once, under Deposits', async ({ page }) => {
  await onOverview(page);
  const row = page.getByTestId('invested-class-deposit');
  const entriesBefore = (await row.count()) === 0 ? 0 : Number(/(\d+) entr/.exec((await row.innerText()))?.[1] ?? '0');

  const name = `e2e-invested-${String(Date.now())}`;
  const today = todayInIst();
  const form = await openFixedForm(page);
  await typeTerms(page, form, {
    name,
    amount: '12345',
    rate: '7',
    starts: today,
    matures: `${String(Number(today.slice(0, 4)) + 2)}${today.slice(4)}`,
    declineFirstReading: true,
  });
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  await onOverview(page);
  await expect(page.getByTestId('invested-class-deposit')).toContainText(`${String(entriesBefore + 1)} ${entriesBefore + 1 === 1 ? 'entry' : 'entries'}`, {
    timeout: 20_000,
  });
  await expect(page.getByTestId('invested-none')).toHaveCount(0);

  await archiveByName(page, name);
});
