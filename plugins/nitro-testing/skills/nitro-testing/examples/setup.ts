/**
 * Vitest Setup File
 *
 * Runs before each test file to stub Nuxt auto-imports.
 * Database reset/migrations happen in global-setup.ts (runs once).
 */

import { vi } from "vitest";

function getTestConnectionString(): string {
  if (process.env.TEST_POSTGRESQL_CONNECTION_STRING) {
    return process.env.TEST_POSTGRESQL_CONNECTION_STRING;
  }
  return "postgresql://localhost/myapp-test";
}

// Stub useRuntimeConfig before importing anything else
vi.stubGlobal("useRuntimeConfig", () => ({
  postgresql: {
    connectionString: getTestConnectionString(),
  },
  public: {
    environment: "test",
  },
}));

// Import and run handler mocks (after useRuntimeConfig is stubbed)
const { setupHandlerMocks } = await import("./index");
await setupHandlerMocks();
