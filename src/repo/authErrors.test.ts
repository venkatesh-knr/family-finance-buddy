import { describe, expect, it } from 'vitest';
import { classifyMfaFailure, describeMfaFailure } from './authErrors.ts';

describe('classifyMfaFailure', () => {
  it('calls a rejected code a mismatch', () => {
    expect(classifyMfaFailure({ message: 'Invalid TOTP code entered', status: 422, code: 'mfa_verification_failed' })).toBe(
      'wrong-code',
    );
    // By message alone, for a server that sends no code.
    expect(classifyMfaFailure({ message: 'Invalid TOTP code entered', status: 400 })).toBe('wrong-code');
  });

  it('calls an expired challenge a late code, which is the one thing the old message said', () => {
    expect(classifyMfaFailure({ message: 'MFA challenge has expired', status: 422, code: 'mfa_challenge_expired' })).toBe(
      'late-code',
    );
  });

  it('recognises a stale or missing session, however it is reported', () => {
    for (const code of ['session_not_found', 'refresh_token_not_found', 'bad_jwt', 'no_authorization', 'session_expired']) {
      expect(classifyMfaFailure({ message: 'x', status: 401, code })).toBe('stale-session');
    }
    expect(classifyMfaFailure({ message: 'Auth session missing!', status: 400 })).toBe('stale-session');
    expect(classifyMfaFailure({ message: 'invalid JWT: token is expired', status: 401 })).toBe('stale-session');
    expect(classifyMfaFailure({ message: 'nope', status: 401 })).toBe('stale-session');
  });

  it('recognises a factor that no longer exists', () => {
    expect(classifyMfaFailure({ message: 'MFA factor not found', status: 404, code: 'mfa_factor_not_found' })).toBe(
      'factor-gone',
    );
  });

  it('recognises rate limiting', () => {
    expect(classifyMfaFailure({ message: 'x', status: 429 })).toBe('rate-limited');
    expect(classifyMfaFailure({ message: 'x', status: 400, code: 'over_request_rate_limit' })).toBe('rate-limited');
  });

  it('recognises a network failure, which has no status', () => {
    expect(classifyMfaFailure({ message: 'Failed to fetch', name: 'AuthRetryableFetchError' })).toBe('network');
    expect(classifyMfaFailure({ message: 'Failed to fetch', status: 0 })).toBe('network');
  });

  it('does not guess about anything else', () => {
    expect(classifyMfaFailure({ message: 'boom', status: 500, code: 'unexpected_failure' })).toBe('unknown');
  });

  it('puts a stale session ahead of a mismatch when both could apply', () => {
    // The old code reported a correct code as wrong because the session had gone stale.
    expect(classifyMfaFailure({ message: 'Invalid TOTP code', status: 401 })).toBe('stale-session');
  });
});

describe('describeMfaFailure', () => {
  it('keeps the friendly sentence for a genuine mismatch, and names the other usual cause', () => {
    const text = describeMfaFailure({ message: 'Invalid TOTP code entered', status: 422, code: 'mfa_verification_failed' });
    expect(text).toMatch(/not accepted/i);
    expect(text).toMatch(/clock/i);
  });

  it('says a stale session is one, and what to do about it', () => {
    const text = describeMfaFailure({ message: 'x', status: 401, code: 'session_not_found' });
    expect(text).toMatch(/signed out|sign in/i);
    expect(text).not.toMatch(/30 seconds/);
  });

  it('does not tell somebody to fetch a fresh code when the code was never the problem', () => {
    for (const failure of [
      { message: 'x', status: 401 },
      { message: 'x', status: 429 },
      { message: 'Failed to fetch', name: 'AuthRetryableFetchError' },
      { message: 'boom', status: 500 },
      { message: 'MFA factor not found', status: 404, code: 'mfa_factor_not_found' },
    ]) {
      expect(describeMfaFailure(failure)).not.toMatch(/30 seconds|current one|fresh code/i);
    }
  });

  it('never shows the server its own words', () => {
    const text = describeMfaFailure({ message: 'GoTrue internal: pq: duplicate key', status: 500, code: 'unexpected_failure' });
    expect(text).not.toMatch(/GoTrue|pq:|duplicate key/);
  });

  it('keeps a reference for an unknown failure, so it can be reported', () => {
    expect(describeMfaFailure({ message: 'boom', status: 500, code: 'unexpected_failure' })).toMatch(/500.*unexpected_failure/);
  });

  it('says a vanished factor needs the setup started again', () => {
    expect(describeMfaFailure({ message: 'x', status: 404, code: 'mfa_factor_not_found' })).toMatch(/set.?up/i);
  });
});
