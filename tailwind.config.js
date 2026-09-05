/**
 * Family Finance Buddy — Tailwind mapped onto the design tokens.
 *
 * Every value here points at a CSS variable declared in src/styles/tokens.css,
 * which is the transcription of docs/tokens.md. Nothing in this file is a hex
 * literal, so a colour changes in exactly one place and both themes follow.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        s2: 'var(--surface-2)',
        s3: 'var(--surface-3)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        brass: 'var(--brass)',
        'brass-soft': 'var(--brass-soft)',
        teal: 'var(--teal)',
        'teal-soft': 'var(--teal-soft)',
        coral: 'var(--coral)',
        'coral-soft': 'var(--coral-soft)',
        indigo: 'var(--indigo)',
        'indigo-soft': 'var(--indigo-soft)',
        c1: 'var(--c1)',
        c2: 'var(--c2)',
        c3: 'var(--c3)',
        c4: 'var(--c4)',
        c5: 'var(--c5)',
        c6: 'var(--c6)',
        c7: 'var(--c7)',
      },
      fontFamily: {
        display: ['Newsreader', 'Georgia', '"Times New Roman"', 'serif'],
        sans: [
          '"Public Sans"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // The type scale from docs/tokens.md §3, verbatim.
      fontSize: {
        hero: ['clamp(32px, 6vw, 48px)', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        title: ['22px', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        'card-title': ['14.5px', { lineHeight: '1.35' }],
        body: ['15px', { lineHeight: '1.55' }],
        stat: ['17px', { lineHeight: '1.3' }],
        cell: ['13.4px', { lineHeight: '1.45' }],
        caption: ['12.5px', { lineHeight: '1.45' }],
        micro: ['10.5px', { lineHeight: '1.4', letterSpacing: '0.13em' }],
        pill: ['9.5px', { lineHeight: '1.4', letterSpacing: '0.1em' }],
      },
      // The 8px base with 2px steps where density demands it (§4).
      spacing: {
        1: '4px',
        1.5: '6px',
        2: '8px',
        2.5: '10px',
        3: '12px',
        3.5: '14px',
        4.5: '18px',
        5.5: '22px',
        6.5: '26px',
        8.5: '34px',
        11: '44px',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        pill: 'var(--radius-pill)',
        input: '7px',
        seg: '6px',
      },
      boxShadow: {
        card: 'var(--shadow)',
      },
      maxWidth: {
        app: '880px',
      },
    },
  },
  plugins: [],
};
