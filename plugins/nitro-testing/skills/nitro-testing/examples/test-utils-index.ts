/**
 * Test Utilities
 *
 * Helpers for testing Nuxt/Nitro API handlers with real PostgreSQL.
 * Auto-import mocks are set up via vitest setupFiles (see setup.ts).
 */

import { vi, test as base, expect } from "vitest";
import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { db } from "../utils/db";
import type { Transaction } from "kysely";
import type { DB } from "../db/db";

// ============================================================================
// Task Registry (for async/automation testing)
// ============================================================================

const taskHandlers: Map<string, (opts: { payload: any }) => Promise<any>> = new Map();
let pendingTasks: Promise<any>[] = [];
let currentTrx: Transaction<DB> | null = null;

// ============================================================================
// Global Stubs
// ============================================================================

export async function setupHandlerMocks() {
  vi.stubGlobal("defineEventHandler", (handler: Function) => handler);

  vi.stubGlobal("getUserSession", async () => ({
    user: { id: 1, firstName: "Test", lastName: "User", role: "admin" },
  }));

  vi.stubGlobal("setUserSession", async () => {});

  // Default: no-op for automations
  vi.stubGlobal("triggerAutomation", () => {});

  // Task registration and execution
  vi.stubGlobal("defineTask", (config: { meta: { name: string }; run: Function }) => {
    taskHandlers.set(config.meta.name, config.run as any);
    return config;
  });

  vi.stubGlobal("runTask", (taskName: string, options: { payload: any }) => {
    const handler = taskHandlers.get(taskName);
    if (!handler) {
      return Promise.reject(new Error(`Task handler not found: ${taskName}`));
    }
    const promise = handler(options);
    pendingTasks.push(promise);
    return promise;
  });

  vi.stubGlobal("useDatabase", () => {
    if (!currentTrx) {
      throw new Error("useDatabase called outside of test transaction");
    }
    return currentTrx;
  });

  // Handle nested transactions
  const KyselyModule = await import("kysely");
  const TransactionClass = (KyselyModule as any).Transaction;
  if (TransactionClass?.prototype) {
    TransactionClass.prototype.transaction = function () {
      const self = this;
      return {
        execute: async <T>(callback: (trx: any) => Promise<T>): Promise<T> => {
          return callback(self);
        },
      };
    };
  }

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

  vi.stubGlobal("getValidatedRouterParams", async (event: any, validate: Function) => {
    return validate(event.context.params ?? {});
  });

  vi.stubGlobal("getRouterParam", (event: any, param: string) => {
    return event.context.params?.[param];
  });

  vi.stubGlobal("getValidatedQuery", async (event: any, validate: Function) => {
    return validate(event.context._mockQuery ?? {});
  });

  vi.stubGlobal("getQuery", (event: any) => {
    return event.context._mockQuery ?? {};
  });

  vi.stubGlobal("readValidatedBody", async (event: any, validate: Function) => {
    return validate(event.context._mockBody ?? {});
  });

  vi.stubGlobal("readBody", async (event: any) => event.context._mockBody);
}

// ============================================================================
// Automation Testing
// ============================================================================

export async function enableAutomationTriggers() {
  await import("../tasks/execute-automation");
  const { triggerAutomation: realTrigger } = await import("../utils/automation");

  vi.stubGlobal("triggerAutomation", (...args: Parameters<typeof realTrigger>) => {
    const promise = realTrigger(...args);
    pendingTasks.push(promise);
    return promise;
  });
}

export async function waitForAutomations(): Promise<void> {
  while (pendingTasks.length > 0) {
    const tasksToWait = [...pendingTasks];
    pendingTasks = [];
    await Promise.allSettled(tasksToWait);
  }
}

// ============================================================================
// Mock Event Helpers
// ============================================================================

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

  event.context.params = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  );

  if (body !== undefined) event.context._mockBody = body;
  if (Object.keys(query).length > 0) event.context._mockQuery = query;

  return event;
}

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

// ============================================================================
// Assertion Helpers
// ============================================================================

export async function expectHttpError(
  promise: Promise<unknown>,
  expected: { statusCode: number; message?: string }
) {
  await expect(promise).rejects.toMatchObject(expected);
}

// ============================================================================
// Factories
// ============================================================================

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
      let ownerId = data.ownerId;
      if (!ownerId) {
        const owner = await this.user();
        ownerId = owner.id;
      }
      return trx
        .insertInto("project")
        .values({
          name: data.name ?? `Project ${Date.now()}`,
          owner_id: ownerId,
          status: data.status ?? "active",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async task(data: {
      projectId: number;
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

    // Add more factories as needed...
  };
}

export type Factories = ReturnType<typeof createFactories>;

// ============================================================================
// Test Fixture
// ============================================================================

interface TestFixtures {
  factories: Factories;
  db: Transaction<DB>;
}

export const test = base.extend<TestFixtures>({
  factories: async ({}, use) => {
    await db.transaction().execute(async (trx) => {
      currentTrx = trx;
      try {
        await use(createFactories(trx));
        throw { __rollback: true };
      } finally {
        currentTrx = null;
      }
    }).catch((e) => {
      if (e && typeof e === "object" && "__rollback" in e) return;
      throw e;
    });
  },

  db: async ({ factories: _ }, use) => {
    if (!currentTrx) {
      throw new Error("db fixture used outside transaction context");
    }
    await use(currentTrx);
  },
});

export { describe, expect, beforeAll } from "vitest";
