# Server-Side Service Integrations

> **Example:** [service-util.ts](./examples/service-util.ts)

Composable-style utilities for third-party services in `/server/utils/`.

## Basic Pattern

```typescript
// server/utils/stripe.ts
import Stripe from "stripe";

// Initialize at module level with runtime config
const config = useRuntimeConfig();
const stripe = new Stripe(config.stripe.secretKey);

// Define typed methods
async function createPaymentIntent(options: {
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
}) {
  return stripe.paymentIntents.create({
    amount: options.amount,
    currency: options.currency,
    metadata: options.metadata,
  });
}

async function getCustomer(customerId: string) {
  return stripe.customers.retrieve(customerId);
}

// Export as use*()
export function useStripe() {
  return { createPaymentIntent, getCustomer, client: stripe };
}
```

## Usage in API Handlers

```typescript
// server/api/checkout/create.post.ts
export default defineEventHandler(async (event) => {
  const { amount, currency } = await readBody(event);

  const { createPaymentIntent } = useStripe();

  const intent = await createPaymentIntent({
    amount,
    currency,
    metadata: { source: "web" },
  });

  return { clientSecret: intent.client_secret };
});
```

## Service Composition

Services can use other services:

```typescript
// server/utils/orders.ts
export function useOrders() {
  const db = useDatabase();
  const { createPaymentIntent } = useStripe();

  async function createOrder(userId: number, items: CartItem[]) {
    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // Create payment intent with Stripe
    const paymentIntent = await createPaymentIntent({
      amount: total,
      currency: "usd",
      metadata: { userId: String(userId) },
    });

    // Save order to database
    const order = await db
      .insertInto("orders")
      .values({
        user_id: userId,
        total,
        stripe_payment_intent_id: paymentIntent.id,
        status: "pending",
      })
      .returning(["id"])
      .executeTakeFirst();

    return { order, clientSecret: paymentIntent.client_secret };
  }

  return { createOrder };
}
```

## Lazy Initialization

For expensive clients:

```typescript
// server/utils/redis.ts
let redis: Redis | null = null;

export function useRedis(): Redis {
  if (!redis) {
    const config = useRuntimeConfig();

    if (!config.redis?.url) {
      throw new Error("NUXT_REDIS_URL not configured");
    }

    redis = new Redis(config.redis.url);
    redis.on("error", (err) => console.error("Redis error:", err));
    redis.on("connect", () => console.log("Redis connected"));
  }

  return redis;
}

// Health check
export async function isRedisAvailable(): Promise<boolean> {
  try {
    await useRedis().ping();
    return true;
  } catch {
    return false;
  }
}
```

## Error Handling

```typescript
// server/utils/error-handling.ts
export function formatServiceError(error: unknown, service: string) {
  const err = error as any;

  // PostgreSQL constraint violations
  if (err?.code === "23505") {
    return { status: 409, message: "Resource already exists" };
  }
  if (err?.code === "23503") {
    return { status: 400, message: "Referenced resource not found" };
  }

  // Network errors
  if (err?.code === "ECONNREFUSED" || err?.code === "ETIMEDOUT") {
    return { status: 503, message: `${service} service unavailable` };
  }

  // API errors
  if (err?.response?.status) {
    return { status: err.response.status, message: err.message };
  }

  return { status: 500, message: `${service} error: ${err?.message}` };
}

// Usage
async function callExternalApi() {
  try {
    return await client.doSomething();
  } catch (error) {
    const { status, message } = formatServiceError(error, "Stripe");
    throw createError({ statusCode: status, message });
  }
}
```

## Transaction Pattern

```typescript
// server/utils/invoices.ts
export function useInvoices() {
  const db = useDatabase();

  async function createInvoice(params: CreateParams) {
    return await db.transaction().execute(async (trx) => {
      // All operations use trx, not db
      const invoice = await trx
        .insertInto("invoice")
        .values(params)
        .returning(["id"])
        .executeTakeFirst();

      await trx
        .updateTable("session")
        .set({ invoice_id: invoice.id, locked: true })
        .where("id", "in", params.sessionIds)
        .execute();

      return invoice;
    });
  }

  return { createInvoice };
}
```

## Common Structure

```typescript
// server/utils/[service].ts

// 1. Import SDK
import { ServiceClient } from "service-sdk";

// 2. Initialize with runtime config
const config = useRuntimeConfig();
const client = new ServiceClient({ apiKey: config.service.apiKey });

// 3. Define typed methods
async function doAction(params: ActionParams): Promise<ActionResult> {
  try {
    return await client.action(params);
  } catch (error) {
    throw createError({ statusCode: 500, message: error.message });
  }
}

// 4. Export as use*()
export function useService() {
  return {
    doAction,
    client,  // Expose for advanced usage
  };
}
```

## Key Gotchas

1. **Config at module level** - `useRuntimeConfig()` works at module scope
2. **Singleton clients** - Initialize once, reuse across requests
3. **Composition order** - Call use*() inside functions, not module level
4. **Error transformation** - Convert SDK errors to HTTP errors
5. **Transaction scope** - Pass `trx` when in transaction
