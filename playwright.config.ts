import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

/**
 * Family Finance Buddy — end-to-end tests.
 *
 * These exist to cover what nothing else does. The vitest suite proves the
 * arithmetic, the pgTAP suite proves the policies deny, and the check scripts
 * prove the mechanical conformance. None of them can tell you whether a person
 * can actually add an expense and see it, or whether privacy mode genuinely
 * removes an amount from the page rather than only from view.
 *
 * Two viewports, deliberately. Several real defects on this project existed
 * only at 375px — the privacy control wrapping onto its own line was one — so a
 * phone width is a first-class target here, not an afterthought.
 */

loadEnv({ path: '.env.e2e' });

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  // A failing assertion here usually means a real defect, not a flake. Retrying
  // locally would hide a race rather than reveal it.
  retries: process.env['CI'] === undefined ? 0 : 1,
  // Writes go to a shared demo household, so the specs cannot run in parallel
  // against each other without fighting over its state.
  workers: 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Signs in once, with the second factor, and saves the session. Everything
    // else depends on it. See tests/e2e/auth.setup.ts for why this is not
    // optional and cannot be shortcut.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      // A Chromium phone, not devices['iPhone 13'] — that one runs WebKit and
      // would mean a second browser download for no benefit here. The findings
      // this project cares about are layout at phone width, and the family uses
      // Android. 412 × 915, which is near enough the 375 the review used.
      use: { ...devices['Pixel 7'], storageState: 'tests/e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,
  },
});
