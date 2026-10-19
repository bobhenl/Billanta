import { defineConfig } from 'vitest/config';

// Kept out of the default `test` run: it needs Java and downloads the
// official rule sets on first use.
export default defineConfig({
  test: {
    include: ['validation/**/*.validation.ts'],
    testTimeout: 60_000
  }
});
