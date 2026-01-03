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
```

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
