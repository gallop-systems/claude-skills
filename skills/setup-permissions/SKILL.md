---
name: setup-permissions
description: Set up Claude Code read-only permissions and analyze session history for additional permission suggestions
disable-model-invocation: true
---

# Setup Permissions

This skill configures Claude Code permissions in `~/.claude/settings.json`. It does two things:

1. Installs a baseline set of read-only permissions
2. Analyzes recent session history to suggest additional read-only permissions

## Instructions

When invoked, follow these steps **in order**:

### Step 1: Install baseline permissions

Read `~/.claude/settings.json`. If it doesn't have a `permissions.allow` array, create one. Merge the following baseline read-only permissions into the existing allow list (don't duplicate entries that already exist):

**Tools:**
```
Read
Glob
Grep
```

**Shell — general read-only:**
```
Bash(awk:*), Bash(basename:*), Bash(cat:*), Bash(cd:*), Bash(date:*),
Bash(diff:*), Bash(dirname:*), Bash(du:*), Bash(echo:*), Bash(file:*),
Bash(find:*), Bash(grep:*), Bash(head:*), Bash(ls:*), Bash(mkdir:*),
Bash(open:*), Bash(pwd:*), Bash(realpath:*), Bash(sort:*), Bash(tail:*),
Bash(tr:*), Bash(wc:*), Bash(which:*)
```

**Git — read-only + staging/committing:**
```
Bash(git add:*), Bash(git branch:*), Bash(git commit:*), Bash(git diff:*),
Bash(git fetch:*), Bash(git log:*), Bash(git ls-remote:*), Bash(git remote:*),
Bash(git show:*), Bash(git stash:*), Bash(git status:*), Bash(git tag:*)
```

**GitHub CLI — read-only:**
```
Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh pr diff:*), Bash(gh pr checks:*),
Bash(gh run view:*), Bash(gh run list:*), Bash(gh repo view:*), Bash(gh search:*)
```

**Yarn/npm — read-only and checks:**
```
Bash(yarn typecheck:*), Bash(yarn install:*), Bash(yarn test:*),
Bash(yarn test:run:*), Bash(yarn test:frontend:*), Bash(yarn test:frontend:run:*),
Bash(yarn lint:*), Bash(yarn fmt:check:*), Bash(yarn generate:types:*),
Bash(yarn why:*), Bash(yarn db:codegen:*),
Bash(npx nuxi typecheck:*), Bash(npx vue-tsc:*), Bash(npx tsc:*),
Bash(npm list:*), Bash(npm ls:*), Bash(npm view:*), Bash(npm show:*),
Bash(npm search:*), Bash(npm outdated:*)
```

**Network — read-only:**
```
Bash(curl -s:*), Bash(curl -I:*), Bash(curl -sI:*), Bash(curl -v:*), Bash(curl -sv:*)
```

**Other read-only:**
```
Bash(node -e:*), Bash(sips -g:*), Bash(ffprobe:*),
Bash(tailscale status:*), Bash(s3cmd ls:*)
```

Save the updated settings file.

Tell the user: "Baseline permissions installed. Now analyzing session history..."

### Step 2: Analyze session history for additional permissions

Scan all `.jsonl` files under `~/.claude/projects/` from the past 4 weeks (skip files in `subagents/` directories). Extract all `Bash` tool calls and tally the first two words of each command (e.g., `yarn dev`, `npx tsx`, `git push`).

Write a Python script to `/tmp/analyze_permissions.py` that:
1. Finds all `.jsonl` files modified in the last 28 days (excluding subagents)
2. Parses each line as JSON, looks for `tool_use` blocks with `name: "Bash"`
3. Extracts the command and gets the first 1-2 words
4. Counts occurrences
5. Filters OUT commands that are already covered by the baseline permissions above
6. Prints remaining commands sorted by frequency

Run the script and review the output.

For each remaining command, classify it as:
- **Read-only / safe** — e.g., `docker ps`, `brew list`, `doctl apps list`
- **Mutating / dangerous** — e.g., `git push`, `rm`, `ssh`, `psql` (can modify data), `python3 -c` (arbitrary code)

Present ONLY the read-only commands to the user in a clear list, showing the command and how many times it was used. Example format:

```
These read-only commands were found in your recent sessions:

  45x  docker ps
  12x  brew list
   8x  doctl apps list:*

Add these to your permissions? (yes/no)
```

Use AskUserQuestion to ask whether to add them.

If the user approves, add the approved permissions to `~/.claude/settings.json` and confirm.

### Classification rules

A command is **read-only** if it:
- Only reads/displays information (list, view, status, show, info, version, help)
- Cannot modify files, state, or remote systems
- Cannot execute arbitrary code

A command is **NOT read-only** if it:
- Can modify files or state (push, delete, create, update, install, run)
- Connects to remote systems interactively (ssh, psql)
- Can execute arbitrary code (python3, node without -e specifically for eval)
- Sends data to external services (post, put, patch)

When in doubt, do NOT include it in the suggestions — err on the side of caution.
