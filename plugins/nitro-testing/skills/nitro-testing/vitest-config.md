# Vitest Configuration

> **Example:** [vitest.config.ts](./examples/vitest.config.ts)

Configure Vitest for testing Nitro API handlers.

## Basic Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Enable globals (describe, test, expect without imports)
    globals: true,

    // Node environment (not browser)
    environment: "node",

    // Run once before all tests - reset DB and run migrations
    globalSetup: ["./server/test-utils/global-setup.ts"],

    // Run before each test file - set up stubs
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
```

## Global Setup (Runs Once)

```typescript
// server/test-utils/global-setup.ts
import { Kysely, PostgresDialect, Migrator, FileMigrationProvider } from "kysely";
import { Pool } from "pg";
import path from "path";
import { promises as fs } from "fs";

function getTestConnectionString(): string {
  if (process.env.TEST_POSTGRESQL_CONNECTION_STRING) {
    return process.env.TEST_POSTGRESQL_CONNECTION_STRING;
  }
  return "postgresql://localhost/myapp-test";
}

export async function setup() {
  const connectionString = getTestConnectionString();
  const pool = new Pool({ connectionString });

  // Check database exists
  try {
    await pool.query("SELECT 1");
  } catch (err: any) {
    if (err.code === "3D000") {
      console.error(`
╭─────────────────────────────────────────────────────╮
│  Error: Test database does not exist.               │
│                                                     │
│  Run: createdb myapp-test                           │
╰─────────────────────────────────────────────────────╯
`);
      process.exit(1);
    }
    throw err;
  }

  // Drop all tables and types for clean slate
  await pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      FOR r IN (SELECT typname FROM pg_type t
                JOIN pg_namespace n ON t.typnamespace = n.oid
                WHERE n.nspname = 'public' AND t.typtype = 'e') LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `);
  await pool.end();

  // Run migrations
  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve(__dirname, "../db/migrations"),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  if (error) {
    console.error("Migration failed:", error);
    throw error;
  }

  const applied = results?.filter((r) => r.status === "Success") ?? [];
  console.log(`Test DB ready: ${applied.length} migrations applied`);

  await db.destroy();
}
```

## Setup File (Runs Per Test File)

```typescript
// server/test-utils/setup.ts
import { vi } from "vitest";

// Get test database connection
function getTestConnectionString(): string {
  if (process.env.TEST_POSTGRESQL_CONNECTION_STRING) {
    return process.env.TEST_POSTGRESQL_CONNECTION_STRING;
  }
  return "postgresql://localhost/myapp-test";
}

// Stub useRuntimeConfig before anything else
vi.stubGlobal("useRuntimeConfig", () => ({
  postgresql: {
    connectionString: getTestConnectionString(),
  },
  public: {
    environment: "test",
  },
}));

// Set up handler mocks
const { setupHandlerMocks } = await import("./index");
await setupHandlerMocks();
```

## Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:run": "vitest run"
  }
}
```

## TypeScript Configuration

```json
// tsconfig.json - ensure vitest types are included
{
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

## Test File Pattern

By default, Vitest finds files matching:
- `**/*.test.ts`
- `**/*.spec.ts`

Co-locate tests with handlers:

```
server/
  api/
    users/
      index.get.ts       # Handler
      index.get.test.ts  # Test
      index.post.ts
      index.post.test.ts
      [id].get.ts
      [id].get.test.ts
```

## Environment Variables

```bash
# Local development
# Uses postgresql://localhost/myapp-test by default

# CI/CD
TEST_POSTGRESQL_CONNECTION_STRING=postgresql://postgres:postgres@localhost:5432/myapp-test
```

## Coverage Thresholds (Optional)

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      // Fail if coverage drops below thresholds
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
```
