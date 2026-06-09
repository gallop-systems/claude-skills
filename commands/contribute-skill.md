---
description: Contribute a lesson learned this session back to the gallop-systems/agent-skills repo as a PR
argument-hint: [which skill and/or what lesson]
---

# Contribute a Lesson Back to the Skills Repo

You are turning something learned in this session into a PR against
https://github.com/gallop-systems/agent-skills, the public repo behind the
installed skills.

## 1. Identify the lesson

From this session (or from `$ARGUMENTS` if given), pin down:

- **The lesson**: usually an error→fix sequence, a behavior that contradicted the
  skill, or a workflow knot the skill didn't cover. It must be something you
  *verified in this session* — not a guess.
- **The target**: which skill (`doctl`, `git-github`, `copier-template`,
  `kysely-postgres`, `nuxt-nitro-api`, `nitro-testing`, `linear`), and within it,
  whether it belongs in `SKILL.md` or one of its reference `.md` files. Read the
  target file first and match its structure and tone.

If the lesson is ambiguous or you can't verify it, stop and clarify with the user.

## 2. Genericize — the repo is public

Rewrite the lesson with placeholders only: `<app-id>`, `<owner>/<repo>`, `<branch>`,
`<domain>`. **No project names, client names, UUIDs, IPs, domains, tokens, or file
paths from the user's codebase.** Keep it tight: the generic rule, a minimal example
command, and the failure it prevents — in that order.

## 3. Clone, edit, verify

Work in a temp directory, never in the user's project:

```bash
dir=$(mktemp -d)
if [ "$(gh api repos/gallop-systems/agent-skills --jq .permissions.push)" = "true" ]; then
  gh repo clone gallop-systems/agent-skills "$dir"
else
  gh repo fork gallop-systems/agent-skills --clone "$dir"   # outside contributors
fi
cd "$dir" && git checkout -b feat/<skill>-<short-slug>
```

Edit the target file under `plugins/<skill>/skills/<skill>/`. Then privacy-sweep
your diff before committing — grep the changed files for anything resembling the
user's project (project name, org, hostnames, IDs). If anything hits, fix it.

## 4. Commit and open the PR

The repo enforces Conventional Commit PR titles (release-please derives versions
from them). Use `feat(<skill>): <summary>` for new coverage, `fix(<skill>): <summary>`
for corrections to existing content.

```bash
git add -A && git commit -m "feat(<skill>): document <lesson summary>"
git push -u origin <branch>
gh pr create --repo gallop-systems/agent-skills \
  --title "feat(<skill>): <summary>" \
  --body "<what the lesson is, how it was hit and verified (genericized), why it belongs in this skill>"
```

Show the user the PR URL, then clean up: `cd - && rm -rf "$dir"`.
