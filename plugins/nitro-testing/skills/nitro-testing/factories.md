# Factory Pattern

> **Example:** [test-utils-index.ts](./examples/test-utils-index.ts)

Transaction-bound factories for creating test data with sensible defaults.

## Core Pattern

```typescript
import type { Transaction } from "kysely";
import type { DB } from "../db/db";

function createFactories(trx: Transaction<DB>) {
  return {
    async user(data: Partial<{
      email: string;
      name: string;
      role: string;
    }> = {}) {
      const num = Math.floor(Math.random() * 10000);
      return trx
        .insertInto("user")
        .values({
          email: data.email ?? `test${num}@example.com`,
          name: data.name ?? "Test User",
          role: data.role ?? "user",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async project(data: Partial<{
      name: string;
      ownerId: number;
      status: string;
    }> = {}) {
      // Auto-create owner if not provided
      let ownerId = data.ownerId;
      if (!ownerId) {
        const owner = await this.user();
        ownerId = owner.id;
      }

      return trx
        .insertInto("project")
        .values({
          name: data.name ?? `Test Project ${Date.now()}`,
          owner_id: ownerId,
          status: data.status ?? "active",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async task(data: {
      projectId: number;  // Required - explicit dependency
      title?: string;
      status?: string;
      assigneeId?: number | null;
    }) {
      return trx
        .insertInto("task")
        .values({
          project_id: data.projectId,
          title: data.title ?? "Test Task",
          status: data.status ?? "pending",
          assignee_id: data.assigneeId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
  };
}

export type Factories = ReturnType<typeof createFactories>;
```

## Design Principles

### 1. Sensible Defaults

Every field has a default so you only specify what matters:

```typescript
// Minimal - uses all defaults
const user = await factories.user();

// Override just what you need
const admin = await factories.user({ role: "admin" });
```

### 2. Required vs Optional Dependencies

**Optional dependencies** are auto-created:

```typescript
async project(data: Partial<{...}> = {}) {
  let ownerId = data.ownerId;
  if (!ownerId) {
    const owner = await this.user();  // Auto-create
    ownerId = owner.id;
  }
  // ...
}

// Usage - owner created automatically
const project = await factories.project();

// Or specify one
const project = await factories.project({ ownerId: existingUser.id });
```

**Required dependencies** must be passed:

```typescript
async task(data: {
  projectId: number;  // Required
  // ...
}) {
  // ...
}

// Usage - must create project first
const project = await factories.project();
const task = await factories.task({ projectId: project.id });
```

### 3. Unique Values

Avoid collisions with random/unique values:

```typescript
async user(data: Partial<{...}> = {}) {
  const num = Math.floor(Math.random() * 10000);
  return trx.insertInto("user").values({
    email: data.email ?? `test${num}@example.com`,
    // ...
  });
}

async project(data: Partial<{...}> = {}) {
  return trx.insertInto("project").values({
    name: data.name ?? `Test Project ${Date.now()}`,
    // ...
  });
}
```

### 4. Use `this` for Composition

Factories can call each other:

```typescript
async task(data: {...}) {
  return trx.insertInto("task").values({...});
}

async taskWithAssignee(data: {...}) {
  const assignee = await this.user({ role: "member" });
  return this.task({ ...data, assigneeId: assignee.id });
}
```

## Complex Relationships

### Many-to-Many

```typescript
async projectMember(data: {
  projectId: number;
  userId: number;
  role?: string;
}) {
  return trx
    .insertInto("project_member")
    .values({
      project_id: data.projectId,
      user_id: data.userId,
      role: data.role ?? "member",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

// Usage
const project = await factories.project();
const user = await factories.user();
await factories.projectMember({
  projectId: project.id,
  userId: user.id,
  role: "admin",
});
```

### JSON Fields

```typescript
async organization(data: Partial<{
  name: string;
  metadata: Record<string, any>;
  contacts: { email?: string; phone?: string };
}> = {}) {
  return trx
    .insertInto("organization")
    .values({
      name: data.name ?? `Org ${Date.now()}`,
      metadata: data.metadata ?? {},
      contacts: data.contacts ?? {},
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
```

### Self-Referential (Parent/Child)

```typescript
async category(data: Partial<{
  name: string;
  parentId: number | null;
}> = {}) {
  return trx
    .insertInto("category")
    .values({
      name: data.name ?? "Test Category",
      parent_id: data.parentId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

// Usage - create hierarchy
const parent = await factories.category({ name: "Electronics" });
const child = await factories.category({
  name: "Phones",
  parentId: parent.id,
});
```

## Usage in Tests

```typescript
describe("GET /api/projects/[id]/tasks", () => {
  test("returns tasks for project", async ({ factories }) => {
    const project = await factories.project();
    const task1 = await factories.task({ projectId: project.id });
    const task2 = await factories.task({ projectId: project.id });

    const event = mockGet({ id: project.id });
    const result = await handler(event);

    expect(result).toHaveLength(2);
    expect(result.map((t: any) => t.id)).toContain(task1.id);
  });

  test("excludes other project's tasks", async ({ factories }) => {
    const myProject = await factories.project();
    const otherProject = await factories.project();

    await factories.task({ projectId: myProject.id });
    await factories.task({ projectId: otherProject.id });  // Different project

    const event = mockGet({ id: myProject.id });
    const result = await handler(event);

    expect(result).toHaveLength(1);  // Only our project's task
  });
});
```

## Factory Best Practices

1. **Make required FKs explicit** - Force caller to think about relationships
2. **Make optional FKs auto-created** - Reduce boilerplate for simple tests
3. **Use random/unique values** - Avoid collisions even if tests somehow overlap
4. **Return full entity** - Use `returningAll()` for flexibility
5. **Minimal defaults** - Only set what's needed for valid inserts
6. **Keep factories simple** - No business logic, just data creation
