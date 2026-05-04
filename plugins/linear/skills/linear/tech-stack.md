# Gallop Systems — Tech Stack Reference

This document describes the standard tech stack used across all Gallop Systems projects, based on the [nuxt-copier-template](https://github.com/gallop-systems/nuxt-copier-template).

---

## Stack Overview

| Layer | Technology | Version |
|-------|-----------|---------|
| **Framework** | Nuxt 4 (Vue 3) | ^4.2.2 |
| **Server** | Nitro (built into Nuxt) | — |
| **Database** | PostgreSQL | 15+ |
| **Query Builder** | Kysely (type-safe SQL) | ^0.28.9 |
| **Auth** | nuxt-auth-utils (session-based) | ^0.5.27 |
| **OAuth** | Google OAuth (optional) | via nuxt-auth-utils |
| **UI Components** | PrimeVue (unstyled) + Volt | ^4.5.4 |
| **Styling** | Tailwind CSS v4 | ^4.1.18 |
| **Icons** | PrimeIcons | ^7.0.0 |
| **Validation** | Zod | ^4.3.5 |
| **Date Handling** | date-fns | ^4.1.0 |
| **Testing** | Vitest | ^4.0.17 |
| **Linter** | oxlint | latest |
| **Formatter** | oxfmt | latest |
| **Package Manager** | Yarn 4 (Berry) | 4.12.0 |
| **Node Version** | 22 | (see .nvmrc) |
| **Git Hooks** | Lefthook (optional) | latest |
| **Deployment** | DigitalOcean App Platform | — |

---

## Project Structure (Nuxt 4)

```
app/                        # Frontend
├── assets/css/main.css     # Tailwind + PrimeUI imports + CSS variables
├── components/             # Vue components (auto-imported)
├── composables/            # Vue composables (auto-imported)
├── layouts/                # Layout templates
├── middleware/              # Client-side route middleware
├── pages/                  # File-based routing
└── plugins/                # Vue plugins (PrimeVue setup)

server/                     # Backend (Nitro)
├── api/                    # API routes (file-based: users/index.get.ts → GET /api/users)
│   ├── auth/               # Auth endpoints (OAuth handlers)
│   ├── public/             # Public endpoints (no auth required)
│   └── webhooks/           # Webhook endpoints (own auth)
├── db/
│   ├── db.d.ts             # Auto-generated Kysely types (yarn db:codegen)
│   └── migrations/         # Kysely migrations
├── middleware/              # Server middleware (auth guard)
├── test-utils/             # Test infrastructure
│   ├── index.ts            # Factories, mock helpers, test fixture
│   ├── setup.ts            # Global stubs (useRuntimeConfig, handler mocks)
│   └── global-setup.ts     # DB reset + migrations before test suite
└── utils/
    └── db.ts               # Kysely database connection (exports db, useDatabase())

shared/                     # Shared between frontend + backend
└── types/                  # Type declarations (auth.d.ts)

src/volt/                   # Volt UI components (PrimeVue unstyled + Tailwind)
```

---

## Key Patterns & Conventions

### API Handlers (Nitro)

File naming determines the HTTP method and route:
- `server/api/users/index.get.ts` → `GET /api/users`
- `server/api/users/index.post.ts` → `POST /api/users`
- `server/api/users/[id].get.ts` → `GET /api/users/:id`
- `server/api/users/[id].put.ts` → `PUT /api/users/:id`
- `server/api/users/[id].delete.ts` → `DELETE /api/users/:id`

Standard handler pattern:
```typescript
import { z } from "zod";

export default defineEventHandler(async (event) => {
  const db = useDatabase();

  // Route params
  const { id } = await getValidatedRouterParams(event, z.object({
    id: z.coerce.number(),
  }).parse);

  // Request body (POST/PUT)
  const body = await readValidatedBody(event, z.object({
    name: z.string(),
  }).parse);

  // Query params
  const query = await getValidatedQuery(event, z.object({
    page: z.coerce.number().optional(),
  }).parse);

  // Access authenticated user
  const user = event.context.user;

  // Database operations with Kysely
  return db.selectFrom("users").selectAll().execute();
});
```

### Authentication

- **Server middleware** (`server/middleware/auth.ts`) protects all `/api/*` routes automatically
- **Exempt paths:** `/api/public/*`, `/api/webhooks/*`, `/api/auth/*`
- **Client middleware** (`app/middleware/auth.global.ts`) redirects unauthenticated users to `/login`
- **Session access:** `getUserSession(event)` on server, `useUserSession()` on client
- Authenticated user is available at `event.context.user` in API handlers

### Database (Kysely + PostgreSQL)

- **Connection:** `useDatabase()` returns a Kysely instance (auto-imported in Nitro handlers)
- **Type generation:** Run `yarn db:codegen` after schema changes to regenerate `server/db/db.d.ts`
- **Migrations:** Use `yarn db:migrate:make <name>` to create, `yarn db:migrate` to run
- **Environment variable:** `NUXT_DATABASE_URL` (auto-binds to `runtimeConfig.databaseUrl`)
- **ID columns:** Use `bigint` with `generatedAlwaysAsIdentity()` (not serial)
- **Timestamps:** Use `timestamptz` with `defaultTo(sql\`now()\`)` for `created_at`/`updated_at`
- **Column naming:** Use `snake_case` for database columns (e.g., `first_name`, `created_at`)
- **SSL:** Auto-detected — disabled for localhost, enabled for remote connections

### Migration Pattern

```typescript
import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("table_name")
    .addColumn("id", "bigint", (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("table_name").execute();
}
```

### Testing

**Backend tests** use real PostgreSQL with transaction rollback isolation:

```typescript
import { describe, test, expect, mockGet, mockPost, expectHttpError } from "~/server/test-utils";
import handler from "./endpoint.get";

describe("GET /api/endpoint", () => {
  test("description", async ({ factories }) => {
    // Create test data (auto-rolled back after test)
    const user = await factories.user({ email: "test@example.com" });

    // Create mock HTTP event
    const event = mockGet();                           // GET with no params
    const event = mockGet({ id: "1" });                // GET with route params
    const event = mockGet({}, { page: "1" });           // GET with query params
    const event = mockPost({}, { name: "Test" });       // POST with body
    const event = mockPut({ id: "1" }, { name: "X" }); // PUT with params + body
    const event = mockDelete({ id: "1" });              // DELETE with params

    // Call handler directly
    const result = await handler(event);
    expect(result).toHaveLength(1);
  });

  test("throws 404", async ({ factories: _ }) => {
    // Always destructure factories (even as _) to set up transaction
    const event = mockGet({ id: "999" });
    await expectHttpError(handler(event), { statusCode: 404 });
  });
});
```

**Frontend tests** use Nuxt test environment:
```bash
VITEST_ENV=nuxt vitest  # or yarn test:frontend
```

Test file locations:
- Backend: `server/**/*.test.ts` (co-located with handlers)
- Frontend: `app/components/**/*.test.ts`, `app/pages/**/*.test.ts`, `app/composables/**/*.test.ts`

### UI Components (Volt + PrimeVue)

- Volt components are PrimeVue unstyled components styled with Tailwind
- Registered with `Volt` prefix: `VoltButton`, `VoltCard`, `VoltDataTable`, etc.
- Customize via `pt:section:class` pass-through syntax (NOT via Tailwind `class` prop)
- See `DESIGN_LANGUAGE.md` for the complete design system

Available Volt components:
`VoltButton`, `VoltSecondaryButton`, `VoltCard`, `VoltDataTable`, `VoltDialog`, `VoltConfirmDialog`, `VoltInputText`, `VoltPassword`, `VoltSelect`, `VoltTextarea`, `VoltAvatar`, `VoltTag`, `VoltMessage`, `VoltToast`

### Design System Essentials

- **Zinc-first palette** — zinc for almost everything, color only for semantic meaning
- **No decorative shadows** — shadows only on hover for interactivity
- **Rounding:** `rounded-xl` for inputs/buttons, `rounded-2xl` for cards
- **Icons:** PrimeIcons (`pi pi-*` classes)
- **Refer to `DESIGN_LANGUAGE.md`** for full component styling reference

---

## Commands Reference

```bash
# Development
yarn dev                      # Dev server on localhost:3000

# Database
yarn db:migrate               # Run all pending migrations
yarn db:migrate:down          # Rollback last migration
yarn db:migrate:make <name>   # Create new migration file
yarn db:codegen               # Regenerate TypeScript types from DB schema

# Testing
yarn test                     # Backend tests (watch mode)
yarn test:run                 # Backend tests (single run)
yarn test:frontend            # Frontend tests (watch mode)
yarn test:frontend:run        # Frontend tests (single run)

# Code Quality
yarn typecheck                # TypeScript type checking
yarn lint                     # oxlint
yarn lint:fix                 # oxlint with auto-fix
yarn fmt                      # oxfmt format
yarn fmt:check                # oxfmt check only

# Build
yarn build                    # Production build
```

---

## CI/CD

GitHub Actions CI runs on push/PR to `main`:
1. **Test job:** Backend tests with coverage + frontend tests (uses PostgreSQL service container)
2. **Lint job:** Typecheck + oxlint + oxfmt check
3. **Coverage job:** Posts coverage report on PRs

Deployment: DigitalOcean App Platform with a pre-deploy migration job (`yarn db:migrate`).

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NUXT_DATABASE_URL` | PostgreSQL connection string |
| `NUXT_SESSION_PASSWORD` | Session encryption secret |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID` | Google OAuth client ID (optional) |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret (optional) |

The `NUXT_` prefix auto-binds to `runtimeConfig` in `nuxt.config.ts`.

---

## Git Hooks (Lefthook)

| Hook | Actions |
|------|---------|
| **pre-commit** | Format (oxfmt) + lint fix (oxlint) on staged `.ts/.vue/.js` files |
| **pre-push** | Backend tests, frontend tests, typecheck, lint (in parallel) |
| **post-merge** | Auto `yarn install` if `package.json`/`yarn.lock` changed; warns if new migrations detected |
