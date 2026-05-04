# Transaction Rollback Pattern

> **Example:** [test-utils-index.ts](./examples/test-utils-index.ts)

The core isolation pattern: each test runs inside a database transaction that auto-rolls back.

## Why This Pattern?

| Approach | Speed | Isolation | Real SQL |
|----------|-------|-----------|----------|
| Truncate tables | Slow | ✅ | ✅ |
| Mock database | Fast | ✅ | ❌ |
| **Transaction rollback** | **Fast** | **✅** | **✅** |

Transaction rollback gives you real SQL testing with mock-like speed.

## Implementation

### Custom Vitest Fixture

```typescript
import { vi, test as base, expect } from "vitest";
import { db } from "../utils/db";
import type { Transaction } from "kysely";
import type { DB } from "../db/db";

// Current test transaction - handlers access via stubbed useDatabase
let currentTrx: Transaction<DB> | null = null;

interface TestFixtures {
  factories: Factories;
  db: Transaction<DB>;
}

export const test = base.extend<TestFixtures>({
  // The factories fixture sets up the transaction
  factories: async ({}, use) => {
    await db.transaction().execute(async (trx) => {
      currentTrx = trx;
      try {
        await use(createFactories(trx));
        // Force rollback by throwing
        throw { __rollback: true };
      } finally {
        currentTrx = null;
      }
    }).catch((e) => {
      // Swallow our rollback signal
      if (e && typeof e === "object" && "__rollback" in e) {
        return;
      }
      throw e;
    });
  },

  // The db fixture exposes the transaction for direct queries
  db: async ({ factories: _ }, use) => {
    if (!currentTrx) {
      throw new Error("db fixture used outside transaction context");
    }
    await use(currentTrx);
  },
});

export { describe, expect, beforeAll } from "vitest";
```

### Stubbing useDatabase

```typescript
// In setup.ts or as part of setupHandlerMocks()
vi.stubGlobal("useDatabase", () => {
  if (!currentTrx) {
    throw new Error("useDatabase called outside of test transaction");
  }
  return currentTrx;
});
```

Now any handler code that calls `useDatabase()` gets the test transaction.

## Handling Nested Transactions

Real code often uses `db.transaction()` for atomic operations. Since tests already run in a transaction, we need to handle nested transactions:

```typescript
// Patch Transaction prototype to handle nesting
const KyselyModule = await import("kysely");
const TransactionClass = (KyselyModule as any).Transaction;

if (TransactionClass?.prototype) {
  TransactionClass.prototype.transaction = function () {
    const self = this;
    return {
      execute: async <T>(callback: (trx: any) => Promise<T>): Promise<T> => {
        // Just run callback with same transaction (no nesting)
        return callback(self);
      },
    };
  };
}
```

This makes code like this work transparently:

```typescript
// In production: creates real nested transaction
// In tests: reuses the test transaction
async function createOrder(data: OrderData) {
  return db.transaction().execute(async (trx) => {
    const order = await trx.insertInto("order").values(data)...;
    await trx.insertInto("order_item").values(...)...;
    return order;
  });
}
```

## Usage Pattern

```typescript
import { describe, test, expect, mockPost } from "~/server/test-utils";
import handler from "./index.post";

describe("POST /api/orders", () => {
  test("creates order with items", async ({ factories, db }) => {
    // Create test data using factories (transaction-bound)
    const user = await factories.user();
    const product = await factories.product({ price: 100 });

    // Test the handler
    const event = mockPost({}, {
      userId: user.id,
      items: [{ productId: product.id, quantity: 2 }],
    });
    const result = await handler(event);

    // Verify in database
    const order = await db
      .selectFrom("order")
      .where("id", "=", result.id)
      .selectAll()
      .executeTakeFirst();

    expect(order?.total).toBe(200);

    // Verify order items
    const items = await db
      .selectFrom("order_item")
      .where("order_id", "=", result.id)
      .selectAll()
      .execute();

    expect(items).toHaveLength(1);
  });
  // Transaction rolls back - database unchanged
});
```

## Key Points

1. **Always destructure `factories`** - Even if unused, it triggers transaction setup
2. **Use `db` fixture for assertions** - Not the real db import
3. **Nested transactions work** - Thanks to prototype patching
4. **No cleanup needed** - Rollback happens automatically
5. **Tests are isolated** - Can't affect each other

## Gotcha: Unused Factories

Even if you don't create test data, you need the fixture to set up the transaction:

```typescript
// ❌ Wrong - no transaction, useDatabase will fail
test("returns empty list", async () => {
  const result = await handler(mockGet({}));
  expect(result).toEqual([]);
});

// ✅ Right - transaction set up via factories fixture
test("returns empty list", async ({ factories: _ }) => {
  const result = await handler(mockGet({}));
  expect(result).toEqual([]);
});
```
