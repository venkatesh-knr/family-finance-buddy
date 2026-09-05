/**
 * Authentication, behind the same boundary as the data.
 *
 * Password plus an authenticator-app code, for every account, whatever the
 * role. There is no sign-up function in this module and no registration route
 * in the app: accounts come into existence only by an owner issuing an invite,
 * and the backend has public sign-up disabled besides.
 *
 * No SMS, ever — SIM-swap is a live attack and the method is deprecated as an
 * authenticator. No federated sign-in either; see docs/blueprint.md §15.
 *
 * Callers see the `AuthStage` union and nothing from a Supabase library.
 */

import { supabase } from './client.ts';

export type AuthStage =
  /** No session. Show the password form. */
  | 'signed-out'
  /** Signed in with a password, but no authenticator app enrolled yet. */
  | 'needs-totp-enrolment'
  /** Enrolled, but this session has not presented a code yet. */
  | 'needs-totp-code'
  /** Password and code both satisfied. */
  | 'signed-in';

export interface AuthState {
  readonly stage: AuthStage;
  readonly email: string | null;
}

export interface TotpEnrolment {
  readonly factorId: string;
  /** An SVG served by our own auth server, for scanning. */
  readonly qrCodeSvg: string;
  /** The same secret as text, for someone typing it in by hand. */
  readonly secret: string;
}

const SIGNED_OUT: AuthState = { stage: 'signed-out', email: null };

/**
 * Where this session stands.
 *
 * The important case is the middle one: a valid password session with no second
 * factor is not a signed-in session. The database agrees — a restrictive policy
 * requires assurance level aal2 before any household row is readable — so this
 * is a considered UI, not the security boundary.
 */
export async function currentAuthState(): Promise<AuthState> {
  const client = supabase();

  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData.session;
  if (session === null) return SIGNED_OUT;

  const email = session.user.email ?? null;

  const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError !== null) throw new Error(assuranceError.message);

  // nextLevel is aal2 only when a verified factor exists on the account.
  if (assurance.nextLevel !== 'aal2') {
    return { stage: 'needs-totp-enrolment', email };
  }

  if (assurance.currentLevel !== 'aal2') {
    return { stage: 'needs-totp-code', email };
  }

  return { stage: 'signed-in', email };
}

export function subscribeToAuth(onChange: () => void): () => void {
  const client = supabase();
  const { data } = client.auth.onAuthStateChange(() => {
    onChange();
  });
  return () => {
    data.subscription.unsubscribe();
  };
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const client = supabase();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error !== null) {
    // Deliberately not distinguishing "no such account" from "wrong password":
    // there is no public sign-up here, so the set of valid addresses is not
    // something a login form should help anyone enumerate.
    throw new Error('That email and password did not match.');
  }
}

/** Where the id of a started-but-unfinished enrolment is kept. See below. */
const PENDING_FACTOR = 'finance-buddy:pending-totp-factor';

/** Dedupes concurrent calls, which StrictMode's double-invoked effect produces. */
let enrolmentInFlight: Promise<TotpEnrolment> | null = null;

function rememberPendingFactor(factorId: string): void {
  try {
    sessionStorage.setItem(PENDING_FACTOR, factorId);
  } catch {
    // Private window, or storage blocked. Worst case an unverified factor is
    // left behind, which is inert.
  }
}

function forgetPendingFactor(): void {
  try {
    sessionStorage.removeItem(PENDING_FACTOR);
  } catch {
    // Nothing to do; see above.
  }
}

/**
 * Discard the factor a previous attempt started.
 *
 * This cannot be done by listing. `listFactors` builds its answer from the user
 * object, and GoTrue omits unverified factors there — so an abandoned enrolment
 * is invisible to the API that would otherwise clean it up. Remembering the id
 * ourselves is the only way to find it again.
 */
async function discardPendingFactor(): Promise<void> {
  const client = supabase();

  let pending: string | null = null;
  try {
    pending = sessionStorage.getItem(PENDING_FACTOR);
  } catch {
    pending = null;
  }

  if (pending !== null && pending !== '') {
    // Already gone, or never existed: either way there is nothing to report.
    await client.auth.mfa.unenroll({ factorId: pending });
    forgetPendingFactor();
  }

  // Best effort on anything the API *will* admit to.
  const { data: factors } = await client.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      await client.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
}

/**
 * Begin enrolling an authenticator app.
 *
 * No friendlyName is sent, deliberately. GoTrue rejects a second factor bearing
 * a name the user already has (mfa_factor_name_conflict), and since an
 * abandoned unverified factor cannot be listed, a fixed name turns one failed
 * attempt into a permanent lockout — every retry collides with the wreckage of
 * the first. The name has no purpose here anyway: what the authenticator app
 * displays comes from the issuer and the account, not from this field.
 */
export async function beginTotpEnrolment(): Promise<TotpEnrolment> {
  if (enrolmentInFlight !== null) return enrolmentInFlight;

  enrolmentInFlight = (async (): Promise<TotpEnrolment> => {
    const client = supabase();

    await discardPendingFactor();

    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      // What the authenticator app shows beside the code.
      issuer: 'Finance Buddy',
    });
    if (error !== null) throw describeAuthError('starting enrolment', error);

    rememberPendingFactor(data.id);

    return {
      factorId: data.id,
      qrCodeSvg: data.totp.qr_code,
      secret: data.totp.secret,
    };
  })();

  try {
    return await enrolmentInFlight;
  } finally {
    enrolmentInFlight = null;
  }
}

/**
 * Present a six-digit code — to finish enrolment, or to raise an existing
 * session to aal2. Both are the same call.
 */
export async function verifyTotpCode(code: string, factorId?: string): Promise<void> {
  const client = supabase();

  let targetFactorId = factorId;
  if (targetFactorId === undefined) {
    const { data: factors, error: listError } = await client.auth.mfa.listFactors();
    if (listError !== null) throw new Error(listError.message);
    const verified = factors.totp[0];
    if (verified === undefined) {
      throw new Error('No authenticator app is enrolled on this account.');
    }
    targetFactorId = verified.id;
  }

  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId: targetFactorId,
    code: code.trim(),
  });
  if (error !== null) {
    throw new Error('That code was not accepted. Codes expire every 30 seconds — try the current one.');
  }

  forgetPendingFactor();

  // Record the enrolment on our own row. Only these two columns are grantable
  // to the account itself, so this cannot become a way to edit anything else.
  const { data: user } = await client.auth.getUser();
  if (user.user !== null) {
    await client
      .from('user_account')
      .update({ mfa_enrolled: true, last_seen_at: new Date().toISOString() })
      .eq('auth_user_id', user.user.id);
  }
}

export async function signOut(): Promise<void> {
  const client = supabase();
  const { error } = await client.auth.signOut();
  if (error !== null) throw new Error(error.message);
}

interface AuthErrorish {
  readonly message: string;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
}

/**
 * Auth errors reach the screen with their status and code attached.
 *
 * GoTrue's `unexpected_failure` is a bare 500 whose message says only "check
 * server logs", which is unactionable from the browser. The code and status are
 * what distinguish a disabled feature (422 mfa_enroll_disabled) from a real
 * server fault, so they belong in front of whoever is looking at the screen.
 */
function describeAuthError(doing: string, error: AuthErrorish): Error {
  const parts: string[] = [];
  if (error.status !== undefined) parts.push(`HTTP ${String(error.status)}`);
  if (error.code !== undefined && error.code !== '') parts.push(error.code);
  const detail = parts.length === 0 ? '' : ` [${parts.join(' · ')}]`;
  return new Error(`Failed while ${doing}: ${error.message}${detail}`);
}
