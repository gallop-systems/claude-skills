# Debugging Failed GitHub Actions Runs

The playbook, in the order that actually works.

## 1. Start from the PR, not the run

```bash
gh pr checks <n> --watch --interval 20 --fail-fast=false   # interactive sessions
gh pr checks <n>                                            # one-shot snapshot for poll loops
```

The output includes run/job links with the IDs you need. `--required` limits to required checks.

For branch pushes without a PR, find the run:

```bash
rid=$(gh run list --branch <branch> --limit 1 --json databaseId,status,conclusion --jq '.[0].databaseId')
```

## 2. Get the failing-step logs

```bash
gh run view <run-id> --log-failed 2>&1 | tail -50
```

This is the first command of every failure investigation. When noisy, narrow it:

```bash
gh run view <run-id> --log-failed | grep -E 'FAIL|error|✗'
# aggregate TypeScript errors by code:
gh run view <run-id> --log-failed | grep -oE 'error TS[0-9]+' | sort | uniq -c | sort -rn
```

Runner log lines are prefixed with `job\tstep\ttimestamp` — strip before aggregating:

```bash
sed -E 's/^[^\t]*\t[^\t]*\t[0-9T:.Z-]* //'
```

and file paths are absolute on the runner — strip `s#^/home/runner/work/<repo>/<repo>/##` to get repo-relative paths.

## 3. Need context before the failure?

`--log-failed` shows only the failing step. For surrounding context:

```bash
gh run view <run-id> --json status,conclusion,jobs --jq '{status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}'
gh run view <run-id> --job <job-id> --log | grep -E '<pipeline markers>'
gh api repos/<owner>/<repo>/actions/jobs/<job-id>/logs | tail -60    # raw dump, last resort
```

## 4. Flaky or real? Check main

```bash
gh run list --branch main --limit 3 --json databaseId,status,conclusion
```

If main is red with the same failure, the problem isn't your branch. If it looks like a flake:

```bash
gh run rerun <run-id> --failed     # reruns only the failed jobs
```

Note: `gh run rerun --job <id>` only works on failed jobs within the retention window ("job cannot be rerun" otherwise).

## 5. Reproduce locally before fixing

Run the exact failing command from the workflow (`yarn test:run -- <file>`, `yarn fmt:check`, etc.). For environment-dependent failures (Linux vs macOS differences, missing gitignored fixtures, float-precision diffs in generated output), reproduce inside the CI image:

```bash
docker run --rm -v "$PWD":/work -w /work node:22 bash -c \
  'yarn install --immutable && <failing command>'
```

## 6. Fix → push → re-watch → merge

```bash
git push
sleep 30 && gh pr checks <n>          # then 60s, 90s — escalating, bounded
gh pr merge <n> --squash --delete-branch
gh pr view <n> --json state,mergedAt
git switch main && git pull --ff-only
```

## Watching: bounded polls beat unbounded watches

`gh run watch <id> --exit-status` is convenient but long watches can die with a GraphQL network timeout, losing the wait entirely. In agent contexts prefer:

```bash
for s in 30 60 90 90 90; do
  sleep $s
  state=$(gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"')
  echo "$state"; [[ "$state" == completed/* ]] && break
done
```

## Common root causes (in observed frequency order)

1. **Formatter/lint check failures** — fix is `yarn fmt` (or the repo's equivalent), commit, push.
2. **Test-only bugs** — assumptions that break under the CI harness (e.g. transaction-rollback test isolation).
3. **Environment differences** — CI Linux vs local macOS: gitignored fixture files missing in CI, locale/precision output diffs.
4. **Genuine flakes** — rerun `--failed`; if it recurs, it's not a flake.
