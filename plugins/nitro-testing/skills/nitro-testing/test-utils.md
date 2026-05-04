# Test Utilities

> **Example:** [test-utils-index.ts](./examples/test-utils-index.ts)

Mock event creators, global stubs, and assertion helpers for testing Nitro handlers.

## Mock Event Helpers

Create H3 events for testing handlers:

```typescript
import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";

type Params = Record<string, string | number>;

export function createMockEvent(options: {
  method?: string;
  params?: Params;
  body?: unknown;
  query?: Record<string, string>;
}) {
  const { method = "GET", params = {}, body, query = {} } = options;

  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = "/" + (Object.keys(query).length
    ? "?" + new URLSearchParams(query).toString()
    : "");

  const res = new ServerResponse(req);
  const event = createEvent(req, res);

  // Set route params
  event.context.params = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  );

  // Set mock body and query for validation functions
  if (body !== undefined) {
    event.context._mockBody = body;
  }
  if (Object.keys(query).length > 0) {
    event.context._mockQuery = query;
  }

  return event;
}

// Convenience helpers
export function mockGet(params: Params, query?: Record<string, string>) {
  return createMockEvent({ method: "GET", params, query });
}

export function mockPost(params: Params, body: unknown) {
  return createMockEvent({ method: "POST", params, body });
}

export function mockPatch(params: Params, body: unknown) {
  return createMockEvent({ method: "PATCH", params, body });
}

export function mockDelete(params: Params) {
  return createMockEvent({ method: "DELETE", params });
}
```

### Usage

```typescript
// GET /api/users/123?include=profile
const event = mockGet({ id: 123 }, { include: "profile" });

// POST /api/users with JSON body
const event = mockPost({}, { email: "test@example.com", name: "Test" });

// PATCH /api/users/123 with partial update
const event = mockPatch({ id: 123 }, { status: "active" });

// DELETE /api/users/123
const event = mockDelete({ id: 123 });
```

## Global Stubs

Stub Nuxt auto-imports so handlers work in test environment:

```typescript
import { vi } from "vitest";

export async function setupHandlerMocks() {
  // Unwrap defineEventHandler
  vi.stubGlobal("defineEventHandler", (handler: Function) => handler);

  // Default test user
  vi.stubGlobal("getUserSession", async () => ({
    user: { id: 1, firstName: "Test", lastName: "User", role: "admin" },
  }));

  vi.stubGlobal("setUserSession", async () => {});

  // Database access (currentTrx set by test fixture)
  vi.stubGlobal("useDatabase", () => {
    if (!currentTrx) {
      throw new Error("useDatabase called outside of test transaction");
    }
    return currentTrx;
  });

  // Error helper
  vi.stubGlobal("createError", (opts: {
    statusCode: number;
    message?: string;
    statusMessage?: string;
    data?: unknown;
  }) => {
    const error = new Error(opts.message || opts.statusMessage || "") as any;
    error.statusCode = opts.statusCode;
    if (opts.data !== undefined) error.data = opts.data;
    return error;
  });

  // Route params
  vi.stubGlobal("getRouterParam", (event: any, param: string) => {
    return event.context.params?.[param];
  });

  vi.stubGlobal("getValidatedRouterParams", async (event: any, validate: Function) => {
    return validate(event.context.params ?? {});
  });

  // Query params
  vi.stubGlobal("getQuery", (event: any) => {
    return event.context._mockQuery ?? {};
  });

  vi.stubGlobal("getValidatedQuery", async (event: any, validate: Function) => {
    return validate(event.context._mockQuery ?? {});
  });

  // Request body
  vi.stubGlobal("readBody", async (event: any) => event.context._mockBody);

  vi.stubGlobal("readValidatedBody", async (event: any, validate: Function) => {
    return validate(event.context._mockBody ?? {});
  });
}
```

## Assertion Helpers

### expectHttpError

Test that handlers throw proper HTTP errors:

```typescript
export async function expectHttpError(
  promise: Promise<unknown>,
  expected: { statusCode: number; message?: string }
) {
  await expect(promise).rejects.toMatchObject(expected);
}
```

### Usage

```typescript
test("returns 404 for non-existent user", async ({ factories: _ }) => {
  const event = mockGet({ id: 999999 });

  await expectHttpError(handler(event), {
    statusCode: 404,
    message: "User not found",
  });
});

test("returns 400 for invalid input", async ({ factories: _ }) => {
  const event = mockPost({}, { invalidField: "bad" });

  await expectHttpError(handler(event), { statusCode: 400 });
});

test("returns 401 for unauthenticated request", async ({ factories: _ }) => {
  // Override default session
  vi.mocked(getUserSession).mockResolvedValueOnce({ user: null });

  const event = mockGet({});
  await expectHttpError(handler(event), { statusCode: 401 });
});
```

## Customizing Session Per Test

Override the default test user:

```typescript
import { vi } from "vitest";

test("non-admin cannot delete", async ({ factories }) => {
  // Override session for this test
  vi.stubGlobal("getUserSession", async () => ({
    user: { id: 2, role: "user" },  // Not admin
  }));

  const item = await factories.item();
  const event = mockDelete({ id: item.id });

  await expectHttpError(handler(event), { statusCode: 403 });
});
```

Or use `vi.mocked` for one-off overrides:

```typescript
test("user can only see own items", async ({ factories }) => {
  const owner = await factories.user();
  const other = await factories.user();
  const item = await factories.item({ ownerId: owner.id });

  // Mock as the other user
  vi.mocked(getUserSession).mockResolvedValueOnce({
    user: { id: other.id, role: "user" },
  });

  const event = mockGet({ id: item.id });
  await expectHttpError(handler(event), { statusCode: 404 });
});
```

## Re-exports for Convenience

Export everything from one place:

```typescript
// server/test-utils/index.ts
export { describe, expect, beforeAll } from "vitest";
export { test } from "./fixtures";  // Custom fixture
export {
  createMockEvent,
  mockGet,
  mockPost,
  mockPatch,
  mockDelete,
  expectHttpError,
} from "./helpers";
export { setupHandlerMocks } from "./stubs";
export type { Factories } from "./factories";
```

Then in tests:

```typescript
import {
  describe,
  test,
  expect,
  mockPost,
  expectHttpError,
} from "~/server/test-utils";
```
