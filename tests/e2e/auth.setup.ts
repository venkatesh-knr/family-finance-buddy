import { test as setup, expect } from '@playwright/test';
import { TOTP } from 'otpauth';
import { mkdirSync } from 'node:fs';

/**
 * Sign in once, with the second factor, and save the session for every spec.
 *
 * Why the long way round. MFA is mandatory for every member — that was a
 * deliberate decision, not a default — so there is no password-only path to
 * authenticate against and the tests must do what a person does. The obvious
 * shortcut, minting a session with the Supabase secret key, is forbidden:
 * `CLAUDE.md` says that key must never appear in the repo, the bundle, a log or
 * a build output, and a test fixture is all four eventually.
 *
 * So the suite drives the real sign-in screen with a real TOTP secret. That
 * costs one dependency and about four seconds, and it buys something worth
 * having: every run proves the authentication path still works, which no other
 * test in this project does.
 *
 * The account this uses must belong to a household marked demo. These specs
 * write expenses. Pointing them at a real household would put test rows in the
 * family's arithmetic, and the whole point of the demo household is that you can
 * experiment destructively without care.
 */

const STATE = 'tests/e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const email = process.env['E2E_EMAIL'];
  const password = process.env['E2E_PASSWORD'];
  const secret = process.env['E2E_TOTP_SECRET'];

  // A clear failure here beats a confusing one four lines later.
  expect(
    email && password && secret,
    'E2E_EMAIL, E2E_PASSWORD and E2E_TOTP_SECRET must be set. Copy .env.e2e.example to .env.e2e — see tests/e2e/README.md.',
  ).toBeTruthy();

  await page.goto('/');

  await page.getByLabel('Email', { exact: true }).fill(email!);
  // `exact` matters: the reveal control beside this input is labelled
  // "Show password", and Playwright matches labels by substring by default.
  await page.getByLabel('Password', { exact: true }).fill(password!);
  // "Continue", not "Sign in" — the password step hands over to the second
  // factor, and it is the TOTP step that is labelled "Sign in".
  await page.getByRole('button', { name: 'Continue' }).click();

  // The second factor. Generated at the moment it is needed rather than up
  // front, because a code produced before the password round trip can expire
  // inside its own test.
  const code = new TOTP({ secret: secret!, digits: 6, period: 30 }).generate();
  await page.getByLabel('Six-digit code', { exact: true }).fill(code);
  // "Sign in" for an enrolled account, "Confirm and finish" the first time.
  await page.getByRole('button', { name: /^(Sign in|Confirm and finish)$/ }).click();

  // Signed in means the shell is there, not that a network call returned.
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible({
    timeout: 20_000,
  });

  // Guard against the suite silently running against real money.
  await expect(
    // Case-insensitive: the badge's text node is "Demo" and the pill's
    // `text-transform: uppercase` only paints it as DEMO. Matching the
    // rendered form would never find it.
    page.getByText(/^demo$/i),
    'The E2E account must be in a household marked demo — these specs write expenses.',
  ).toBeVisible();

  mkdirSync('tests/e2e/.auth', { recursive: true });
  await page.context().storageState({ path: STATE });
});
