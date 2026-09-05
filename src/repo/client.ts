/**
 * The one Supabase client, private to this folder.
 *
 * Nothing outside src/repo/ imports this module. That is the whole of the
 * repository invariant: swapping to a self-hosted instance, or putting an API
 * in front of the database later, touches this folder and nothing else.
 *
 * The two values below are public by design. The publishable key ships in the
 * bundle and grants nothing the row policies do not already allow; the secret
 * key bypasses every policy and appears nowhere in this repository, in any
 * build output, or in any Actions secret used at build time.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function readConfiguration(): { url: string; key: string } {
  if (typeof url !== 'string' || url === '' || typeof publishableKey !== 'string' || publishableKey === '') {
    throw new ConfigurationError(
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set. Copy .env.example to .env and fill both in.',
    );
  }

  // A loud failure beats a leak that nobody notices for a month.
  if (publishableKey.startsWith('sb_secret') || publishableKey.includes('service_role')) {
    throw new ConfigurationError(
      'A secret key is configured where the publishable key belongs. Stop, rotate that key in the dashboard, and use the sb_publishable_… key instead.',
    );
  }

  return { url, key: publishableKey };
}

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client === null) {
    const configuration = readConfiguration();
    client = createClient(configuration.url, configuration.key, {
      auth: {
        // Refresh tokens rotate; sessions are short-lived and revocable from
        // the device list. On the Tauri and Capacitor shells this storage is
        // replaced with the OS keychain — see docs/blueprint.md §15, layer 09.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }
  return client;
}

/** True when the app has been built with a backend to talk to. */
export function isConfigured(): boolean {
  try {
    readConfiguration();
    return true;
  } catch {
    return false;
  }
}
