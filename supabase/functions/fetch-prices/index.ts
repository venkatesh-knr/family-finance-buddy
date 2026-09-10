/**
 * fetch-prices — the driver, and the only thing that talks to a price vendor.
 *
 * "Prices are written by a driver into the dated `price` table on a schedule.
 * Clients never call a data vendor directly." §795 says it from the other
 * side: "Nothing in the app fetches a price."
 *
 * That rule is why this is a function and not a few lines in the client. A
 * browser calling AMFI directly would put the vendor's availability, its CORS
 * policy and its rate limit into every screen, and would make "which figure
 * did we use" depend on whose device happened to load first.
 *
 * ── why this holds the secret key, and how little it does with it ───────
 *
 * `price` has no insert grant for any client. It is reference data — a NAV is
 * the same fact for every household — and no member writes one, because a
 * household able to write its own NAV could move its own net worth, which is
 * the figure the whole app exists to state honestly.
 *
 * So the writer has to be something that is not a client, and this is it. The
 * same allowance accept-invite already relies on: the key "lives only in the
 * backend's own function environment", never in the repository, the bundle, a
 * build log, or an Actions secret.
 *
 * What it can do with that key is one thing: append rows to the table of
 * published prices. It has insert on `price` and no privilege anywhere else —
 * in particular no read of `instrument`, which an earlier version needed and
 * which would have been a standing view of every household's portfolio.
 *
 * ── why it is not on a cron ─────────────────────────────────────────────
 *
 * The month-end close job answered this first, and half the reasoning carries
 * directly: a scheduled caller is nobody, which needs a policy for nobody,
 * which is deny-by-default routed around for convenience. That was rejected
 * once already and the rejection was right.
 *
 * The other half is different here and lands in the same place. AMFI's file
 * carries history, so a fetch on Thursday recovers Tuesday's NAV exactly as
 * well as a fetch on Tuesday would have. Nothing decays in between, so running
 * when somebody opens the app is not a degraded version of running at six in
 * the morning — it is the same result without a second privileged path into
 * the database.
 *
 * Intraday prices would be a different driver with a different argument, and
 * it can have that argument on its own terms.
 *
 * Deploy:  supabase functions deploy fetch-prices --use-api
 * Secrets: supabase secrets set SERVICE_ROLE_KEY=sb_secret_...
 *
 * That secret must be the CURRENT secret key. A project that has moved to the
 * new key format rejects the legacy service_role JWT outright, and the
 * rejection surfaces here as a failure to read which instruments to price —
 * which is why that error now carries the provider's own words rather than a
 * summary of them.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseAmfi } from '../_shared/amfi.ts';

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

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/** AMFI's daily file: every scheme in India, one line each, semicolon separated. */
const AMFI_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return json({ error: 'POST only.' }, 405, origin);
  }

  // Signed in, and that is the whole gate. This returns no household data and
  // writes nothing a member could not already read, so the check is against an
  // anonymous internet rather than against another member.
  const authorization = request.headers.get('Authorization');
  if (authorization === null) {
    return json({ error: 'Sign in first.' }, 401, origin);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const secret = Deno.env.get('SERVICE_ROLE_KEY');
  if (url === undefined || secret === undefined) {
    return json({ error: 'The price driver is not configured.' }, 500, origin);
  }

  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
  });
  const { data: user, error: userError } = await caller.auth.getUser();
  if (userError !== null || user.user === null) {
    return json({ error: 'Sign in first.' }, 401, origin);
  }

  const admin = createClient(url, secret, { auth: { persistSession: false } });

  // Which schemes to fetch comes from the caller, not from a privileged read
  // of everybody's holdings.
  //
  // The first version asked `instrument` directly, which needed select on that
  // table for the secret key — a standing read over every household's
  // portfolio, granted permanently to save a round trip. Postgres even
  // suggested it by name when the permission was missing. The caller has
  // already listed its own instruments under its own policies, so it can say
  // which identifiers it wants and the driver simply fetches those.
  //
  // A caller naming an instrument it cannot see gains nothing: the result is a
  // published NAV for a fund, which is public knowledge and says nothing about
  // who holds it.
  let ids: Set<string>;
  try {
    const body: unknown = await request.json();
    const asked = (body as { externalIds?: unknown }).externalIds;
    if (!Array.isArray(asked)) {
      return json({ error: 'Ask for some instruments: externalIds is required.' }, 400, origin);
    }
    ids = new Set(
      asked
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim().toUpperCase())
        .filter((id) => id !== '' && id.length <= 64),
    );
  } catch {
    return json({ error: 'That request was not JSON.' }, 400, origin);
  }

  // Bounded, so one call cannot ask for the whole file to be written.
  const LIMIT = 500;
  if (ids.size > LIMIT) {
    return json({ error: `Too many instruments at once: ${String(LIMIT)} is the limit.` }, 400, origin);
  }

  if (ids.size === 0) {
    return json({ fetched: 0, written: 0, note: 'No instrument names an AMFI code.' }, 200, origin);
  }

  let text: string;
  try {
    const response = await fetch(AMFI_URL, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      return json({ error: `AMFI returned ${String(response.status)}.` }, 502, origin);
    }
    text = await response.text();
  } catch {
    // A vendor being down is not this app being broken, and the caller is told
    // which it is: nothing is written, and the prices already recorded stand.
    return json({ error: 'AMFI could not be reached. Prices are unchanged.' }, 502, origin);
  }

  const quotes = parseAmfi(text).filter((quote) => ids.has(quote.externalId));

  if (quotes.length === 0) {
    return json({ fetched: 0, written: 0, note: 'No matching scheme in the file.' }, 200, origin);
  }

  // Appended, never updated: a revised NAV is a second row for the same date
  // with a later fetched_at, so the figure a past total used stays visible.
  const { error: writeError } = await admin.from('price').insert(
    quotes.map((quote) => ({
      source: 'amfi',
      external_id: quote.externalId,
      as_of_date: quote.asOf,
      value: quote.value,
      currency: 'INR',
    })),
  );

  if (writeError !== null) {
    return json(
      {
        error: `Could not record the prices: ${writeError.message}`,
        hint: writeError.hint ?? undefined,
        code: writeError.code ?? undefined,
      },
      500,
      origin,
    );
  }

  return json({ fetched: quotes.length, written: quotes.length }, 200, origin);
});
