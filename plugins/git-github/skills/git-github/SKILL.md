---
name: git-github
description: Git and GitHub (gh CLI) workflows for agents - the branch-to-PR loop, reading PR and CI state, debugging failed GitHub Actions runs, getting unstuck from rejected pushes and rebase messes, gh api recipes, and release flows.
---

# Git + GitHub Workflows

Battle-tested git and `gh` patterns for working in repos as an agent: the everyday branch→PR loop, interrogating PR/CI state, and recovering from the states git gets itself into.

## Ground Rules

- **Never push to the default branch unless the user explicitly says to.** "Commit and push" means the current branch. If on the default branch, branch first.
- **Destructive operations require explicit user authorization**: `push --force` (even with lease, outside your own just-rebased branch), deleting remote branches, closing PRs you didn't open, `reset --hard`, `--no-verify`.
- **Quote pathspecs containing brackets.** zsh globs `[id].get.ts` into `no matches found` — write `git add 'server/api/[id].get.ts'`. This bites on every bracketed-route codebase.
- **Prefer `git -C <path>`** over `cd <path> && git ...` — compound cd commands trigger permission prompts and reset the shell cwd.
- **Branch naming**: follow the repo's convention (`feat/`, `fix/`, `chore/`, `ci/`). If an issue tracker (e.g. Linear) suggests a branch name for the ticket, use it verbatim — it powers the tracker↔GitHub integration (auto-close on merge).
- **Bounded polling, never unbounded watching.** `gh run watch` / `--watch` can die on network timeouts mid-wait; in agent contexts prefer a bounded loop with escalating sleeps (30/60/90s).

## The Branch → PR Loop

```bash
# 1. Start from fresh main
git checkout main && git pull --ff-only
git checkout -b feat/<short-description>

# 2. Commit with a heredoc (multi-line messages survive quoting)
git commit -m "$(cat <<'EOF'
feat(scope): one-line summary

Why this change exists, not just what it does.
EOF
)"

# 3. Push and open the PR with a structured body
git push -u origin feat/<short-description>
gh pr create --title "feat(scope): one-line summary" --body "$(cat <<'EOF'
## What
...

## Why
...

## Notes for reviewers
...
EOF
)"
```

- **Keep the PR description current.** After material scope changes, `gh pr edit <n> --body "$(cat <<'EOF' ... EOF)"`.
- Merge style: `gh pr merge <n> --squash --delete-branch`; verify with `gh pr view <n> --json state,mergedAt`.
- After merge: `git switch main && git pull --ff-only`, clean up `[gone]` branches, start the next branch from fresh main.
- One concern per PR — hotfixes and review findings go in separate PRs unless told otherwise.
- Stacked PRs: `gh pr create --base <parent-branch>`; after the parent merges, retarget with `gh pr edit <n> --base main` (and see [getting-unstuck.md](getting-unstuck.md) for rebasing onto main after the parent was squash-merged).

## Reading PR and CI State

```bash
gh pr view <n> --json mergeable,mergeStateStatus,reviewDecision,state,mergedAt
gh pr view <n> --json body -q .body          # read the current description
gh pr diff <n>                                # the review workhorse; --name-only for the file list
gh pr checks <n>                              # CI status table
gh pr checks <n> --json name,bucket,link --jq '.[] | select(.bucket=="fail")'
```

- `mergeable: CONFLICTING` / `mergeStateStatus: DIRTY` → branch conflicts with base; `BEHIND` → needs update.
- Bounded CI wait: `until gh pr checks <n> 2>&1 | grep -qvE 'pending'; do sleep 30; done` — or check, sleep 30/60/90, re-check.

## Pre-push Hook Noise

When a push fails inside a compound command (or behind lefthook/husky pre-push hooks), the hook's lint/test output drowns the real git error. Isolate it:

```bash
git push -u origin <branch> > /tmp/push.log 2>&1; echo "exit=$?"
grep -E '! \[reject|error:|fatal:' /tmp/push.log
```

Do not bypass failing hooks with `--no-verify` unless the user says to.

## Further Reading

- **Debugging failed Actions runs** (the full playbook): [actions-debugging.md](actions-debugging.md)
- **Repair ladders** — rejected pushes, blocked checkouts, rebase/conflict recovery, shallow clones, worktrees: [getting-unstuck.md](getting-unstuck.md)
- **gh api recipes** — PR comments, reading files without checkout, repo settings, PAT gotchas: [gh-api-recipes.md](gh-api-recipes.md)
- **Releases & publishing** — tags, gh release, npm Trusted Publishing, release-please: [releases.md](releases.md)
- **External review loop** — using the codex CLI as an adversarial pre-merge reviewer: [external-review.md](external-review.md)
