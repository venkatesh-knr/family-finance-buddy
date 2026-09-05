/// <reference types="vite/client" />

/**
 * The only two environment values this app has, and both are public by design:
 * they are compiled into the bundle that ships to Pages, so in GitHub Actions
 * they are repository variables rather than secrets. Nothing secret is needed
 * to build this app at all, which is exactly the property we want.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
