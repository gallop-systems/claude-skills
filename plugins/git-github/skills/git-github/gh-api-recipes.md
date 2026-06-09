# gh api Recipes

Read-only `gh api` patterns for inspecting repos and PRs without checking anything out.

## PR feedback lives in TWO places — fetch both

Inline review comments and conversation-tab comments are different endpoints. When addressing PR feedback, always check both:

```bash
# Inline review comments (attached to lines of the diff)
gh api repos/<owner>/<repo>/pulls/<n>/comments \
  --jq '[.[] | {id, path, line, body, user: .user.login}]'

# Conversation-tab comments
gh api repos/<owner>/<repo>/issues/<n>/comments \
  --jq '[.[] | {id, body, user: .user.login, created_at}]'

# Review states/bodies (approve / request-changes verdicts)
gh api repos/<owner>/<repo>/pulls/<n>/reviews --jq '[.[] | {state, body, user: .user.login}]'
```

Reply at the conversation level with `gh pr comment <n> --body "..."` (there's no clean CLI path for threaded inline replies).

Repo-wide recent PR comments, newest first:

```bash
gh api 'repos/<owner>/<repo>/issues/comments?sort=created&direction=desc&per_page=30' --paginate \
  --jq '.[] | select(.pull_request_url != null) | {pr: .pull_request_url, body, created_at}'
```

## Reading files and history without a checkout

```bash
# Read one file off any branch (URL-encode brackets in paths: %5Bid%5D)
gh api 'repos/<owner>/<repo>/contents/<path>?ref=<branch>' --jq '.content' | base64 -d

# Full file tree
gh api 'repos/<owner>/<repo>/git/trees/<branch>?recursive=1' --jq '.tree[].path'

# Per-file commit history
gh api 'repos/<owner>/<repo>/commits?path=<file>&per_page=5' \
  --jq '.[] | {sha: .sha[0:7], msg: .commit.message, date: .commit.author.date}'

# Which files a PR touches (with per-file status)
gh api repos/<owner>/<repo>/pulls/<n>/files --jq '.[] | {filename, status, additions, deletions}'
```

(`gh pr diff <n>` and `gh pr diff <n> --name-only` cover the common cases without the api call.)

## Repo settings audit

```bash
# Merge policy
gh api repos/<owner>/<repo> --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge, squash_merge_commit_title, squash_merge_commit_message}'

# Branch protection
gh api repos/<owner>/<repo>/branches/<branch>/protection
```

## Deploy keys (server pulls a private repo)

```bash
# generate the key on the server, then:
gh repo deploy-key add - --repo <owner>/<repo> --title "<host>" <<< "$PUBKEY"
gh repo deploy-key list --repo <owner>/<repo>
```

## Token and version gotchas

- **Fine-grained PATs can't access some endpoints at all** (e.g. `/notifications`): 403 "Resource not accessible by personal access token". The tell: the response **lacks the `x-accepted-github-permissions` header**, meaning no grantable permission fixes it — you need a classic PAT with the right scope for that one call.
- For scripted clones with a token, the remote form is `https://x-access-token:<TOKEN>@github.com/<owner>/<repo>.git`.
- **Pushing workflow files** with an OAuth-scoped token fails with "refusing to allow an OAuth App to update workflow". Fix: `gh auth refresh -h github.com -s repo,workflow`.
- **`--json` field sets vary by gh version** (`Unknown JSON field: "isLatest"`). The error prints the supported field list — re-run with fields from that list rather than guessing.
