import { defineConfig } from "vitest/config";

// Separate from vitest.config.mts (convex/server tests) so `npm run test:api`
// only picks up api/**/*.test.ts, matching the existing test:convex pattern.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["api/**/*.test.ts"],
  },
});
