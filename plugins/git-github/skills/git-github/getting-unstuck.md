# Getting Unstuck: Repair Ladders for Common Git Failures

Each section is a failure you'll actually hit, with the sequence that resolves it.

## Rejected push (remote has new commits)

```
! [rejected]  <branch> -> <branch> (fetch first)
```

The ladder — each step unblocks the next:

```bash
git stash push -u -m "wip before rebase"     # only if the tree is dirty
git pull --rebase origin <branch>
git push
git stash pop
```

- `git pull --rebase` refuses to run with unstaged changes (`cannot pull with rebase: You have unstaged changes`) — hence stash first, always with `-u` (untracked files) and a descriptive `-m`.
- If the dirty files are unrelated WIP, scope the stash: `git stash push -u -m "wip" -- <paths>` so the rest of the tree stays put.
- `fatal: Need to specify how to reconcile divergent branches` → same fix: `git pull --rebase origin <branch>`.

## Checkout/merge blocked by local changes

`error: Your local changes to the following files would be overwritten by checkout` — same stash-first pattern: stash, switch/merge, pop.

## Rebasing a stacked branch after its base was squash-merged

After the parent PR squash-merges, your stacked branch "contains" commits main already has in squashed form. A plain rebase replays them all and conflicts everywhere. Instead, replay only your own commits:

```bash
git log --oneline main..HEAD                  # identify your commits
git merge-base HEAD origin/main               # sanity-check the old fork point
git rebase --onto origin/main <old-base-sha>  # replay only commits after <old-base-sha>
```

During the rebase:
- **`--ours`/`--theirs` are inverted during rebase**: `--ours` is the *new base* (main), `--theirs` is *your branch's* change. `git checkout --ours <file> && git add <file>` keeps main's version.
- Commits that were already squash-merged become empty → `git rebase --skip` (or `git cherry-pick --skip` in cherry-pick flows; `--allow-empty` if you want the empty commit).
- "dropping <sha> ... patch contents already upstream" is rebase doing its job — verify afterward with `git log origin/main..HEAD` rather than assuming commits vanished.
- If you rebased a detached `HEAD`, reattach the branch: `git checkout -B <branch>`.

Then force-push: `git push --force-with-lease origin <branch>`, and confirm the PR recovered with `gh pr view <n> --json mergeable,mergeStateStatus`.

If a rebase goes sideways: `git rebase --abort`, re-inspect with `git log --oneline origin/main..HEAD`, try again with a better plan.

## Lockfile / generated-file conflicts during rebase

Don't hand-merge lockfiles. Take one side wholesale and regenerate:

```bash
git checkout --ours yarn.lock && git add yarn.lock
git rebase --continue
yarn install        # regenerate to match the merged manifest; commit if it changed
```

## `--force-with-lease` rejected as stale

A bare `--force-with-lease` compares against your remote-tracking ref. If the branch was fetched into a local ref or `FETCH_HEAD` only (common in CI/sandbox checkouts), every lease push fails. Fix: make sure `refs/remotes/origin/<branch>` exists —

```bash
git fetch origin '+refs/heads/<branch>:refs/remotes/origin/<branch>'
```

— or pass an explicit lease: `--force-with-lease=<branch>:<expected-sha>`.

## Shallow clones silently imply single-branch

`git clone --depth=N` narrows the fetch refspec to the default branch, so `git fetch origin <other-branch> && git checkout <other-branch>` fails even though the branch exists. Fix with an explicit refspec:

```bash
git fetch origin '+refs/heads/<branch>:refs/remotes/origin/<branch>'
git checkout -B <branch> origin/<branch>
```

## `fatal: couldn't find remote ref <branch>`

You guessed the branch name. `git branch -a` / `git fetch origin` first — or skip the guessing entirely with `gh pr checkout <n>`, which fetches the PR head regardless of branch naming.

## `gh pr create` → "Head sha can't be blank / No commits between X and Y"

The branch has no commits ahead of its base (or wasn't pushed). Commit and/or `git push -u` first.

## Migrations vs a moving main

When main gained DB migrations while your PR was open: migrate down locally, rebase onto main, **rename your migration files so their timestamps sort after main's**, re-run migrations. Migration order is part of the merge.

## Worktrees: fix CI without disturbing WIP

```bash
git worktree add ../<repo>-hotfix <branch>                 # existing branch
git worktree add -b <new-branch> ../<repo>-hotfix origin/main
# ... fix, commit, push from the worktree ...
git worktree remove --force ../<repo>-hotfix && git worktree prune
```

Caveat: hooks that run package scripts may fail inside a worktree if they resolve modules from the main checkout — run installs in the worktree first.

## `git diff --cached` can't take a range

`git diff --stat --cached main..` → usage error (exit 129). The cached diff is against a single commit: `git diff --stat --cached main`.

## Long-diverged automation branches

A bot-maintained branch diverged 3-vs-105 commits is not worth merging — `git reset --hard origin/<branch>` (destructive: requires explicit user authorization) and re-apply the local delta on top.
