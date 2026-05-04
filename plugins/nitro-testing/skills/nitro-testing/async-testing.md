# Async & Automation Testing

> **Example:** [test-utils-index.ts](./examples/test-utils-index.ts)

Test Nitro tasks, background jobs, and automation systems that trigger asynchronously.

## The Challenge

When handlers trigger background tasks, tests need to:
1. Capture task handlers defined with `defineTask`
2. Execute tasks when `runTask` is called
3. Wait for all async operations to complete

## Task Handler Registry

Capture task handlers at registration time:

```typescript
// Track registered task handlers
const taskHandlers: Map<string, (opts: { payload: any }) => Promise<any>> = new Map();

// Track pending task executions
let pendingTasks: Promise<any>[] = [];

// Stub defineTask to capture handlers
vi.stubGlobal("defineTask", (config: {
  meta: { name: string };
  run: (opts: { payload: any }) => Promise<any>;
}) => {
  taskHandlers.set(config.meta.name, config.run);
  return config;
});

// Stub runTask to execute and track
vi.stubGlobal("runTask", (taskName: string, options: { payload: any }) => {
  const handler = taskHandlers.get(taskName);
  if (!handler) {
    return Promise.reject(new Error(`Task handler not found: ${taskName}`));
  }
  const promise = handler(options);
  pendingTasks.push(promise);
  return promise;
});
```

## Waiting for Async Operations

```typescript
/**
 * Wait for all pending task executions to complete.
 * Loops because tasks can spawn other tasks.
 */
export async function waitForAutomations(): Promise<void> {
  while (pendingTasks.length > 0) {
    const tasksToWait = [...pendingTasks];
    pendingTasks = [];
    await Promise.allSettled(tasksToWait);
  }
}
```

## Enabling Real Implementations

By default, stub async triggers as no-ops. Tests opt-in to real behavior:

```typescript
// Default: no-op stub
vi.stubGlobal("triggerAutomation", () => {});

/**
 * Enable automation triggers for tests that need them.
 */
export async function enableAutomationTriggers() {
  // Import the task handler to register it
  await import("../tasks/execute-automation");

  // Import the real trigger function
  const { triggerAutomation: realTrigger } = await import("../utils/automation");

  // Wrap to track promises
  vi.stubGlobal("triggerAutomation", (...args: Parameters<typeof realTrigger>) => {
    const promise = realTrigger(...args);
    pendingTasks.push(promise);
    return promise;
  });
}
```

## Usage in Tests

### Basic Automation Test

```typescript
import {
  describe,
  test,
  expect,
  mockPost,
  enableAutomationTriggers,
  waitForAutomations,
  beforeAll,
} from "~/server/test-utils";
import handler from "./index.post";

// Enable real automations for this file
beforeAll(async () => {
  await enableAutomationTriggers();
});

describe("Job Creation Automations", () => {
  test("automation creates task when job is created", async ({ factories, db }) => {
    // Set up automation rule
    const template = await factories.jobTemplate();
    await factories.automation({
      jobTemplateId: template.id,
      triggerConfig: { subject: "job", event: "created" },
      actionPayload: { task_type: "Review" },
    });

    // Create job (triggers automation)
    const project = await factories.project();
    const event = mockPost({}, {
      projectId: project.id,
      jobTemplateId: template.id,
      jobType: "Test",
    });
    const result = await handler(event);

    // Wait for automation to complete
    await waitForAutomations();

    // Verify automation created the task
    const tasks = await db
      .selectFrom("task")
      .where("job_id", "=", result.job.id)
      .selectAll()
      .execute();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].task_type).toBe("Review");
  });
});
```

### Chained Automations

```typescript
test("completing task triggers follow-up automation", async ({ factories, db }) => {
  const template = await factories.jobTemplate();

  // Automation: when any task completes, create follow-up
  await factories.automation({
    jobTemplateId: template.id,
    triggerConfig: { subject: "task", event: "completed" },
    actionPayload: { task_type: "Follow-up" },
  });

  // Create job with initial task
  const project = await factories.project();
  const job = await factories.job({ projectId: project.id, jobTemplateId: template.id });
  const task = await factories.task({ jobId: job.id, status: "Active" });

  // Complete the task
  const event = mockPatch({}, {
    tasks: [{ id: task.id, status: "Completed" }],
  });
  await taskPatchHandler(event);
  await waitForAutomations();

  // Should have 2 tasks: original + follow-up
  const tasks = await db
    .selectFrom("task")
    .where("job_id", "=", job.id)
    .selectAll()
    .execute();

  expect(tasks).toHaveLength(2);
  expect(tasks.some(t => t.task_type === "Follow-up")).toBe(true);
});
```

### Testing Multiple Async Triggers

```typescript
test("bulk update triggers multiple automations", async ({ factories, db }) => {
  const template = await factories.jobTemplate();
  await factories.automation({
    jobTemplateId: template.id,
    triggerConfig: { subject: "task", event: "completed" },
    actionPayload: { task_type: "Follow-up" },
  });

  const job = await factories.job({ jobTemplateId: template.id });
  const tasks = await Promise.all([
    factories.task({ jobId: job.id, status: "Active" }),
    factories.task({ jobId: job.id, status: "Active" }),
    factories.task({ jobId: job.id, status: "Active" }),
  ]);

  // Complete all 3 tasks in one patch
  const event = mockPatch({}, {
    tasks: tasks.map(t => ({ id: t.id, status: "Completed" })),
  });
  await handler(event);
  await waitForAutomations();

  // Should have 6 tasks: 3 original + 3 follow-ups
  const allTasks = await db
    .selectFrom("task")
    .where("job_id", "=", job.id)
    .selectAll()
    .execute();

  expect(allTasks).toHaveLength(6);
  expect(allTasks.filter(t => t.task_type === "Follow-up")).toHaveLength(3);
});
```

## Testing Without Automations

Most tests don't need real automations - the stub is a no-op:

```typescript
// No beforeAll(enableAutomationTriggers) - uses stub
describe("Basic CRUD", () => {
  test("creates job without triggering automations", async ({ factories }) => {
    const project = await factories.project();
    const event = mockPost({}, { projectId: project.id, jobType: "Test" });

    const result = await handler(event);

    expect(result.job.id).toBeDefined();
    // No automations ran - triggerAutomation is a no-op
  });
});
```

## Verifying Execution Records

If your system logs automation executions:

```typescript
test("records automation execution", async ({ factories, db }) => {
  const template = await factories.jobTemplate();
  await factories.automation({
    jobTemplateId: template.id,
    triggerConfig: { subject: "job", event: "created" },
  });

  const job = await factories.job({ jobTemplateId: template.id });
  await waitForAutomations();

  const execution = await db
    .selectFrom("automation_execution")
    .where("job_id", "=", job.id)
    .selectAll()
    .executeTakeFirst();

  expect(execution?.status).toBe("completed");
  expect(execution?.affected_entities).toBeDefined();
});
```

## Key Patterns

1. **Opt-in real behavior** - Default to stubs, `enableAutomationTriggers()` for tests that need it
2. **Track all promises** - Both the trigger and the tasks it spawns
3. **Wait in a loop** - Tasks can spawn more tasks
4. **Use `Promise.allSettled`** - Don't fail fast, let all settle
5. **Verify final state** - Check database after `waitForAutomations()`
