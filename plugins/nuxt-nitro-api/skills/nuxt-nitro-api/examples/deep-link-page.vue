<script setup lang="ts">
// Deep Linking: URL params → Filter state → useFetch query
// URL: /items?search=hello&status=active&page=2

import { useRouteQuery } from "@vueuse/router";

// Get Nuxt composables (required for @vueuse/router)
const route = useRoute();
const router = useRouter();

// Each param synced with URL - pass route/router explicitly
const search = useRouteQuery("search", "", { route, router });
const status = useRouteQuery("status", "all", { route, router });
const page = useRouteQuery("page", "1", {
  route,
  router,
  transform: Number,
});

// Debounce search to avoid thrashing
const debouncedSearch = refDebounced(search, 300);

// Build query - exclude empty/default values for clean URLs
const queryParams = computed(() => ({
  ...(debouncedSearch.value ? { search: debouncedSearch.value } : {}),
  ...(status.value !== "all" ? { status: status.value } : {}),
  offset: (page.value - 1) * 20,
  limit: 20,
}));

// useFetch with reactive query - auto-refetches on change
const { data, status: fetchStatus } = await useFetch("/api/items", {
  query: queryParams,
});

// Reset pagination when filters change
watch([debouncedSearch, status], () => {
  page.value = 1;
});
</script>

<template>
  <div>
    <h1>Items</h1>

    <div class="filters">
      <input v-model="search" placeholder="Search..." />
      <select v-model="status">
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
      <input v-model.number="page" type="number" min="1" />
    </div>

    <div v-if="fetchStatus === 'pending'">Loading...</div>
    <div v-else-if="data">
      <pre>{{ data }}</pre>
    </div>
  </div>
</template>
