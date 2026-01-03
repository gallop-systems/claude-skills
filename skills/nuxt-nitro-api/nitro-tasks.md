# Nitro Tasks

Background jobs, scheduled tasks, and one-off operations.

## Enabling Tasks

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  nitro: {
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      // Cron format: minute hour day month weekday
      "*/5 * * * *": ["scheduled:cleanup"],      // Every 5 minutes
      "0 0 * * *": ["scheduled:daily-report"],   // Daily at midnight
      "0 8 * * 1": ["scheduled:weekly-digest"],  // Mondays at 8am
    },
  },
});
```

## Defining Tasks

Tasks live in `server/tasks/`. Directory structure = task name with colons:
- `server/tasks/hello.ts` → `hello`
- `server/tasks/scheduled/cleanup.ts` → `scheduled:cleanup`
- `server/tasks/jobs/send-email.ts` → `jobs:send-email`

```typescript
// server/tasks/jobs/send-email.ts
import { z } from "zod";

const PayloadSchema = z.object({
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
});

export default defineTask({
  meta: {
    name: "jobs:send-email",
    description: "Send an email in the background",
  },
  async run({ payload }) {
    const data = PayloadSchema.parse(payload);
    await sendEmail(data);

    return {
      result: "success",
      sentAt: new Date().toISOString(),
    };
  },
});
```

## Running Tasks

### 1. Programmatically with `runTask`

```typescript
export default defineEventHandler(async (event) => {
  const result = await runTask("jobs:send-email", {
    payload: {
      to: "user@example.com",
      subject: "Hello",
      body: "Welcome!",
    },
  });

  return { taskResult: result };
});
```

### 2. Fire-and-forget Pattern

```typescript
// Don't wait for completion
runTask("jobs:send-email", {
  payload: { to: "user@example.com", subject: "Hello", body: "Hi!" },
}).catch((error) => {
  console.error("Task failed:", error);
});

return { message: "Email queued" };
```

### 3. Dev Server API (development only)

```bash
GET /_nitro/tasks                          # List all tasks
GET /_nitro/tasks/jobs:send-email          # Run task
POST /_nitro/tasks/jobs:send-email         # Run with payload
```

### 4. CLI

```bash
npx nitro task list
npx nitro task run jobs:send-email --payload '{"to":"user@example.com"}'
```

## Critical Limitation: Single Instance (By Design)

**Each task can only have ONE running instance at a time.**

If you call `runTask("my-task")` while it's already running:
- The second call returns the SAME result as the first
- It does NOT queue or start a new execution
- No error is thrown

```typescript
// These share the same execution!
const [result1, result2] = await Promise.all([
  runTask("long-running-task"),
  runTask("long-running-task"),
]);
// result1 === result2
```

## Workaround: Database Job Queue

For true background processing, use a database-backed queue:

```typescript
// 1. Enqueue job
export async function enqueueJob(jobType: string, payload: any) {
  const db = useDatabase();
  const [job] = await db
    .insertInto("job_queue")
    .values({
      job_type: jobType,
      payload: JSON.stringify(payload),
      status: "pending",
      created_at: new Date(),
    })
    .returning(["id"])
    .execute();
  return job.id;
}

// 2. Job dispatcher (runs every few seconds)
// server/tasks/scheduled/job-dispatcher.ts
export default defineTask({
  meta: { name: "scheduled:job-dispatcher" },
  async run() {
    const db = useDatabase();

    // Dequeue with locking
    const job = await db.transaction().execute(async (trx) => {
      const job = await trx
        .selectFrom("job_queue")
        .selectAll()
        .where("status", "=", "pending")
        .orderBy("created_at", "asc")
        .forUpdate()      // Lock row
        .skipLocked()     // Skip locked rows
        .limit(1)
        .executeTakeFirst();

      if (!job) return null;

      await trx
        .updateTable("job_queue")
        .set({ status: "processing", started_at: new Date() })
        .where("id", "=", job.id)
        .execute();

      return job;
    });

    if (!job) return { result: "No jobs" };

    // Fire and forget the work
    processJob(job).catch(console.error);

    return { result: `Dispatched job ${job.id}` };
  },
});
```

```typescript
// nuxt.config.ts
scheduledTasks: {
  "*/2 * * * * *": ["scheduled:job-dispatcher"],  // Every 2 seconds
}
```

## Retry Logic

```typescript
export async function markJobFailed(jobId: number, error: Error) {
  const db = useDatabase();
  const job = await db
    .selectFrom("job_queue")
    .select(["attempt_count", "max_attempts"])
    .where("id", "=", jobId)
    .executeTakeFirst();

  const shouldRetry = (job.attempt_count || 0) < (job.max_attempts || 3);

  if (shouldRetry) {
    // Exponential backoff: 1min, 2min, 4min...
    const delay = Math.pow(2, job.attempt_count || 0) * 60000;
    const jitter = Math.random() * 0.1 * delay;

    await db
      .updateTable("job_queue")
      .set({
        status: "pending",
        scheduled_at: new Date(Date.now() + delay + jitter),
        error_message: error.message,
      })
      .where("id", "=", jobId)
      .execute();
  } else {
    await db
      .updateTable("job_queue")
      .set({ status: "failed", error_message: error.message })
      .where("id", "=", jobId)
      .execute();
  }
}
```

## When to Use Each Pattern

| Pattern | Use Case |
|---------|----------|
| `runTask` with await | One-off tasks, need result |
| Fire-and-forget | Background work, no result needed |
| Scheduled tasks | Recurring jobs (cleanup, reports) |
| DB job queue | Concurrent jobs, retries, reliability |

## Key Gotchas

1. **Single instance limitation** - Can't run same task twice concurrently
2. **No built-in queue** - Multiple calls share result
3. **Scheduled tasks need server** - Won't work with `nuxt generate`
4. **Dev API only in dev** - `/_nitro/tasks/*` not in production
5. **Cron needs specific runtimes** - node-server, bun, deno-server, cloudflare
6. **Fire-and-forget errors** - Must add `.catch()` or errors are swallowed
