# SSR + Client-side Patterns

## The Problem

`localStorage` and other browser APIs don't exist on the server. Accessing them during SSR causes errors or hydration mismatches.

## Solutions

### 1. `<ClientOnly>` Component

Wrap components that need browser APIs:

```vue
<ClientOnly>
  <DataTable :value="items" />

  <template #fallback>
    <div>Loading table...</div>
  </template>
</ClientOnly>
```

**Use for:**
- Complex interactive components (DataTables, Maps, Charts)
- Components using DOM APIs
- Third-party components without SSR support

### 2. `import.meta.client` Guard

Check runtime environment before using browser APIs:

```typescript
watch(viewMode, (newMode) => {
  if (import.meta.client) {
    localStorage.setItem("view-mode", newMode);
  }
});

const savePreference = (key: string, value: string) => {
  if (import.meta.client) {
    localStorage.setItem(key, value);
  }
};
```

Also available: `import.meta.server` for server-only code.

### 3. `onMounted` for Client Initialization

Read from localStorage only after hydration:

```typescript
const viewMode = ref("table");  // Default for SSR
const isReady = ref(false);

onMounted(() => {
  const saved = localStorage.getItem("view-mode");
  if (saved === "table" || saved === "kanban") {
    viewMode.value = saved;
  }
  isReady.value = true;
});
```

**Pattern for URL params + localStorage fallback:**
```typescript
onMounted(() => {
  const queryTab = route.query.tab as string;

  if (queryTab && validTabs.includes(queryTab)) {
    activeTab.value = queryTab;
  } else {
    const savedTab = localStorage.getItem("last-tab");
    if (savedTab && validTabs.includes(savedTab)) {
      activeTab.value = savedTab;
      router.replace({ query: { tab: savedTab } });
    }
  }
});
```

### 4. VueUse `useLocalStorage` (SSR-Safe)

Automatically handles SSR - reads on client after hydration:

```typescript
// Returns default during SSR, actual value on client
const theme = useLocalStorage("theme", "light");
const settings = useLocalStorage("settings", { compact: false });

// Use normally - syncs automatically
theme.value = "dark";
```

For delayed initialization to avoid hydration issues:
```typescript
const theme = useLocalStorage("theme", "light", {
  initOnMounted: true,  // Don't read until mounted
});
```

## VueUse SSR Notes

With `@vueuse/nuxt`, these are auto-imported:
- `refDebounced` - Yes, auto-imported
- `useDebounceFn` - Yes
- `useLocalStorage` - Yes
- `useUrlSearchParams` - Yes

**Disabled by default** (conflict with Nuxt):
- `useRoute` - use Nuxt's version
- `useRouter` - use Nuxt's version
- `useFetch` - use Nuxt's version
- `useHead` - use Nuxt's version

## Hydration Mismatch Prevention

**Problem:** Server renders with default, client reads different value = mismatch.

**Solutions:**

1. **Don't render during SSR:**
```vue
<ClientOnly>
  <span>{{ preference }}</span>
</ClientOnly>
```

2. **Use a ready flag:**
```typescript
const preference = ref("default");
const ready = ref(false);

onMounted(() => {
  preference.value = localStorage.getItem("pref") || "default";
  ready.value = true;
});
```
```vue
<span v-if="ready">{{ preference }}</span>
<span v-else>Loading...</span>
```

3. **Use `useLocalStorage` with matching initial:**
```typescript
const count = useLocalStorage("count", 0);
// Initial matches SSR, updates after hydration
```

## Summary Table

| Approach | When to Use | SSR-Safe |
|----------|-------------|----------|
| `<ClientOnly>` | Entire component needs browser | Yes |
| `import.meta.client` | Conditional browser API calls | Yes |
| `onMounted` | Initialize from localStorage | Yes |
| `useLocalStorage` | Reactive persistent state | Yes |
| Direct `localStorage` | Never at top level | No |

## Key Gotchas

1. **Never access `localStorage` at module top-level**
2. **`useLocalStorage` returns default during SSR**
3. **URL query params are SSR-safe** - can read via `useRoute()`
4. **Watch handlers run during SSR** - always guard with `import.meta.client`
5. **`onMounted` never runs on server** - safe for all browser APIs
