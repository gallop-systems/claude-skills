/**
 * Example: Testing a POST handler
 *
 * Co-located with the handler: index.post.ts -> index.post.test.ts
 */

import {
  describe,
  test,
  expect,
  mockPost,
  mockGet,
  expectHttpError,
} from "~/server/test-utils";
import handler from "./index.post";
import getHandler from "./[id].get";

describe("POST /api/users", () => {
  test("creates user with valid data", async ({ factories: _, db }) => {
    const event = mockPost({}, {
      email: "new@example.com",
      name: "New User",
    });

    const result = await handler(event);

    // Verify response
    expect(result.id).toBeDefined();
    expect(result.email).toBe("new@example.com");
    expect(result.name).toBe("New User");

    // Verify persisted in database
    const saved = await db
      .selectFrom("user")
      .where("id", "=", result.id)
      .selectAll()
      .executeTakeFirst();

    expect(saved).toBeDefined();
    expect(saved?.email).toBe("new@example.com");
  });

  test("creates user with all optional fields", async ({ factories: _ }) => {
    const event = mockPost({}, {
      email: "full@example.com",
      name: "Full User",
      role: "admin",
      metadata: { source: "api", version: 2 },
    });

    const result = await handler(event);

    expect(result.role).toBe("admin");
    expect(result.metadata).toEqual({ source: "api", version: 2 });
  });

  test("sets default values", async ({ factories: _ }) => {
    const event = mockPost({}, {
      email: "minimal@example.com",
      name: "Minimal",
    });

    const result = await handler(event);

    expect(result.role).toBe("user"); // Default role
    expect(result.created_at).toBeDefined();
  });

  test("throws 400 for missing required email", async ({ factories: _ }) => {
    const event = mockPost({}, {
      name: "No Email",
    });

    await expectHttpError(handler(event), { statusCode: 400 });
  });

  test("throws 400 for missing required name", async ({ factories: _ }) => {
    const event = mockPost({}, {
      email: "test@example.com",
    });

    await expectHttpError(handler(event), { statusCode: 400 });
  });

  test("throws 400 for invalid email format", async ({ factories: _ }) => {
    const event = mockPost({}, {
      email: "not-an-email",
      name: "Test",
    });

    await expectHttpError(handler(event), { statusCode: 400 });
  });

  test("throws 400 for invalid role", async ({ factories: _ }) => {
    const event = mockPost({}, {
      email: "test@example.com",
      name: "Test",
      role: "superadmin", // Not a valid role
    });

    await expectHttpError(handler(event), { statusCode: 400 });
  });

  test("throws 409 for duplicate email", async ({ factories }) => {
    // Create existing user
    await factories.user({ email: "existing@example.com" });

    const event = mockPost({}, {
      email: "existing@example.com",
      name: "Duplicate",
    });

    await expectHttpError(handler(event), { statusCode: 409 });
  });

  test("created user appears in GET", async ({ factories: _ }) => {
    // Create user
    const createEvent = mockPost({}, {
      email: "findme@example.com",
      name: "Find Me",
    });
    const created = await handler(createEvent);

    // Fetch user
    const getEvent = mockGet({ id: created.id });
    const fetched = await getHandler(getEvent);

    expect(fetched.id).toBe(created.id);
    expect(fetched.email).toBe("findme@example.com");
  });
});

describe("POST /api/users - with related data", () => {
  test("creates user with organization", async ({ factories, db }) => {
    const org = await factories.organization({ name: "Acme Corp" });

    const event = mockPost({}, {
      email: "employee@example.com",
      name: "Employee",
      organizationId: org.id,
    });

    const result = await handler(event);

    expect(result.organization_id).toBe(org.id);

    // Verify relationship
    const user = await db
      .selectFrom("user")
      .innerJoin("organization", "organization.id", "user.organization_id")
      .where("user.id", "=", result.id)
      .select(["user.id", "organization.name as org_name"])
      .executeTakeFirst();

    expect(user?.org_name).toBe("Acme Corp");
  });

  test("throws 404 for non-existent organization", async ({ factories: _ }) => {
    const event = mockPost({}, {
      email: "test@example.com",
      name: "Test",
      organizationId: 999999,
    });

    await expectHttpError(handler(event), { statusCode: 404 });
  });
});
