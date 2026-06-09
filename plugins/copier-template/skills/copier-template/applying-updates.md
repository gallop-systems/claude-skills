# Applying a Template Update in a Descendant

Usually triggered by the automated "template update available" PR — its body contains the runbook; this file is the full procedure with the judgment calls spelled out.

## The sequence

```bash
gh pr view <n> --json title,body                 # read the bot PR's instructions
git checkout chore/template-update && git pull   # the bot's static branch

# clean tree required — copier refuses otherwise
git stash --include-untracked -m "wip before template update"   # if dirty

uvx copier update --trust --defaults

# triage
git status --short            # UU = unmerged (inline conflict markers)
find . -name '*.rej'          # hunks copier couldn't apply
grep _commit .copier-answers.yml   # confirm the new version
```

Note the version it reports: `copier update` goes to the **latest** tag, which may be newer than the one the bot PR advertised. A multi-version jump means several releases' worth of changes land at once — budget for more conflicts.

## Resolving conflicts

Copier writes diff3-style inline markers:

```
<<<<<<< before updating
<your project's current content>
||||||| last update
<what the old template version had>
=======
<what the new template version has>
>>>>>>> after updating
```

Survey all conflict blocks first: `awk '/^<<<<<<< /,/^>>>>>>> /' <file>`.

**Decision procedure per file** — check `git log --oneline -- <file>`:

| File history | Resolution |
|---|---|
| Hand-customized in this project | Keep ours (project side) |
| Untouched scaffold since generation | Take theirs (template side) |
| Shared file with both kinds of changes (login page, CI workflow, app config) | Merge both — keep project customizations *and* add the template's new feature |

Mechanical resolutions with perl (whole-block operations, safe for multi-line):

```bash
# keep ours: delete the entire conflict block (template side discarded)
perl -0pi -e 's/^<<<<<<< before updating\n(.*?)^\|\|\|\|\|\|\| last update\n.*?^>>>>>>> after updating\n/$1/gms' <file>

# keep both sides (ours then theirs)
perl -0pi -e 's/^<<<<<<< before updating\n(.*?)^\|\|\|\|\|\|\| last update\n.*?^=======\n(.*?)^>>>>>>> after updating\n/$1$2/gms' <file>
```

**`.rej` files**: copier couldn't apply a hunk (the local file diverged too far). Read the `.rej`, re-apply its *intent* manually — and check whether copier dropped project-specific content nearby (e.g. local vars in `.env.example`) — then `rm` the `.rej`.

**Review the non-conflicted changes too.** Copier silently overwrites scaffold-owned files, and a new template assumption can be wrong for this project (e.g. a type coercion that assumes numeric IDs in a project using string IDs). `git diff` every copier-touched app-code file; revert what doesn't fit, and consider whether the template itself needs a fix.

Final sweep before staging:

```bash
grep -rn '<<<<<<<\|>>>>>>>' . --exclude-dir=node_modules
```

## Validate, commit, hand back

```bash
git add -A   # includes .copier-answers.yml — it must be committed with the update
yarn install && yarn typecheck && yarn lint && yarn fmt:check && yarn test:run
```

Commit as `chore: update to template vX.Y.Z` with a body listing the notable upstream changes **and each conflict resolution with its rationale** — that's the audit trail for the squash-merge. Then retitle the bot PR (`gh pr edit <n> --title "chore: update to template vX.Y.Z"`), push, watch CI, and ask the user before merging. The bot's empty placeholder commit is fine — it disappears in the squash.

**If something fails after the update**, prove whether it's pre-existing before blaming the update: `git worktree add /tmp/<proj>-main origin/main`, reuse node_modules (symlink), rerun the failing check there. A byte-identical failure on main means fix-forward in this PR, not a regression.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Destination repository is dirty; cannot continue` | `git stash --include-untracked` — plain `git stash` misses untracked files (including editor swap files), which still count as dirty |
| Copier refuses to render at all | Template has `_tasks` — add `--trust` |
| Hangs or fails in non-interactive shells | Add `--defaults` (and `--data key=value` for questions without defaults) |
| Update landed a version you didn't expect | `copier update` always targets the latest tag; pin with `--vcs-ref v<X.Y.Z>` if you need a specific one |
| Template change is wrong for this project | Revert locally, note it in the commit body, open a template issue/PR if other descendants are affected |
