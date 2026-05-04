# Frontend Testing with @nuxt/test-utils

Comprehensive guide to testing Vue components, pages, and utilities in Nuxt 3 applications.

## Dependencies

```bash
yarn add -D @nuxt/test-utils @vue/test-utils happy-dom vitest @vitest/coverage-v8
```

| Package | Purpose |
|---------|---------|
| `@nuxt/test-utils` | Nuxt-aware testing utilities (`mountSuspended`, `mockNuxtImport`, `registerEndpoint`) |
| `@vue/test-utils` | Vue component testing (wrapper API) |
| `happy-dom` | Lightweight DOM implementation |
| `vitest` | Test runner |

## Vitest Configuration

Separate frontend and backend tests using an environment variable:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { defineVitestConfig } from "@nuxt/test-utils/config";
import path from "path";

const isNuxtEnv = process.env.VITEST_ENV === "nuxt";

export default isNuxtEnv
  ? defineVitestConfig({
      test: {
        environment: "nuxt",
        globals: true,
        include: [
          "components/**/*.test.ts",
          "pages/**/*.test.ts",
          "utils/**/*.test.ts",
        ],
      },
    })
  : defineConfig({
      test: {
        globals: true,
        environment: "node",
        include: ["server/**/*.test.ts"],
        globalSetup: ["./server/test-utils/global-setup.ts"],
        setupFiles: ["./server/test-utils/setup.ts"],
        coverage: {
          provider: "v8",
          reporter: ["text", "json", "html"],
        },
      },
      resolve: {
        alias: {
          "~": path.resolve(__dirname),
        },
      },
    });
```

## Nuxt Test Configuration

Create a minimal Nuxt config for testing:

```typescript
// nuxt.config.test.ts
export default defineNuxtConfig({
  modules: [
    "@primevue/nuxt-module", // Include UI libraries your components need
  ],
  ssr: false, // Simplifies component testing
});
```

## Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:frontend": "VITEST_ENV=nuxt vitest",
    "test:frontend:run": "VITEST_ENV=nuxt vitest run"
  }
}
```

## Core Testing Patterns

### Basic Component Test

```typescript
import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ProjectCard from "./ProjectCard.vue";

describe("ProjectCard", () => {
  it("renders project information", async () => {
    const wrapper = await mountSuspended(ProjectCard, {
      props: {
        project: {
          id: 1,
          name: "Website Redesign",
          status: "active",
          start_date: "2025-01-15",
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain("Website Redesign");
    expect(wrapper.text()).toContain("active");
  });

  it("applies correct CSS class for status", async () => {
    const wrapper = await mountSuspended(ProjectCard, {
      props: {
        project: { id: 1, name: "Test", status: "completed" },
      },
    });

    expect(wrapper.html()).toMatch(/completed/);
  });
});
```

### Testing with Mocked Composables

Mock composables **before** mounting:

```typescript
import { describe, it, expect } from "vitest";
import { mountSuspended, mockNuxtImport } from "@nuxt/test-utils/runtime";
import AddressDisplay from "./AddressDisplay.vue";

// Mock must be defined before any mountSuspended calls
mockNuxtImport("useAddress", () => {
  return () => ({
    getDisplayAddress: (project: any) => {
      return project.address || project.address_details?.formatted_address || "No address";
    },
    formatAddress: (address: any) => `${address.city}, ${address.state}`,
  });
});

mockNuxtImport("useUserSession", () => {
  return () => ({
    user: { id: 1, name: "Test User", email: "test@example.com" },
    loggedIn: true,
  });
});

describe("AddressDisplay", () => {
  it("shows formatted address", async () => {
    const wrapper = await mountSuspended(AddressDisplay, {
      props: {
        project: { address: "123 Main St, New York, NY" },
      },
    });

    expect(wrapper.text()).toContain("123 Main St");
  });
});
```

### Testing with Mocked API Endpoints

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import ProjectsList from "./ProjectsList.vue";

describe("ProjectsList", () => {
  beforeEach(() => {
    // Register endpoints before each test
    registerEndpoint("/api/projects", {
      method: "GET",
      handler: () => [
        { id: 1, name: "Project Alpha", status: "active" },
        { id: 2, name: "Project Beta", status: "completed" },
        { id: 3, name: "Project Gamma", status: "active" },
      ],
    });
  });

  it("renders list of projects", async () => {
    const wrapper = await mountSuspended(ProjectsList);

    expect(wrapper.text()).toContain("Project Alpha");
    expect(wrapper.text()).toContain("Project Beta");
    expect(wrapper.text()).toContain("Project Gamma");
  });

  it("filters active projects", async () => {
    registerEndpoint("/api/projects", {
      method: "GET",
      handler: (event) => {
        const status = new URL(event.node.req.url!, "http://localhost").searchParams.get("status");
        const projects = [
          { id: 1, name: "Project Alpha", status: "active" },
          { id: 2, name: "Project Beta", status: "completed" },
        ];
        return status ? projects.filter((p) => p.status === status) : projects;
      },
    });

    const wrapper = await mountSuspended(ProjectsList, {
      props: { filterStatus: "active" },
    });

    expect(wrapper.text()).toContain("Project Alpha");
    expect(wrapper.text()).not.toContain("Project Beta");
  });
});
```

### Testing Pages with Route Parameters

```typescript
import { describe, it, expect } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import TaskDetailPage from "./[id].vue";

describe("Task Detail Page", () => {
  it("loads and displays task details", async () => {
    registerEndpoint("/api/tasks/456", {
      method: "GET",
      handler: () => ({
        id: 456,
        name: "Implement feature X",
        status: "in_progress",
        description: "Detailed description here",
        assignee: { id: 1, name: "John Doe" },
      }),
    });

    const wrapper = await mountSuspended(TaskDetailPage, {
      route: {
        params: { id: "456" },
      },
    });

    expect(wrapper.text()).toContain("Implement feature X");
    expect(wrapper.text()).toContain("in_progress");
  });

  it("handles missing task", async () => {
    registerEndpoint("/api/tasks/999", {
      method: "GET",
      handler: () => {
        throw createError({ statusCode: 404, message: "Task not found" });
      },
    });

    const wrapper = await mountSuspended(TaskDetailPage, {
      route: {
        params: { id: "999" },
      },
    });

    expect(wrapper.text()).toContain("not found");
  });
});
```

### Testing with UI Libraries (PrimeVue)

Stub complex components and register required services:

```typescript
import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import ProjectForm from "./ProjectForm.vue";

describe("ProjectForm", () => {
  it("renders form fields", async () => {
    const wrapper = await mountSuspended(ProjectForm, {
      props: {
        project: { id: 1, name: "", status: "draft" },
      },
      global: {
        plugins: [ToastService, ConfirmationService],
        stubs: {
          // Stub complex PrimeVue components
          DataTable: true,
          Column: true,
          Dialog: true,
          Calendar: true,
          Dropdown: true,
          // Keep simple components
          InputText: false,
          Button: false,
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });
});
```

### Testing User Interactions

```typescript
import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import Counter from "./Counter.vue";

describe("Counter", () => {
  it("increments count on button click", async () => {
    const wrapper = await mountSuspended(Counter);

    expect(wrapper.text()).toContain("Count: 0");

    await wrapper.find("button.increment").trigger("click");
    await nextTick();

    expect(wrapper.text()).toContain("Count: 1");
  });

  it("emits event on submit", async () => {
    const wrapper = await mountSuspended(Counter);

    await wrapper.find("button.submit").trigger("click");

    expect(wrapper.emitted("submit")).toBeTruthy();
    expect(wrapper.emitted("submit")![0]).toEqual([{ count: 0 }]);
  });
});
```

### Testing Utility Functions

Pure utilities don't need Nuxt context:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { formatDate, parseDate, isValidDate } from "./dates";

describe("date utilities", () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  describe("formatDate", () => {
    it("formats ISO date string", () => {
      expect(formatDate("2025-01-15")).toBe("Jan 15, 2025");
    });

    it("handles different timezones correctly", () => {
      // Test that date-only strings don't shift across timezone boundaries
      process.env.TZ = "America/New_York";
      expect(formatDate("2025-01-15")).toBe("Jan 15, 2025");

      process.env.TZ = "America/Los_Angeles";
      expect(formatDate("2025-01-15")).toBe("Jan 15, 2025");

      process.env.TZ = "Europe/London";
      expect(formatDate("2025-01-15")).toBe("Jan 15, 2025");
    });

    it("returns empty string for null/undefined", () => {
      expect(formatDate(null)).toBe("");
      expect(formatDate(undefined)).toBe("");
    });
  });

  describe("isValidDate", () => {
    it("validates correct dates", () => {
      expect(isValidDate("2025-01-15")).toBe(true);
      expect(isValidDate("2025-12-31")).toBe(true);
    });

    it("rejects invalid dates", () => {
      expect(isValidDate("not-a-date")).toBe(false);
      expect(isValidDate("2025-13-01")).toBe(false);
    });
  });
});
```

## Wrapper API Reference

Common methods on the wrapper returned by `mountSuspended`:

| Method | Description |
|--------|-------------|
| `wrapper.text()` | All text content (rendered) |
| `wrapper.html()` | Full HTML output |
| `wrapper.exists()` | Check if component mounted |
| `wrapper.props()` | Get all props |
| `wrapper.props('name')` | Get specific prop |
| `wrapper.emitted()` | All emitted events |
| `wrapper.emitted('click')` | Specific event emissions |
| `wrapper.find(selector)` | Find single element |
| `wrapper.findAll(selector)` | Find all matching elements |
| `wrapper.trigger('click')` | Trigger DOM event |
| `wrapper.setValue(value)` | Set input value |

## Common Gotchas

### 1. Always Use `mountSuspended`

```typescript
// WRONG - doesn't handle async setup or Nuxt context
import { mount } from "@vue/test-utils";
const wrapper = mount(MyComponent);

// RIGHT - handles Suspense, async setup, and Nuxt context
import { mountSuspended } from "@nuxt/test-utils/runtime";
const wrapper = await mountSuspended(MyComponent);
```

### 2. Mock Before Mount

```typescript
// WRONG - mock after mount has no effect
const wrapper = await mountSuspended(MyComponent);
mockNuxtImport("useAuth", () => () => ({ user: null }));

// RIGHT - mock before mount
mockNuxtImport("useAuth", () => () => ({ user: null }));
const wrapper = await mountSuspended(MyComponent);
```

### 3. Register Endpoints Before Mount

```typescript
// WRONG - component fetches before endpoint exists
const wrapper = await mountSuspended(DataComponent);
registerEndpoint("/api/data", { handler: () => [] });

// RIGHT - endpoint ready before component mounts
registerEndpoint("/api/data", { handler: () => [] });
const wrapper = await mountSuspended(DataComponent);
```

### 4. Await All Async Operations

```typescript
// WRONG - assertion runs before DOM updates
wrapper.find("button").trigger("click");
expect(wrapper.text()).toContain("Updated");

// RIGHT - wait for Vue to process updates
await wrapper.find("button").trigger("click");
await nextTick();
expect(wrapper.text()).toContain("Updated");
```

### 5. Use `wrapper.text()` Over Specific Selectors

```typescript
// FRAGILE - breaks if component structure changes
expect(wrapper.find(".project-name span").text()).toBe("My Project");

// ROBUST - checks rendered output regardless of structure
expect(wrapper.text()).toContain("My Project");
```

### 6. Date Testing Across Timezones

When testing date formatting, test multiple timezones to catch off-by-one-day bugs:

```typescript
const timezones = ["America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Tokyo"];

for (const tz of timezones) {
  it(`formats date correctly in ${tz}`, () => {
    process.env.TZ = tz;
    // Date string "2025-01-15" should always display as Jan 15
    // regardless of timezone
    expect(formatDate("2025-01-15")).toBe("Jan 15, 2025");
  });
}
```

## File Organization

Co-locate tests with source files:

```
components/
  projects/
    ProjectCard.vue
    ProjectCard.test.ts      # Component test
    ProjectsList.vue
    ProjectsList.test.ts
pages/
  projects/
    index.vue
    index.test.ts            # Page test
    [id].vue
    [id].test.ts
utils/
  dates.ts
  dates.test.ts              # Utility test
  formatting.ts
  formatting.test.ts
```

Benefits:
- Easy to find tests for any file
- Tests move with components during refactoring
- Clear coverage visibility
