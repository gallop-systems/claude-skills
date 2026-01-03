# Validation Patterns

> **Example:** [validation-endpoint.ts](./examples/validation-endpoint.ts)

## Available Utilities (all auto-imported from h3)

| Raw | Validated |
|-----|-----------|
| `readBody(event)` | `readValidatedBody(event, validator)` |
| `getQuery(event)` | `getValidatedQuery(event, validator)` |
| `getRouterParams(event)` | `getValidatedRouterParams(event, validator)` |

Note: It's `getRouterParams` (plural), not `getRouterParam`.

## Pattern 1: Direct Schema (h3 v2+ with Standard Schema)

h3 v2+ supports Standard Schema, meaning you can pass Zod schemas directly:

```typescript
const querySchema = z.object({
  search: z.string().min(1),
  page: z.coerce.number().default(1),
});

// Pass schema directly (recommended)
const query = await getValidatedQuery(event, querySchema);

// Also works for body and params
const body = await readValidatedBody(event, bodySchema);
const params = await getValidatedRouterParams(event, paramsSchema);
```

**Pros:** Simplest syntax, cleaner code
**Cons:** ZodError thrown directly - not user-friendly

## Pattern 2: Manual Validator Function

For custom validation logic:

```typescript
const query = await getValidatedQuery(event, (data) => querySchema.parse(data));
```

## Pattern 3: safeParse for Better Errors

```typescript
import { fromZodError } from "zod-validation-error";

const rawQuery = getQuery(event);
const result = querySchema.safeParse(rawQuery);

if (!result.success) {
  console.error("Validation error:", result.error);  // Dev log
  const userError = fromZodError(result.error);      // User-friendly
  throw createError({
    statusCode: 400,
    statusMessage: "Bad Request",
    message: userError.message,
  });
}

return result.data;
```

## Common Zod Patterns

### Query Parameters

```typescript
const querySchema = z.object({
  // Optional string
  search: z.string().optional(),

  // Coerce to number (query params are strings)
  page: z.coerce.number().default(1),
  limit: z.coerce.number().max(100).default(20),

  // Boolean from string
  active: z.enum(["true", "false"]).transform(v => v === "true").optional(),

  // Enum
  status: z.enum(["pending", "active", "closed"]).optional(),

  // Array from comma-separated
  tags: z.string().transform(s => s.split(",")).optional(),
});
```

### Request Body

```typescript
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "user"]).default("user"),
  metadata: z.record(z.string(), z.any()).optional(),
});
```

### Path Parameters

```typescript
const paramsSchema = z.object({
  id: z.coerce.number().positive(),
});

// In /api/users/[id].get.ts
const { id } = await getValidatedRouterParams(event, paramsSchema);
```

## Type Inference from Schemas

Export schemas for client-side type reuse:

```typescript
// types/api.ts
import { z } from "zod";

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Client usage
import type { CreateUserInput } from "~/types/api";
const body: CreateUserInput = { email: "test@example.com", name: "Test" };
```

**Note:** Nitro auto-generates response types, but NOT input types from Zod schemas.
