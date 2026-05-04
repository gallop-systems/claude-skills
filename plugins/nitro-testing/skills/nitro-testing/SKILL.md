---
name: nitro-testing
description: Test Nuxt 3 / Nitro applications - both API handlers (real PostgreSQL, transaction rollback) and frontend components (@nuxt/test-utils, mountSuspended).
---

# Nuxt / Nitro Testing Patterns

Test Nuxt 3 applications end-to-end: API handlers with real PostgreSQL using transaction rollback isolation, and frontend components with @nuxt/test-utils.

## When to Use This Skill

Use this skill when:
- Testing Nuxt 3 / Nitro API handlers
- Testing Vue components, pages, or composables in Nuxt
- Using Kysely or another query builder with PostgreSQL
- Need real database testing (not mocks)
- Want fast, isolated tests without truncation

## Reference Files

**Backend (API Handlers):**
- [transaction-rollback.md](./transaction-rollback.md) - Core isolation pattern with Vitest fixtures
- [test-utils.md](./test-utils.md) - Mock events, stubs, and assertion helpers
- [factories.md](./factories.md) - Transaction-bound factory pattern
- [vitest-config.md](./vitest-config.md) - Vitest configuration for Nitro
- [ci-setup.md](./ci-setup.md) - GitHub Actions with PostgreSQL service
- [async-testing.md](./async-testing.md) - Testing background tasks and automations

**Frontend (Components/Pages):**
- [frontend-testing.md](./frontend-testing.md) - Component testing with @nuxt/test-utils

## Example Files

- [test-utils-index.ts](./examples/test-utils-index.ts) - Complete test utilities module
- [global-setup.ts](./examples/global-setup.ts) - Database reset and migration
- [setup.ts](./examples/setup.ts) - Per-file setup with stubs
- [handler.test.ts](./examples/handler.test.ts) - Example API handler test
- [vitest.config.ts](./examples/vitest.config.ts) - Vitest configuration

## Core Concept: Transaction Rollback

Instead of truncating tables between tests, each test runs inside a database transaction that rolls back at the end:

```typescript
// Each test gets isolated factories and db access
test("creates user", async ({ factories, db }) => {
  const user = await factories.user({ email: "test@example.com" });

  // Test your handler
  const event = mockPost({}, { name: "New Item" });
  const result = await handler(event);

  // Verify in database
  const saved = await db.selectFrom("item").selectAll().execute();
  expect(saved).toHaveLength(1);
});
// Transaction auto-rolls back - no cleanup needed
```

Benefits:
- **Fast**: No DELETE/TRUNCATE between tests
- **Isolated**: Tests can't affect each other
- **Real SQL**: Catches actual database issues
- **Simple**: No manual cleanup

## Quick Setup

### 1. Install Dependencies

```bash
yarn add -D vitest @vitest/coverage-v8
```

### 2. Create Test Utils Structure

```
server/
  test-utils/
    index.ts        # Factories, fixtures, mock helpers
    global-setup.ts # Runs once: reset DB, run migrations
    setup.ts        # Runs per-file: stub auto-imports
```

### 3. Configure Vitest

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["./server/test-utils/global-setup.ts"],
    setupFiles: ["./server/test-utils/setup.ts"],
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname),
    },
  },
});
```

### 4. Write Tests

```typescript
// server/api/users/index.post.test.ts
import { describe, test, expect, mockPost, expectHttpError } from "~/server/test-utils";
import handler from "./index.post";

describe("POST /api/users", () => {
  test("creates user with valid data", async ({ factories: _, db }) => {
    const event = mockPost({}, {
      email: "new@example.com",
      name: "New User"
    });
    const result = await handler(event);

    expect(result.id).toBeDefined();
    expect(result.email).toBe("new@example.com");

    // Verify persisted
    const saved = await db
      .selectFrom("user")
      .where("id", "=", result.id)
      .selectAll()
      .executeTakeFirst();
    expect(saved?.name).toBe("New User");
  });

  test("throws 400 for missing email", async ({ factories: _ }) => {
    const event = mockPost({}, { name: "No Email" });
    await expectHttpError(handler(event), { statusCode: 400 });
  });
});
```

## Key Patterns

### Mock Event Helpers

```typescript
// GET with route params and query
const event = mockGet({ id: 123 }, { include: "details" });

// POST with body
const event = mockPost({}, { name: "Test", status: "active" });

// PATCH with route params and body
const event = mockPatch({ id: 123 }, { status: "completed" });

// DELETE with route params
const event = mockDelete({ id: 123 });
```

### Factory Pattern

```typescript
test("lists user's projects", async ({ factories }) => {
  // Factories are transaction-bound - auto-rolled back
  const user = await factories.user();
  const project1 = await factories.project({ ownerId: user.id });
  const project2 = await factories.project({ ownerId: user.id });

  const event = mockGet({ userId: user.id });
  const result = await handler(event);

  expect(result).toHaveLength(2);
});
```

### Testing with Related Data

```typescript
test("returns task with job details", async ({ factories }) => {
  // Factories auto-create dependencies
  const job = await factories.job(); // Creates project automatically
  const task = await factories.task({ jobId: job.id });

  const event = mockGet({ id: task.id });
  const result = await handler(event);

  expect(result.job.id).toBe(job.id);
  expect(result.job.project).toBeDefined();
});
```

### Testing Error Cases

```typescript
test("returns 404 for non-existent resource", async ({ factories: _ }) => {
  const event = mockGet({ id: 999999 });
  await expectHttpError(handler(event), {
    statusCode: 404,
    message: "Not found",
  });
});

test("returns 400 for invalid input", async ({ factories: _ }) => {
  const event = mockPost({}, { invalidField: true });
  await expectHttpError(handler(event), { statusCode: 400 });
});
```

## Auto-Import Stubs

The setup file stubs Nuxt/Nitro auto-imports:

| Stub | Purpose |
|------|---------|
| `defineEventHandler` | Unwraps to return handler directly |
| `getUserSession` | Returns test user (configurable) |
| `useDatabase` | Returns test transaction |
| `createError` | Creates H3-style errors |
| `getValidatedQuery` | Validates mock query params |
| `readValidatedBody` | Validates mock body |
| `getRouterParam` | Returns mock route params |

## Key Gotchas

1. **Always destructure `factories`** - Even if unused, it sets up the transaction:
   ```typescript
   test("...", async ({ factories: _ }) => { ... });
   ```

2. **Don't use top-level db imports** - Use the `db` fixture instead:
   ```typescript
   // ❌ Wrong - uses real db, not transaction
   import { db } from "../utils/db";

   // ✅ Right - uses test transaction
   test("...", async ({ db }) => { ... });
   ```

3. **Nested transactions work** - Code that calls `db.transaction()` works because we patch the prototype

4. **Test file location** - Co-locate with handlers: `handler.ts` → `handler.test.ts`

5. **Separate test database** - Always use a dedicated test DB (`myapp-test`, not `myapp`)

6. **CI needs PostgreSQL service** - See [ci-setup.md](./ci-setup.md) for GitHub Actions config

---

## Frontend Testing

Test Vue components and pages in Nuxt using `@nuxt/test-utils` with `mountSuspended`.

### Setup

**Dependencies:**
```bash
yarn add -D @nuxt/test-utils @vue/test-utils happy-dom
```

**Vitest Config** - Use environment variable to separate frontend/backend:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { defineVitestConfig } from "@nuxt/test-utils/config";

const isNuxtEnv = process.env.VITEST_ENV === "nuxt";

export default isNuxtEnv
  ? defineVitestConfig({
      test: {
        environment: "nuxt",
        globals: true,
        include: [
          "components/**/*.test.ts",
          "pages/**/*.test.ts",
          "utils/**/*.test.ts",
        ],
      },
    })
  : defineConfig({
      // ... backend config
    });
```

**Package.json scripts:**
```json
{
  "scripts": {
    "test": "vitest",
    "test:frontend": "VITEST_ENV=nuxt vitest",
    "test:frontend:run": "VITEST_ENV=nuxt vitest run"
  }
}
```

**Nuxt test config** (`nuxt.config.test.ts`):
```typescript
export default defineNuxtConfig({
  modules: ["@primevue/nuxt-module"], // Include UI libraries
  ssr: false, // Disable SSR for simpler component testing
});
```

### File Organization

Co-locate tests with source files:
```
components/
  ProjectCard.vue
  ProjectCard.test.ts
pages/
  projects/
    index.vue
    index.test.ts
utils/
  dates.ts
  dates.test.ts
```

### Component Testing Pattern

Use `mountSuspended` for async-safe component mounting:

```typescript
import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ProjectCard from "./ProjectCard.vue";

describe("ProjectCard", () => {
  it("renders project name", async () => {
    const wrapper = await mountSuspended(ProjectCard, {
      props: {
        project: { id: 1, name: "Test Project", status: "active" },
      },
    });

    expect(wrapper.text()).toContain("Test Project");
  });

  it("shows active badge when active", async () => {
    const wrapper = await mountSuspended(ProjectCard, {
      props: {
        project: { id: 1, name: "Test", status: "active" },
      },
    });

    expect(wrapper.html()).toMatch(/active/i);
  });
});
```

### Mocking Composables

Use `mockNuxtImport` for Nuxt composables:

```typescript
import { mockNuxtImport } from "@nuxt/test-utils/runtime";

mockNuxtImport("useAddress", () => {
  return () => ({
    getDisplayAddress: (project: any) =>
      project.address || "No address",
  });
});

mockNuxtImport("useUserSession", () => {
  return () => ({
    user: { id: 1, name: "Test User" },
    loggedIn: true,
  });
});
```

### Mocking API Endpoints

Use `registerEndpoint` to mock API calls:

```typescript
import { registerEndpoint } from "@nuxt/test-utils/runtime";

registerEndpoint("/api/projects", {
  method: "GET",
  handler: () => [
    { id: 1, name: "Project A", status: "active" },
    { id: 2, name: "Project B", status: "completed" },
  ],
});

registerEndpoint("/api/projects/:id", {
  method: "GET",
  handler: (event) => ({
    id: parseInt(event.context.params.id),
    name: "Project Detail",
  }),
});
```

### Testing Pages with Routes

```typescript
import { describe, it, expect } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import TaskPage from "./[id].vue";

describe("Task Detail Page", () => {
  it("renders task details", async () => {
    registerEndpoint("/api/tasks/123", {
      method: "GET",
      handler: () => ({ id: 123, name: "Fix bug", status: "open" }),
    });

    const wrapper = await mountSuspended(TaskPage, {
      route: {
        params: { id: "123" },
      },
    });

    expect(wrapper.text()).toContain("Fix bug");
  });
});
```

### Stubbing UI Library Components

For PrimeVue or other UI libraries, stub complex components:

```typescript
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";

const wrapper = await mountSuspended(MyComponent, {
  global: {
    plugins: [ToastService, ConfirmationService],
    stubs: {
      DataTable: true,
      Column: true,
      Dialog: true,
    },
  },
});
```

### Testing Utility Functions

For pure utilities, standard Vitest patterns work:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatDate, parseDate } from "./dates";

describe("date utilities", () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it("formats date correctly in EST", () => {
    process.env.TZ = "America/New_York";
    expect(formatDate("2025-01-15")).toBe("Jan 15, 2025");
  });

  it("formats date correctly in PST", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(formatDate("2025-01-15")).toBe("Jan 15, 2025");
  });
});
```

### Async Handling

```typescript
import { nextTick } from "vue";

it("updates after user interaction", async () => {
  const wrapper = await mountSuspended(Counter);

  await wrapper.find("button").trigger("click");
  await nextTick();

  expect(wrapper.text()).toContain("Count: 1");
});
```

### Frontend Testing Gotchas

1. **Use `mountSuspended`** - Not regular `mount`. Handles async setup and Nuxt context.

2. **Mock composables before mounting** - `mockNuxtImport` must be called before `mountSuspended`.

3. **Register endpoints before mounting** - API mocks must exist before the component fetches.

4. **Use `wrapper.text()` for content** - More reliable than searching for specific elements.

5. **Await everything** - `mountSuspended`, `trigger()`, `nextTick()` are all async.

6. **Separate test configs** - Use `VITEST_ENV` to run frontend and backend tests with different environments.
