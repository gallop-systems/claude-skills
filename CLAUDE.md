# agent-skills

This repository distributes Claude Code **skills and plugins** — it contains no
application/runtime code, only skill content (Markdown references, examples, plugin
manifests).

## Commit & PR conventions

Releases are automated via release-please, which derives version bumps from
[Conventional Commits](https://www.conventionalcommits.org/) — using the **PR title**
(squash merge) and commit messages.

Because there is no code in this package, the usual code/docs split does not apply.
**Any new skill, or update to an existing skill, must use `feat` in the PR title**
(and ideally the commit message) so it produces a user-facing release.

- `feat(<plugin>): ...` — adding a skill, or adding/changing/expanding skill content
  (new reference files, new guidance, meaningful edits). This is the default for
  skill work.
- `fix(<plugin>): ...` — correcting wrong or broken skill content.
- `chore:` / `docs:` — reserve for genuine repo-meta changes (CI, tooling, this file,
  top-level README housekeeping) that should **not** ship as a skill release.

Do **not** use `docs:` for skill content even though it is Markdown — to the consumers
of this repo, a skill *is* the product, so changes to it are `feat`/`fix`.

Scope the type to the plugin where practical, e.g. `feat(nuxt-nitro-api): ...`.
