# Claude Skills

A collection of Claude Code skills.

## Installation

First, add the marketplace:
```
/plugin marketplace add gallop-systems/agent-skills
```

Then install the skills you want:
```
/plugin install kysely-postgres@gallop-systems-agent-skills
/plugin install nuxt-nitro-api@gallop-systems-agent-skills
/plugin install nitro-testing@gallop-systems-agent-skills
/plugin install linear@gallop-systems-agent-skills
/plugin install doctl@gallop-systems-agent-skills
/plugin install git-github@gallop-systems-agent-skills
/plugin install copier-template@gallop-systems-agent-skills
```

## Updating

Update a specific skill to the latest version:
```
/plugin update kysely-postgres@gallop-systems-agent-skills
```

**Auto-updates:** Third-party marketplaces don't auto-update by default. To enable:
1. Run `/plugin` and select **Marketplaces**
2. Choose `gallop-systems-agent-skills`
3. Select **Enable auto-update**

## Install as an npm dependency (per-repo)

For JS/TS repos, you can pin the skills to a version via your lockfile instead of
the marketplace. Add the package as a dev dependency:

```
yarn add -D @gallopsystems/agent-skills
```

On install, a `postinstall` script symlinks the package's content into the
project's `.claude/` directory:

- **skills** — each directory containing a `SKILL.md` → `.claude/skills/<name>`
- **commands** — each `.md` file under any `commands/` directory → `.claude/commands/<name>.md`

Updating is just a version bump:

```
yarn up @gallopsystems/agent-skills
```

These links are generated artifacts (they point into `node_modules` and are
recreated on every install), so ignore them in `.gitignore`:

```
.claude/skills
.claude/commands
```

Notes:
- The script never clobbers a real `.claude/skills/<name>` or `.claude/commands/<name>`
  you authored, and only removes symlinks it created. Run `yarn unlink-skills` to
  remove all managed links.
- Works out of the box with Yarn (Classic, or Berry with `nodeLinker: node-modules`)
  and npm. **pnpm** (v10+) blocks dependency build scripts by default — add the
  package to `pnpm.onlyBuiltDependencies` for the `postinstall` to run.
- Yarn Berry with the default **PnP** linker is not supported (no `node_modules`
  folder to link from); use `nodeLinker: node-modules`.

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

### linear

Create, triage, and manage Linear issues following team conventions, with a GraphQL CLI for operations the Linear MCP server doesn't expose.

Covers:
- Issue creation and triage conventions
- Tech-stack labels
- A `linear.mjs` CLI for GraphQL operations

### doctl

Manage DigitalOcean resources with the doctl CLI.

Covers:
- Auth contexts (per-command `--context` over stateful switching)
- Resolving the current git repo to its DO context + app
- App Platform: deployments, bounded polling, logs and their retention quirks
- App specs: env var/secret round-trips, validation, creating apps
- `--format` / `-o json` gotchas
- Managed databases, Spaces keys, droplets, DNS

### git-github

Git and GitHub (gh CLI) workflows for agents.

Covers:
- Ground rules and the branch → commit → PR loop
- Reading PR and CI state (`gh pr view --json`, `gh pr checks`)
- Debugging failed GitHub Actions runs (the full playbook)
- Repair ladders: rejected pushes, rebase-after-squash-merge, shallow clones, worktrees
- `gh api` recipes: PR comments, no-checkout file reads, repo settings, PAT gotchas
- Releases: tags, npm Trusted Publishing, release-please
- External review loop with the codex CLI

### copier-template

Maintain a Copier project template and propagate updates to generated repos.

Covers:
- Template anatomy: copier.yml, conditional files, tasks, jinja escaping in CI workflows
- Testing template changes (`--vcs-ref HEAD`, generate-and-validate)
- Releasing versions (tag + GitHub Release) and the update-checker workflow pattern
- Applying `copier update` in descendants: conflict triage, `.rej` files, validation

## Contributing a Lesson Back

Every skill ends with a **Contributing Back** section: when Claude works through
something the skill didn't cover, it offers to contribute the lesson upstream. The
`/contribute-skill` command (shipped in this package and symlinked into
`.claude/commands/` on install) automates the flow: distill the generic lesson,
privacy-sweep it, clone or fork this repo, and open a PR against the right skill
file. PRs from forks are welcome — content must be generic (placeholders only, no
project-specific names, IDs, or domains).

## Adding New Skills

1. Create a new plugin directory: `plugins/my-skill/`
2. Add `plugins/my-skill/.claude-plugin/plugin.json`:
   ```json
   {
     "name": "my-skill",
     "description": "Short description",
     "version": "1.0.0",
     "author": { "name": "yeedle" }
   }
   ```
3. Add `plugins/my-skill/skills/my-skill/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: my-skill
   description: When to use this skill...
   ---

   # Skill content here
   ```
4. Add any reference files alongside `SKILL.md`
5. Register the plugin in `.claude-plugin/marketplace.json`
6. Commit and push
