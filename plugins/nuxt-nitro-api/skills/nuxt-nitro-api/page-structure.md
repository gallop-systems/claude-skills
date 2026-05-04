# Page Structure

Pages should be thin. Keep logic in components, use pages only for layout and routing.

## The Pattern

```vue
<!-- pages/users/[id].vue -->
<script setup lang="ts">
// 1. Parse route params
const route = useRoute();
const userId = computed(() => route.params.id as string);

// 2. Maybe check auth/permissions
const { user } = useUserSession();
</script>

<template>
  <!-- 3. Layout + components only -->
  <div class="page-container">
    <PageHeader title="User Profile" />

    <!-- Pass parsed params to components -->
    <UserProfile :user-id="userId" />

    <UserActivity :user-id="userId" v-if="user?.role === 'admin'" />
  </div>
</template>
```

## What Goes Where

| In Page | In Component |
|---------|--------------|
| Route param parsing | Data fetching (useFetch) |
| Layout structure | Business logic |
| Component composition | Form handling |
| Auth guards (via middleware) | State management |
| Page meta (title, middleware) | Event handlers |

## Pages Do

```vue
<script setup lang="ts">
// ✅ Route params
const route = useRoute();
const id = computed(() => route.params.id as string);

// ✅ Query params (for passing to components)
const tab = computed(() => (route.query.tab as string) || 'overview');

// ✅ Page metadata
definePageMeta({
  middleware: 'auth',
  layout: 'dashboard',
});

// ✅ Page title
useHead({ title: 'User Profile' });
</script>

<template>
  <!-- ✅ Layout wrapper -->
  <NuxtLayout>
    <!-- ✅ Component composition -->
    <UserHeader :id="id" />
    <UserTabs :active-tab="tab" :user-id="id" />
  </NuxtLayout>
</template>
```

## Pages Don't

```vue
<script setup lang="ts">
// ❌ Data fetching - move to component
const { data: user } = await useFetch(`/api/users/${route.params.id}`);

// ❌ Complex computed - move to component
const fullName = computed(() => `${user.value?.firstName} ${user.value?.lastName}`);

// ❌ Event handlers - move to component
const handleSave = async () => {
  await $fetch(`/api/users/${route.params.id}`, { method: 'PATCH', body: form });
};

// ❌ Form state - move to component
const form = reactive({ name: '', email: '' });

// ❌ Watchers - move to component
watch(user, (newUser) => {
  form.name = newUser?.name || '';
});
</script>

<template>
  <!-- ❌ Too much logic in template -->
  <form @submit.prevent="handleSave">
    <input v-model="form.name" />
    <input v-model="form.email" />
    <button type="submit">Save</button>
  </form>
</template>
```

## Component Does the Work

```vue
<!-- components/UserProfile.vue -->
<script setup lang="ts">
const props = defineProps<{
  userId: string;
}>();

// ✅ Data fetching in component
const { data: user, refresh } = await useFetch(() => `/api/users/${props.userId}`);

// ✅ Form state
const form = reactive({ name: '', email: '' });

// ✅ Sync form with data
watch(user, (newUser) => {
  if (newUser) {
    form.name = newUser.name;
    form.email = newUser.email;
  }
}, { immediate: true });

// ✅ Event handlers
const handleSave = async () => {
  await $fetch(`/api/users/${props.userId}`, {
    method: 'PATCH',
    body: form,
  });
  refresh();
};
</script>

<template>
  <form @submit.prevent="handleSave">
    <input v-model="form.name" placeholder="Name" />
    <input v-model="form.email" placeholder="Email" />
    <button type="submit">Save</button>
  </form>
</template>
```

## Benefits

1. **Reusability** - Components can be used in multiple pages
2. **Testability** - Components are easier to test in isolation
3. **Readability** - Pages show structure at a glance
4. **Maintainability** - Changes to logic don't affect page layout
5. **Code splitting** - Nuxt can better optimize component loading

## Key Gotchas

1. **Don't fetch in pages** - Let components own their data
2. **Props down, events up** - Pass params as props, emit events for actions
3. **Pages are entry points** - Think of them as "controllers" that compose "views"
4. **Middleware for auth** - Use `definePageMeta({ middleware: 'auth' })`, not inline checks
5. **Layouts for shared UI** - Headers, footers, sidebars go in `/layouts`, not repeated in pages
