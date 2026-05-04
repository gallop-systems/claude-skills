/**
 * Vitest Global Setup
 *
 * Runs ONCE before all tests to reset and migrate the test database.
 */

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
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    if (pgError.code === "3D000") {
      console.error(`
╭─────────────────────────────────────────────────────╮
│  Error: Test database does not exist.               │
│                                                     │
│  Run: createdb myapp-test                           │
│                                                     │
│  Then re-run your tests.                            │
╰─────────────────────────────────────────────────────╯
`);
      process.exit(1);
    }
    throw err;
  }

  // Drop all tables and custom types for clean slate
  await pool.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      -- Drop all tables
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      -- Drop all custom enum types
      FOR r IN (SELECT typname FROM pg_type t
                JOIN pg_namespace n ON t.typnamespace = n.oid
                WHERE n.nspname = 'public' AND t.typtype = 'e') LOOP
        EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  await pool.end();

  // Run migrations from scratch
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
