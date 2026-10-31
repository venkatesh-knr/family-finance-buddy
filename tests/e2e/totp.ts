import { TOTP } from 'otpauth';

/**
 * A code from the authenticator for the current 30-second window, waiting for the next if this worker has already used the current
 * one. Sign-in, an export, an upload and a reversal each ask for a fresh code, and the second factor refuses one it has seen.
 */

let lastWindow = -1;

export async function freshCode(): Promise<string> {
  const secret = process.env['E2E_TOTP_SECRET'];
  if (!secret) throw new Error('E2E_TOTP_SECRET must be set (tests/e2e/README.md).');
  const window = () => Math.floor(Date.now() / 30_000);
  while (window() === lastWindow) await new Promise((resolve) => setTimeout(resolve, 1_000));
  lastWindow = window();
  return new TOTP({ secret, digits: 6, period: 30 }).generate();
}
