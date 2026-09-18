import { defineConfig } from 'vitest/config';

// Explicit root + include: worker/ais is a standalone package nested inside
// the main repo, which has its own vitest.config.mts targeting convex/server
// tests only. Without this, vitest walks up and picks that config up instead.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['src/**/*.test.ts'],
  },
});
