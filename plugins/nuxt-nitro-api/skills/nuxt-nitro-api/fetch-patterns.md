# Fetch Patterns

## The Three Methods

| Method | SSR | When to Use |
|--------|-----|-------------|
| `useFetch` | Yes | Default for page data loading |
| `$fetch` | No | Event handlers (onClick, onSubmit) |
| `useAsyncData` + `$fetch` | Yes | Custom cache keys, combining fetches |

## useFetch (Default Choice)

```typescript
// Basic - types inferred from Nitro
const { data, status, refresh, error } = await useFetch("/api/users");

// With reactive query params - auto-refetches on change
const search = ref("");
const page = ref(1);
const { data } = await useFetch("/api/users", {
  query: { search, page },  // Reactive refs
});

// Computed query for conditional params
const queryParams = computed(() => ({
  ...(search.value ? { search: search.value } : {}),
  offset: page.value * 20,
}));
const { data } = await useFetch("/api/users", {
  query: queryParams,
});

// Dynamic URL with getter function
const userId = ref("123");
const { data } = await useFetch(() => `/api/users/${userId.value}`);

// Transform response before caching
const { data } = await useFetch("/api/users", {
  transform: (response) => response.users.map(u => u.name),
});

// Reduce SSR payload size
const { data } = await useFetch("/api/users", {
  pick: ["id", "name"],  // Only these fields
});
```

### New Options (Nuxt 3.14+)

```typescript
const { data } = await useFetch("/api/data", {
  // Retry on failure
  retry: 3,
  retryDelay: 1000,

  // Request deduplication
  dedupe: "cancel",   // Cancel previous (default)
  // dedupe: "defer",  // Wait for existing

  // Built-in debounce
  delay: 300,  // Wait before making request
});
```

## Debounced Search Pattern

```typescript
const search = ref("");
const debouncedSearch = refDebounced(search, 300);  // Auto-imported

const { data } = await useFetch("/api/search", {
  query: computed(() => ({
    ...(debouncedSearch.value ? { q: debouncedSearch.value } : {}),
  })),
});

// Reset pagination when filters change
watch([debouncedSearch, categoryFilter], () => {
  page.value = 0;
});
```

## useAsyncData + $fetch

Use when you need:
1. Custom cache key
2. Combine multiple fetches
3. Non-HTTP async operations

```typescript
// Custom cache key
const { data } = await useAsyncData("my-key", () =>
  $fetch("/api/users")
);

// Combining fetches
const { data } = await useAsyncData("combined", async () => {
  const [users, roles] = await Promise.all([
    $fetch("/api/users"),
    $fetch("/api/roles"),
  ]);
  return { users, roles };
});
```

## $fetch (Client-Only)

Only use in event handlers - never at component top level:

```typescript
const handleSubmit = async () => {
  const result = await $fetch("/api/users", {
    method: "POST",
    body: { name: "Test" },
  });
};

const handleDelete = async (id: number) => {
  await $fetch(`/api/users/${id}`, { method: "DELETE" });
  refresh();  // Refresh useFetch data
};
```

## Type Inference

Template literals preserve type inference (fixed late 2024):

```typescript
const userId = "123";  // Type is "123" (literal)
const result = await $fetch(`/api/users/${userId}`);
// result typed from handler return type

// Generic string loses precision
const userId: string = "123";  // Type is string
const result = await $fetch(`/api/users/${userId}`);
// result is union of all matching routes
```

**Never add manual types:**
```typescript
// WRONG - defeats inference
const result = await $fetch<User>("/api/users/123");

// RIGHT - let Nitro infer
const result = await $fetch("/api/users/123");
```

## Common Mistakes

1. **Using `$fetch` in `onMounted`** - Use `useFetch` instead
2. **Manual watchers for refetch** - Query refs are auto-watched
3. **Adding type params** - Types are inferred from Nitro
4. **Using `watch` option for dynamic URLs** - Use getter function
5. **Passing null/undefined in query** - Filter them out first
