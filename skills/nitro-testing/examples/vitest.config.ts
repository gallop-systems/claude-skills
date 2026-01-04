import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Enable globals (describe, test, expect without imports)
    globals: true,

    // Node environment for API testing
    environment: "node",

    // Global setup: runs once before all tests
    // - Drops all tables
    // - Runs migrations
    globalSetup: ["./server/test-utils/global-setup.ts"],

    // Setup files: runs before each test file
    // - Stubs Nuxt auto-imports
    setupFiles: ["./server/test-utils/setup.ts"],

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json", "json-summary"],
      include: ["server/**/*.ts"],
      exclude: [
        "server/**/*.test.ts",
        "server/test-utils/**",
        "server/db/migrations/**",
        "server/db/db.d.ts",
      ],
      reportsDirectory: "./coverage",
    },
  },

  resolve: {
    alias: {
      "~": path.resolve(__dirname),
      "@": path.resolve(__dirname),
    },
  },
});
