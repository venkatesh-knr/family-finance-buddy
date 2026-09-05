import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-security policy, built from the backend origin so there is one source
 * of truth for it. Applied to the built bundle only: the dev server needs the
 * inline scripting that this policy exists to forbid.
 *
 * `frame-ancestors` is deliberately present and deliberately ineffective here —
 * browsers ignore it in a meta tag, and GitHub Pages cannot set response
 * headers. Behind a custom domain on a host that can, it should move to a real
 * header along with Strict-Transport-Security.
 */
function contentSecurityPolicy(supabaseUrl: string): Plugin {
  let origin = '';
  let socket = '';
  try {
    const url = new URL(supabaseUrl);
    origin = url.origin;
    socket = `wss://${url.host}`;
  } catch {
    // No URL configured (a bare `vite build` with no env). The policy still
    // applies; the app simply has nothing it is allowed to talk to.
  }

  const policy = [
    `default-src 'self'`,
    `script-src 'self'`,
    `style-src 'self' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data:`,
    `connect-src 'self' ${origin} ${socket}`.trim(),
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
  ].join('; ');

  return {
    name: 'finance-buddy-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  // Read straight from process.env: these two are repository variables in CI and
  // a .env file locally, and both are public by design.
  const supabaseUrl = process.env['VITE_SUPABASE_URL'] ?? '';

  return {
    // Pages serves the site under /<repo>/. The workflow passes the repository
    // name; a custom domain later means setting VITE_BASE to "/".
    base: process.env['VITE_BASE'] ?? (mode === 'production' ? '/family-finance-buddy/' : '/'),
    plugins: [react(), contentSecurityPolicy(supabaseUrl)],
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  };
});
