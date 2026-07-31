import { defineConfig } from "vitest/config";

// Node environment only — everything under test today (scheduling math,
// merge-tag rendering, lib/db helpers) is server-only. No jsdom/React
// Testing Library here; add them separately if/when component tests are
// actually needed, rather than paying for an environment nothing uses yet.
//
// .mts (not .ts) so this loads as native ESM regardless of package.json's
// "type" field — avoids Vite's CJS-interop warning for config files using
// `import`/`export`.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
