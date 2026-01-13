# Claude Skills

A collection of Claude Code skills.

## Installation

First, add the marketplace:
```
/plugin marketplace add gallop-systems/claude-skills
```

Then install all skills:
```
/plugin install all@gallop-systems-claude-skills
```

Or install individual skills:
```
/plugin install kysely-postgres@gallop-systems-claude-skills
/plugin install nuxt-nitro-api@gallop-systems-claude-skills
/plugin install nitro-testing@gallop-systems-claude-skills
```

## Updating

Update all skills to the latest version:
```
/plugin update all@gallop-systems-claude-skills
```

Or update a specific skill:
```
/plugin update kysely-postgres@gallop-systems-claude-skills
```

**Auto-updates:** Third-party marketplaces don't auto-update by default. To enable:
1. Run `/plugin` and select **Marketplaces**
2. Choose `gallop-systems-claude-skills`
3. Select **Enable auto-update**

## Available Skills

### kysely-postgres

Type-safe Kysely query patterns for PostgreSQL. Automatically activates when working in Node.js/TypeScript projects with Kysely.

Covers:
- Query patterns (SELECT, JOIN, WHERE, aggregations)
- Migrations and recommended column types
- JSON/JSONB and array handling
- String concatenation
- Common pitfalls to avoid

### nuxt-nitro-api

Nuxt 3 / Nitro API patterns for building type-safe full-stack applications. Automatically activates when working in Nuxt 3 projects.

Covers:
- Zod validation with h3 (Standard Schema support)
- useFetch vs $fetch vs useAsyncData
- Type inference (don't add manual types!)
- nuxt-auth-utils (OAuth, WebAuthn, middleware)
- Page structure (keep pages thin)
- Composables vs utils
- SSR + localStorage patterns
- Deep linking (URL params sync)
- Nitro tasks and job queues
- Server-Sent Events (SSE)
- Third-party service integrations

### nitro-testing

Test Nitro API handlers with real PostgreSQL using transaction rollback isolation. Each test runs in a transaction that auto-rolls back for complete isolation without cleanup overhead.

Covers:
- Transaction rollback pattern (fast, isolated, real SQL)
- Vitest custom fixtures (`factories`, `db`)
- Mock event helpers (`mockGet`, `mockPost`, `mockPatch`, `mockDelete`)
- Factory pattern for test data creation
- Global stubs for Nuxt auto-imports
- Async/automation testing utilities
- CI/CD setup with GitHub Actions and PostgreSQL

## Adding New Skills

1. Create a new directory under `skills/`
2. Add a `SKILL.md` file with frontmatter:
   ```yaml
   ---
   name: my-skill
   description: When to use this skill...
   ---

   # Skill content here
   ```
3. Add any reference files in the same directory
4. Commit and push
