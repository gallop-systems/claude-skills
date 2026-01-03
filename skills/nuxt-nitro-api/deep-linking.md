# Deep Linking (URL Params Sync)

> **Example:** [deep-link-page.vue](./examples/deep-link-page.vue)

Make filters bookmarkable/shareable by syncing them with URL query params.

## Pattern 1: `useRouteQuery` (Recommended)

From `@vueuse/router` (install: `npm install @vueuse/router`):

> **Important:** Pass Nuxt's route/router composables explicitly.

```typescript
import { useRouteQuery } from "@vueuse/router";

// Get Nuxt composables
const route = useRoute();
const router = useRouter();

// Each filter synced with URL
const search = useRouteQuery("search", "", { route, router });
const status = useRouteQuery("status", "all", { route, router });
const page = useRouteQuery("page", "1", {
  route, router,
  transform: Number,  // Parse as number
});

// Debounce search to avoid URL thrashing
const debouncedSearch = refDebounced(search, 300);

// Build query for useFetch - exclude empty/default values
const queryParams = computed(() => ({
  ...(debouncedSearch.value ? { search: debouncedSearch.value } : {}),
  ...(status.value !== "all" ? { status: status.value } : {}),
  offset: (page.value - 1) * 20,
  limit: 20,
}));

// Auto-refetches when params change
const { data, status: fetchStatus } = await useFetch("/api/items", {
  query: queryParams,
});

// Reset pagination when filters change
watch([debouncedSearch, status], () => {
  page.value = 1;
});
```

**Result:** URL like `/items?search=hello&status=active&page=2` loads with filters pre-applied.

## Pattern 2: Manual with useRoute/useRouter

For more control:

```typescript
const route = useRoute();
const router = useRouter();

// Initialize from URL (works during SSR)
const search = ref((route.query.search as string) || "");
const category = ref((route.query.category as string) || "");

// Debounced URL update
const updateUrl = useDebounceFn(() => {
  router.push({
    query: {
      ...route.query,  // Preserve other params
      ...(search.value ? { search: search.value } : {}),
      ...(category.value ? { category: category.value } : {}),
    },
  });
}, 300);

watch([search, category], updateUrl);

// useFetch with same refs
const { data } = await useFetch("/api/items", {
  query: computed(() => ({
    ...(search.value ? { search: search.value } : {}),
    ...(category.value ? { category: category.value } : {}),
  })),
});
```

## Pattern 3: `useUrlSearchParams` (Low-Level)

Direct URL manipulation via VueUse:

```typescript
const urlParams = useUrlSearchParams("history");

// Read
const search = urlParams["search"] as string || "";

// Write
urlParams["search"] = "new value";

// Delete (must use delete, not null)
delete urlParams["search"];
```

**Best for:** Complex serialization, arrays, nested objects.

## Array Values in URL

For multi-select filters:

```typescript
// Serialize array to comma-separated
const selectedStatuses = useRouteQuery("status", "", {
  route, router,
  transform: (val) => val ? val.split(",") : [],
});

// Manual approach
const statuses = ref<string[]>([]);
watch(statuses, (val) => {
  urlParams["status"] = val.length ? val.join(",") : undefined;
});
```

## Complete Example

```typescript
import { useRouteQuery } from "@vueuse/router";

const route = useRoute();
const router = useRouter();

// All filters bound to URL
const search = useRouteQuery("q", "", { route, router });
const status = useRouteQuery("status", "all", { route, router });
const sortBy = useRouteQuery("sort", "created_at", { route, router });
const sortOrder = useRouteQuery("order", "desc", { route, router });
const page = useRouteQuery("page", "1", { route, router, transform: Number });
const perPage = useRouteQuery("limit", "20", { route, router, transform: Number });

// Debounce search
const debouncedSearch = refDebounced(search, 300);

// Query params for API
const queryParams = computed(() => ({
  ...(debouncedSearch.value ? { search: debouncedSearch.value } : {}),
  ...(status.value !== "all" ? { status: status.value } : {}),
  sort_by: sortBy.value,
  sort_order: sortOrder.value,
  offset: (page.value - 1) * perPage.value,
  limit: perPage.value,
}));

// Fetch with reactive params
const { data, refresh } = await useFetch("/api/items", {
  query: queryParams,
});

// Reset pagination on filter change
watch([debouncedSearch, status, sortBy, sortOrder], () => {
  page.value = 1;
});

// Pagination helpers
const totalPages = computed(() =>
  Math.ceil((data.value?.total || 0) / perPage.value)
);
```

## SSR Considerations

1. **`useRouteQuery` is SSR-safe** - reads from route during SSR
2. **`useRoute()` works during SSR** - can initialize from URL
3. **`useUrlSearchParams` is client-only** - guard with `import.meta.client`
4. **`router.push()` works during SSR** - but avoid at top-level setup

## Which Pattern?

| Pattern | Best For | SSR-Safe |
|---------|----------|----------|
| `useRouteQuery` | Most cases - bidirectional sync | Yes |
| `useRoute` + `router.push` | Custom serialization | Yes |
| `useUrlSearchParams` | Direct param manipulation | No |

## Key Gotchas

1. **Debounce search inputs** - otherwise URL updates every keystroke
2. **Reset pagination on filter change** - avoid empty page 5
3. **Exclude default values** - cleaner URLs
4. **Use `transform` for numbers** - URL params are strings
5. **Arrays need serialization** - comma-separated or custom
6. **Pass Nuxt composables** - VueUse router utils need route/router
