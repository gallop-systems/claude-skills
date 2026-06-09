# Template Anatomy & Testing Changes

## copier.yml settings

```yaml
_subdirectory: template        # only this dir is rendered; repo root holds copier.yml, test.sh, README
_templates_suffix: .jinja      # only .jinja files get substitution; everything else copies verbatim
_skip_if_exists:
  - ".env"                     # never clobber these on update
```

## Questions

```yaml
project_name:
  type: str
  validator: "{% if not project_name %}Required{% endif %}"
database_name:
  type: str
  default: "{{ project_name }}"     # defaults can reference earlier answers
include_ci:
  type: bool
  default: true
```

Feature toggles as `include_*` booleans defaulting `true` keep `copier copy --defaults` producing a fully-featured project.

## Conditional files via filename templating

A file named `{% if include_ci %}ci.yml{% endif %}.jinja` renders to `ci.yml` when the flag is true and to an empty filename (skipped) when false. This works for plain files too — the filename is always templated, only contents need the `.jinja` suffix.

## The self-rendering answers file

```
template/{{_copier_conf.answers_file}}.jinja
```

containing:

```yaml
# Changes here will be overwritten by Copier; NEVER EDIT MANUALLY
{{ _copier_answers|to_nice_yaml }}
```

This is what writes `.copier-answers.yml` into every descendant.

## Tasks

Gate scaffold-time tasks so they run on first copy only, never on update:

```yaml
_tasks:
  - command: createdb {{ database_name }}
    when: "{{ _copier_operation == 'copy' }}"
```

- **Task order is load-bearing**: anything importing generated artifacts must run after the generator (e.g. seed after codegen); `git init` before installing git hooks.
- Tasks needing env vars: `bash -c 'set -a && source .env && set +a && <cmd>'`.
- Tasks gated on a question flag: combine conditions in `when`.
- Prefer post-gen install tasks (e.g. `npx <tool> add ...`) over vendoring third-party files into the template — vendored copies go stale.

## Escaping `${{ }}` in templated GitHub workflows

Jinja eats GitHub Actions expressions in `.jinja` workflow files. Two working escapes:

```
{% raw %}${{ secrets.GITHUB_TOKEN }}{% endraw %}
${{ '{{' }} secrets.GITHUB_TOKEN {{ '}}' }}
```

`{% raw %}` blocks are cleaner when a whole region is Actions syntax; the inline form suits one-offs inside otherwise-templated lines.

## Testing template changes

A `test.sh` that generates a real project and runs its full gate:

```bash
tmp=$(mktemp -d)
trap 'dropdb --if-exists <test-dbs>; rm -rf "$tmp"' EXIT
uvx copier copy --trust --defaults --vcs-ref HEAD \
  --data project_name=smoke-test --data project_description=test \
  . "$tmp"
cd "$tmp" && yarn install && yarn lint && yarn fmt:check && yarn test:run
```

- **`--vcs-ref HEAD` tests committed HEAD instead of the last tag** — without it, copier renders the latest *tag* and your changes are silently absent.
- For *uncommitted* working-tree validation: `cp -r` the template to a temp dir, `rm -rf .git` in the copy, and `copier copy` from there.
- When the generated project reveals a bug, **fix it in `template/` source and re-render** — never only in the generated copy. Re-sync (`cp` the fixed file into the generated project) to re-verify without a full regeneration.
- Generating a project is also how template-level type/lint bugs get caught — run the descendant's typecheck against the freshly generated output as part of any nontrivial template PR, and say so in the PR body.
