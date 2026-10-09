/**
 * Why a second-factor check failed, said as what it was.
 *
 * `verifyTotpCode` used to throw one sentence for everything: "That code was not
 * accepted. Codes expire every 30 seconds, try the current one." A stale session,
 * a discarded factor, a rate limit, a network failure and a genuinely wrong code
 * all read the same, and the sentence named the one cause that was not
 * responsible, so a correct code rejected four times sent somebody round the loop
 * fetching fresh ones while the session had simply gone stale.
 *
 * So the failure is classified first and described second, and the description
 * says what happened and what to do about it. No raw server text is shown: it is
 * unactionable in a browser and sometimes shows internals. An unknown failure keeps
 * its status and code as a short reference, so it can be reported, and nothing else.
 *
 * Pure: no client, no clock.
 */

export interface AuthFailure {
  readonly message: string;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly name?: string | undefined;
}

export type MfaFailureKind =
  | 'wrong-code'
  | 'late-code'
  | 'stale-session'
  | 'factor-gone'
  | 'rate-limited'
  | 'network'
  | 'unknown';

const STALE_CODES = new Set([
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'bad_jwt',
  'no_authorization',
]);

export function classifyMfaFailure(failure: AuthFailure): MfaFailureKind {
  const code = failure.code ?? '';
  const message = failure.message.toLowerCase();

  // No status means the request never got an answer.
  if (failure.name === 'AuthRetryableFetchError' || failure.status === 0) return 'network';

  if (failure.status === 429 || code === 'over_request_rate_limit') return 'rate-limited';

  // Before a mismatch: a stale session made a correct code look wrong, which is the
  // fault this exists to stop.
  if (
    failure.status === 401 ||
    STALE_CODES.has(code) ||
    message.includes('auth session missing') ||
    message.includes('jwt')
  ) {
    return 'stale-session';
  }

  if (code === 'mfa_factor_not_found' || (failure.status === 404 && message.includes('factor'))) return 'factor-gone';
  if (code === 'mfa_challenge_expired' || message.includes('challenge has expired')) return 'late-code';
  if (code === 'mfa_verification_failed' || message.includes('invalid totp')) return 'wrong-code';

  return 'unknown';
}

export function describeMfaFailure(failure: AuthFailure): string {
  switch (classifyMfaFailure(failure)) {
    case 'wrong-code':
      return 'That code was not accepted. Use the one showing now, because it changes every 30 seconds. If it keeps being refused, check that this phone sets its clock automatically.';
    case 'late-code':
      return 'That code took too long to arrive. Enter the one showing now.';
    case 'stale-session':
      return 'Your sign-in has timed out, so the code could not be checked. Sign out and sign in again; the code itself was not the problem.';
    case 'factor-gone':
      return 'This authenticator setup is no longer valid. Sign out and sign in again to start the setup again.';
    case 'rate-limited':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'network':
      return 'Could not reach the sign-in service. Check your connection and try again.';
    case 'unknown': {
      const reference = [failure.status === undefined ? null : String(failure.status), failure.code]
        .filter((part): part is string => part !== null && part !== undefined && part !== '')
        .join(' ');
      return `Something went wrong checking that code. Try again; if it keeps happening, sign out and sign in again${reference === '' ? '' : ` (reference: ${reference})`}.`;
    }
  }
}
