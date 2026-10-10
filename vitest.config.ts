import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The checks' own tests live beside the scripts they test. They are plain ESM and are not part of the
    // type-checked app (tsconfig includes only src), so they sit outside it.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
