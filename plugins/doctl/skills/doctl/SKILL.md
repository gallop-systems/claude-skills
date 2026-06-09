---
name: doctl
description: Manage DigitalOcean resources with the doctl CLI. Covers auth contexts, App Platform (deployments, logs, env vars/secrets via app specs), mapping a git repo to its app, managed databases, Spaces keys, and droplets.
---

# DigitalOcean doctl CLI Patterns

Patterns for managing DigitalOcean resources via the `doctl` CLI, centered on App Platform.

## When to Use This Skill

Use this skill when:
- Deploying or monitoring apps on DigitalOcean App Platform
- Checking deployment status, build failures, or runtime logs
- Adding/changing env vars or secrets on a deployed app
- Working with managed databases, Spaces, or droplets
- Figuring out which DO account/app corresponds to the current repo

## Auth Contexts

doctl supports named auth contexts for managing multiple accounts/teams.

```bash
doctl auth list                          # list contexts; (current) marks the active one
doctl account get --context <name>       # cheap probe: is this context valid, which account is it?
```

**Prefer the `--context` flag over switching.** Every doctl command accepts `--context <name>` (before or after the subcommand). This targets one account for one command without mutating global state — important when a session touches multiple accounts:

```bash
doctl apps list --context <ctx>
for ctx in $(doctl auth list); do doctl apps list --context "$ctx"; done
```

Only use `doctl auth switch --context <name>` when the user explicitly wants the default changed.

**`doctl auth init --context <name>` is interactive** (it prompts for a pasted token) — an agent cannot complete it. Ask the user to run it themselves.

## Resolving the Current Repo to a Context + App

App specs embed their source repo, so "check prod logs" is answerable from inside any repo:

```bash
repo=$(git remote get-url origin | sed -E 's#.*github.com[:/]##; s#\.git$##')
for ctx in $(doctl auth list); do
  doctl apps list --context "$ctx" -o json 2>/dev/null | jq -r --arg ctx "$ctx" --arg repo "$repo" \
    '.[] | select([.spec.services[]?, .spec.static_sites[]?, .spec.workers[]?, .spec.jobs[]?]
      | any(.github.repo == $repo)) | "\($ctx)\t\(.spec.name)\t\(.id)"'
done
```

This costs one API call per context — resolve once per session and reuse the `(context, app-id)` pair. If a repo backs multiple apps (e.g. staging + prod, or one repo deployed to several accounts), list the matches and ask the user which one they mean. Apps deployed without a git source won't be found this way.

## App Platform Basics

```bash
doctl apps list --context <ctx>                    # ID, Spec.Name, DefaultIngress, deployment IDs
doctl apps list-deployments <app-id>               # recent deployments: ID, Cause, Progress, Phase
doctl apps get <app-id> --format DefaultIngress,ActiveDeployment.Phase,InProgressDeployment.ID
doctl apps list-domains <app-id>                   # custom domains (there is no Domains column)
```

Most commands require the app UUID, not the name — get it from `doctl apps list`.

The `Cause` column tells you *why* a deployment happened: `commit <sha> pushed to <repo>` for git pushes vs `app spec updated` for config changes.

Deployment phases: `PENDING_BUILD` → `BUILDING` → `DEPLOYING` → `ACTIVE`. Terminal failure states: `ERROR`, `CANCELED`. `SUPERSEDED` means replaced by a newer deployment.

### Deploying

Apps connected to GitHub auto-deploy on push to the configured branch. To redeploy without a code change (config refresh, transient build failure):

```bash
doctl apps create-deployment <app-id> --format ID,Phase
```

### Waiting for a deployment

Poll bounded, with a fixed or escalating interval — never an unbounded `--follow`/watch in an agent context:

```bash
for i in $(seq 1 90); do
  PHASE=$(doctl apps get-deployment <app-id> <deployment-id> --format Phase --no-header | tr -d ' ')
  case "$PHASE" in
    ACTIVE) echo deployed; break;;
    ERROR|CANCELED|SUPERSEDED) echo "failed: $PHASE"; exit 1;;
  esac
  sleep 20
done
```

## Logs

```bash
doctl apps logs <app-id> --type run --tail 500          # bounded runtime logs
doctl apps logs <app-id> <component> --type build       # component is a POSITIONAL arg, not a flag
doctl apps logs <app-id> --type run --follow            # live tail (interactive use only)
```

- Log types: `build`, `deploy`, `run` (default). There is no `--component` flag — pass the component name as the second positional argument.
- Always use `--tail N` and grep (`| grep -iE 'error|timeout|oom'`) rather than dumping everything — run logs can contain live secrets.
- **Logs rotate on each deployment and retention is short.** Yesterday's crash logs are usually gone after today's deploy (unless log forwarding is configured). Capture logs immediately after triggering the thing you're observing.
- Run logs are only retrievable from the **active** deployment — `--deployment <old-id> --type run` fails with a 400 (`phase final_cleanup`). Build logs of older deployments are fine.
- A brand-new app has no logs until its first deployment starts (`no deployment found for app`).
- To tell a crash-restart from a deploy-restart, compare timestamps against `list-deployments` Created times.

## Output Formats: `--format`, `-o json`

- **Column names differ per subcommand** and doctl version. `apps list --format ActiveDeployment.Phase` fails (`unknown column`) — but the same column works on `apps get`. Nested names use dots (`Spec.Name`, not `SpecName`). On `unknown column`, fall back to `-o json | jq` rather than guessing.
- **`-o json` returns an array even for a single resource** — use `.[0].spec...`, not `.spec...`.
- **`apps spec get` always emits YAML** — it silently ignores `-o json`. Don't pipe it to a JSON parser.
- **A bad `--format` on a mutating command does NOT roll back the mutation.** `doctl apps update ... --format BadColumn` applies the update, then errors. Do not re-run the command — verify state instead.
- Empty fields render as the literal string `<nil>`; `--no-header` keeps column padding — `tr -d ' '` before string-comparing.
- `--http-retry-max` (global flag) auto-retries 429/5xx responses.

## Further Reading

- **App specs — env vars, secrets, creating apps**: see [spec-management.md](spec-management.md)
- **Databases, Spaces, droplets, DNS**: see [other-services.md](other-services.md)

## Contributing Back

This skill grows by capturing what it missed. If you just worked through something in this domain that this skill did not cover — an error you had to figure out, a behavior that contradicts what is documented above, a workflow knot — ask the user: **"Want me to contribute this back to the doctl skill?"**

If yes, run `/contribute-skill`. If that command is not available, do the equivalent inline: distill the generic lesson (placeholders only — no project names, IDs, domains, or secrets), then branch or fork [gallop-systems/agent-skills](https://github.com/gallop-systems/agent-skills) and open a PR editing this skill.
