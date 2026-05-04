# Composables vs Utils

## Quick Decision Tree

```
Needs Nuxt/Vue context (useRuntimeConfig, useRoute, refs, toast)?
├─ YES → COMPOSABLE in /composables/use*.ts
│
└─ NO
   └─ Server-side logic (DB, file system, auth)?
      ├─ YES → SERVER UTILS in /server/utils/
      │
      └─ NO (Pure data transformation)
         └─ CLIENT UTILS in /utils/
```

## Composables (`/composables/use*.ts`)

**When to use:**
- Accesses Nuxt/Vue context: `useRuntimeConfig()`, `useRoute()`, `navigateTo()`
- Uses Vue reactivity: `ref()`, `computed()`, `watch()` (optional!)
- Accesses global services: `useToast()`, `useUserSession()`
- Named with `use` prefix (required for auto-import)

> **Note:** A composable does NOT need reactivity. If it accesses any Nuxt composable, it's a composable.

```typescript
// composables/useFormState.ts
export const useFormState = (initialData: FormData) => {
  const data = ref(initialData);
  const isDirty = computed(() =>
    JSON.stringify(data.value) !== JSON.stringify(initialData)
  );
  const errors = ref<Record<string, string>>({});
  const toast = useToast();

  watch(data, (newValue) => {
    const result = schema.safeParse(newValue);
    errors.value = result.success ? {} : formatErrors(result.error);
  }, { deep: true });

  const save = async () => {
    try {
      await $fetch("/api/save", { method: "POST", body: data.value });
      toast.add({ severity: "success", summary: "Saved!" });
    } catch (e) {
      toast.add({ severity: "error", summary: "Failed" });
    }
  };

  return { data, isDirty, errors, save };
};
```

```typescript
// composables/usePermissions.ts
export const usePermissions = () => {
  const { user } = useUserSession();

  const hasRole = (role: string) => user.value?.role === role;
  const isAdmin = () => hasRole("admin") || hasRole("superadmin");

  const can = (action: string, resource: string) => {
    if (!user.value) return false;
    if (isAdmin()) return true;
    // User-specific permissions
    return false;
  };

  return { hasRole, isAdmin, can };
};
```

## Client Utils (`/utils/*.ts`)

**When to use:**
- Pure functions, no side effects
- No Vue/Nuxt dependencies
- Data transformations, formatting, parsing
- NO `use` prefix

```typescript
// utils/formatting.ts
export const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
};

export const generateColor = (id: number) => {
  const colors = ["#3B82F6", "#EF4444", "#10B981"];
  return colors[id % colors.length];
};
```

## Server Utils (`/server/utils/*.ts`)

**When to use:**
- Server-side only logic
- Database access
- Authentication helpers
- External APIs, file system
- Auto-imported in `/server` directory

```typescript
// server/utils/db.ts
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = new Kysely({ dialect: new PostgresDialect({ pool }) });

export function useDatabase() {
  return db;
}
```

```typescript
// server/utils/auth.ts
export async function getAuthenticatedUser(event: H3Event) {
  const session = await getUserSession(event);
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return session.user;
}
```

## Shared Utils (`/shared/utils/` - Nuxt 3.14+)

**When to use:**
- Code used on BOTH client and server
- Types, constants, pure functions
- NO browser APIs, NO server-only code

```typescript
// shared/utils/format.ts
export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

// Can be used in both:
// - /server/api/invoice.get.ts
// - /pages/invoice.vue
```

## Summary Table

| Location | Naming | Vue APIs | Auto-imported | Use Case |
|----------|--------|----------|---------------|----------|
| `/composables/` | `use*` | Yes | Yes (client) | Reactive state, global services |
| `/utils/` | Any | No | Yes (client) | Pure functions, formatting |
| `/server/utils/` | Any | No | Yes (server) | DB, auth, server logic |
| `/shared/utils/` | Any | No | Yes (both) | Isomorphic utilities |

## Key Gotchas

1. **Composables must start with `use`** - Required for auto-import
2. **Don't use Vue APIs in utils** - Keeps them testable and portable
3. **Server utils can't use Vue** - Different runtime
4. **Auto-import scoping** - `/utils` is client-only, `/server/utils` is server-only
5. **Composables call order matters** - Call at top of `<script setup>`, not in callbacks
