# App Specs: Env Vars, Secrets, Creating Apps

The app spec is the single source of truth for an App Platform app's configuration (components, env vars, routes, instance sizes). Most config changes are a GET → edit → PUT round-trip.

## Changing Env Vars / Secrets (the standard workflow)

```bash
doctl apps spec get <app-id> > /tmp/spec.yaml
# edit /tmp/spec.yaml — add under the relevant service's envs:
#   - key: MY_SECRET
#     scope: RUN_AND_BUILD_TIME
#     type: SECRET
#     value: <plaintext>
doctl apps update <app-id> --spec /tmp/spec.yaml
rm /tmp/spec.yaml        # the temp file held plaintext secrets
```

Facts that matter:

- **`type: SECRET` values are submitted as plaintext and encrypted on ingest.** They read back as `EV[1:...]` blobs and can never be read back in plaintext via doctl.
- **Existing `EV[...]` blobs survive the round-trip unchanged** — you do not need to re-supply secret values when editing other parts of the spec.
- **DO encrypts whatever literal string you submit.** A placeholder like `VALUE_TO_SET` gets encrypted and deployed as the real value. Never put placeholder text in a SECRET value — keep the `EV[...]` blob or paste the real plaintext.
- **`apps update --spec` triggers a new deployment** (Cause: `app spec updated`). The update command's own output may show a blank `In Progress Deployment ID` even though a deployment was created — confirm with `doctl apps list-deployments <app-id> | head -3`.
- To verify a secret landed: `doctl apps spec get <app-id> | grep -A3 MY_SECRET` (expect an `EV[...]` value).
- To inspect env config without the YAML: `doctl apps get <app-id> -o json | jq '.[0].spec.services[0].envs[] | {key, scope, type}'` (note the `.[0]` — json output is an array).
- The only way to read a runtime env value is a console session into the running container — see "apps console" below.

Env `scope` values: `RUN_TIME`, `BUILD_TIME`, `RUN_AND_BUILD_TIME`. Env vars can live at the app level (shared) or per-component.

## Validating Specs: `--schema-only` for Update Specs

`doctl apps spec validate spec.yaml` calls the propose endpoint, which simulates app **creation**. A spec pulled from a live app fails validation with:

```
secret env value must not be encrypted before app is created
```

This is a false alarm — `apps update` accepts `EV[...]` values fine. To pre-validate a spec destined for `apps update`, use:

```bash
doctl apps spec validate spec.yaml --schema-only
```

Full (non-schema-only) validation is still useful for specs that will be passed to `apps create`.

## Creating an App

```bash
doctl apps create --spec .do/app.yaml --context <ctx> [--project-id <project-uuid>]
doctl projects list --format ID,Name        # to find the project ID
```

- Convention: keep a sanitized spec in the repo (e.g. `.do/app.yaml`) with SECRET keys listed but values empty; inject real values into a temp copy at create time and delete it after.
- Specs can also be piped inline: `doctl apps create --spec - <<'EOF' ... EOF` (same for `update`).
- **GitHub-access 400**: `POST /v2/apps: 400 ... GitHub user does not have access to <org>/<repo>` means the DigitalOcean GitHub App isn't installed/authorized on that org. This is fixed in the browser (GitHub → Settings → Applications), not via doctl — hand it to the user, then retry the create.
- `DefaultIngress` is empty (`<nil>`) until the first deployment goes ACTIVE. Fetch it afterward: `doctl apps get <app-id> --format DefaultIngress --no-header`.
- No logs exist until the first deployment starts.

## Instance Sizes / Pricing

```bash
doctl apps tier instance-size list
doctl apps tier instance-size list -o json | jq '[.[] | {slug, monthly: .usd_per_month_cost}] | sort_by(.monthly)'
```

Use the slug in the spec's `instance_size_slug`.

## apps console — Interactive Only

`doctl apps console <app-id> <component>` opens an ephemeral shell in a running component — the only way to read live secret values or poke the runtime environment. But:

- There is **no `--command` flag**, and piping stdin fails (`error setting terminal to raw mode: inappropriate ioctl for device`). It requires a real TTY.
- An agent cannot drive it. Hand the user the exact command to run themselves, or reproduce the container environment locally with `docker run` instead.
- Instances are ephemeral — nothing done in a console session persists.
