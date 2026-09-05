/**
 * accept-invite — the one endpoint that can create an account.
 *
 * Public sign-up is disabled on this project, deliberately and permanently:
 * "No public sign-up. Accounts are created only by accepting a single-use,
 * expiring invite." This function is the only exception, and the invite code is
 * the entire justification for it — so the code is checked before anything is
 * created, and a failure creates nothing at all.
 *
 * It holds the secret key, which is the first privileged credential anywhere in
 * this system. That is allowed precisely here and nowhere else: "It lives only
 * in the backend's own function environment" (CLAUDE.md). It is never in the
 * repository, the bundle, a build log, or an Actions secret — the CI check
 * would fail the deploy if it were.
 *
 * Deploy:  supabase functions deploy accept-invite --use-api
 * Secrets: supabase secrets set SERVICE_ROLE_KEY=sb_secret_...
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Where the app is served from. A wildcard would let any page on the internet
 * drive this endpoint from a visitor's browser; the endpoint is guarded by the
 * code either way, but there is no reason to invite the attempt.
 */
const ALLOWED_ORIGINS = new Set([
  'https://venkatesh-knr.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin !== null && ALLOWED_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** One wording for every way a code can fail. See the note in the migration. */
const REFUSED = 'That invite code is not valid. Ask for a new one.';

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

interface Payload {
  readonly code?: unknown;
  readonly email?: unknown;
  readonly password?: unknown;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405, origin);
  }

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400, origin);
  }

  const code = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';

  // Shape checks first, so an obviously malformed request never reaches the
  // database and never creates anything.
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code)) {
    return json({ error: REFUSED }, 400, origin);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'That does not look like an email address.' }, 400, origin);
  }
  if (password.length < 12) {
    return json(
      { error: 'Choose a password of at least 12 characters. A passphrase is easier and stronger.' },
      400,
      origin,
    );
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SERVICE_ROLE_KEY');
  if (url === undefined || serviceKey === undefined) {
    console.error('accept-invite is not configured: SUPABASE_URL or SERVICE_ROLE_KEY is missing.');
    return json({ error: 'This is not configured yet. Tell whoever set it up.' }, 500, origin);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Ask before creating anything.
  //
  // Redemption needs an account, so the account must exist first — which would
  // mean a wrong code creates an account and then relies on deleting it again.
  // Cleanup is precisely the step that fails quietly, so the ordinary failure
  // should not depend on it. A bad code now creates nothing whatever, and the
  // delete below is left for the rare case where a code dies in between.
  const open = await admin.rpc('invite_is_open', { invite_code: code });
  if (open.error !== null) {
    console.error('invite_is_open failed', open.error.message);
    return json({ error: 'Could not check that code. Try again shortly.' }, 500, origin);
  }
  if (open.data !== true) {
    return json({ error: REFUSED }, 400, origin);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    // The invite code is the proof of invitation; a confirmation email would be
    // a second, weaker one, and this project sends no mail.
    email_confirm: true,
  });

  if (created.error !== null) {
    // An address already in use is the ordinary case here — say so plainly,
    // since it is the user's own address and no secret of anyone else's.
    const message = created.error.message.toLowerCase().includes('already')
      ? 'There is already an account with that address. Sign in instead, then enter the code.'
      : 'Could not create the account.';
    return json({ error: message }, 400, origin);
  }

  const authUserId = created.data.user?.id;
  if (authUserId === undefined) {
    return json({ error: 'Could not create the account.' }, 500, origin);
  }

  // The auth user id is handed straight to redeem_invite, which resolves the
  // account row itself. This endpoint holds no table grant at all — its whole
  // reach is "create a user" and "redeem a code", and it can do nothing else
  // with the key it carries.
  const redeemed = await admin.rpc('redeem_invite', {
    invite_code: code,
    for_auth_user: authUserId,
  });

  if (redeemed.error !== null) {
    // The code died between the check above and here — someone else used it, or
    // it expired in the gap. Remove the account rather than leave a signed-in
    // stranger with no household, and so a retry is not refused for the address
    // being taken.
    //
    // The result is checked. An earlier version did not, and when the delete
    // failed the endpoint reported a bad code while quietly leaving an orphan
    // account behind — a failure that is invisible exactly when it matters.
    const removed = await admin.auth.admin.deleteUser(authUserId);
    if (removed.error !== null) {
      console.error(
        `orphaned auth user ${authUserId} after failed redemption: ${removed.error.message}`,
      );
      return json(
        { error: 'Something went wrong part way. Tell whoever invited you before trying again.' },
        500,
        origin,
      );
    }
    return json({ error: REFUSED }, 400, origin);
  }

  // No session is returned. The client signs in normally, which puts the new
  // account through the same password-then-authenticator path as everyone
  // else — an account created here is not a way around the second factor.
  return json({ ok: true }, 200, origin);
});
