# Formatters (Currency, Dates, Numbers)

## Rule: Never define a formatter inline

Whenever you need to format a value — currency, dates, times, numbers, percentages,
file sizes, relative time, etc. — **do not define the formatter inline at the call site.**

Before writing any new formatting logic:

1. **Check if a shared formatter already exists.** Look for a `useFormatters`
   composable (`/composables/useFormatters.ts`) or a formatting util
   (`/utils/formatters.ts`, `/shared/utils/format.ts`). If a formatter for the value
   you need is already there, **use it.**
2. **If none exists, create one** in the appropriate shared location, then use it.
   Do not scatter a one-off `Intl.NumberFormat(...)` or `new Date(...).toLocaleString(...)`
   at the call site.

This keeps formatting consistent across the app (one source of truth for locale,
currency, date style) and makes a future change — switching locale, adding a currency,
tweaking date format — a single edit instead of a hunt-and-replace.

```typescript
// WRONG - inline formatter at the call site
<template>
  <span>{{ new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total) }}</span>
  <span>{{ new Date(order.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" }) }}</span>
</template>

// RIGHT - use the shared formatter
<script setup lang="ts">
const { formatCurrency, formatDate } = useFormatters();
</script>
<template>
  <span>{{ formatCurrency(total) }}</span>
  <span>{{ formatDate(order.createdAt) }}</span>
</template>
```

## Reach for existing libraries before hand-rolling

Two libraries are almost always already available — prefer them over writing formatting
or date logic by hand:

- **VueUse** ships a broad set of formatting/reactive helpers out of the box (auto-imported
  in Nuxt). Before building your own, check for one of these:
  - `useDateFormat(date, "YYYY-MM-DD HH:mm")` — reactive date formatting
  - `useTimeAgo(date)` — reactive "3 minutes ago" relative time
  - `useNow()` / `useTimestamp()` — reactive current time to drive the above
  - `formatTimeAgo()` — the non-reactive function form
  Wrap these in `useFormatters` when you want a single app-wide configuration point,
  rather than calling them ad hoc at each site.

- **date-fns is the preferred way to work with dates.** Do **not** parse, compare, add,
  or diff dates by hand (no manual `string.split("-")`, no `new Date(a) - new Date(b)`
  arithmetic, no hand-rolled "is same day"). Use `date-fns`:

  ```typescript
  import { format, parseISO, formatDistanceToNow, differenceInDays, isSameDay } from "date-fns";

  format(parseISO(order.createdAt), "MMM d, yyyy");   // "Jun 12, 2026"
  formatDistanceToNow(parseISO(order.createdAt));      // "about 2 hours"
  differenceInDays(parseISO(end), parseISO(start));    // 5
  ```

  ```typescript
  // WRONG - parsing/diffing dates by hand
  const [y, m, d] = order.createdAt.split("T")[0].split("-");
  const daysLeft = Math.floor((new Date(end) - new Date(start)) / 86400000);
  ```

  Still route date-fns calls through `useFormatters` (or a shared util) rather than
  importing and calling them inline everywhere — same single-source-of-truth reason.

## Where to put the formatters

Pick the location by what the formatter needs (see [composables-utils.md](./composables-utils.md)):

- **Needs Nuxt/Vue context** (e.g. reads locale/currency from `useRuntimeConfig()`,
  `useI18n()`, or user preferences) → **composable** `useFormatters` in
  `/composables/useFormatters.ts`.
- **Pure, client-only** → **util** in `/utils/formatters.ts`.
- **Used on both client and server** (e.g. an invoice rendered in SSR *and* in a
  server API response) → **shared util** in `/shared/utils/format.ts`.

When in doubt and the formatters are pure, prefer `useFormatters` as a composable so
there is one obvious, discoverable place to look — and so it can later pull locale
from context without moving every call site.

### Composable form (`useFormatters`)

```typescript
// composables/useFormatters.ts
export const useFormatters = () => {
  const config = useRuntimeConfig();
  const locale = config.public.locale ?? "en-US";
  const currency = config.public.currency ?? "USD";

  const currencyFmt = new Intl.NumberFormat(locale, { style: "currency", currency });
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const numberFmt = new Intl.NumberFormat(locale);
  const percentFmt = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });

  return {
    formatCurrency: (amount: number) => currencyFmt.format(amount),
    formatDate: (date: string | Date) => dateFmt.format(new Date(date)),
    formatDateTime: (date: string | Date) => dateTimeFmt.format(new Date(date)),
    formatNumber: (n: number) => numberFmt.format(n),
    formatPercent: (n: number) => percentFmt.format(n),
  };
};
```

> **Reuse the `Intl.*` instances.** Construct each formatter once (as above), not on
> every call. `Intl.NumberFormat`/`Intl.DateTimeFormat` construction is comparatively
> expensive, so building a new one inside a render or a loop is wasteful.

### Pure util / shared form

If no Nuxt context is needed, the same functions live as plain exports:

```typescript
// shared/utils/format.ts  (or utils/formatters.ts for client-only)
const currencyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export const formatCurrency = (amount: number) => currencyFmt.format(amount);
export const formatDate = (date: string | Date) => dateFmt.format(new Date(date));
```

## Checklist before adding a formatter

- [ ] Searched for an existing `useFormatters` / `formatters` / `format` util?
- [ ] Reusing it if a matching formatter exists?
- [ ] Checked for a VueUse helper (`useDateFormat`, `useTimeAgo`, …) before hand-rolling?
- [ ] Using `date-fns` for any date parsing/formatting/math — not hand-parsing strings?
- [ ] If creating, placed it in the right shared location (composable vs util vs shared)?
- [ ] Constructed the `Intl.*` instance once, not per call?
- [ ] Replaced the inline formatting at the call site with the shared function?
