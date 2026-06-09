---
name: copier-template
description: Maintain a Copier project template and propagate updates to generated ("descendant") repos. Covers template anatomy (copier.yml, jinja, tasks), testing template changes, tagging/releasing versions, the automated update-notification PR pattern, and applying copier update in descendants with conflict resolution.
---

# Copier Template Maintenance & Propagation

Patterns for the full lifecycle of a [Copier](https://copier.readthedocs.io/) project template: authoring changes, testing them, releasing versions, and rolling updates out to every repo generated from the template.

## When to Use This Skill

- Editing the template repo (questions, scaffold files, tasks, CI)
- "Upstream this pattern to the template" — porting something proven in a descendant
- Tagging/releasing a new template version
- Applying a template update in a descendant repo (often via an automated "template update available" PR)
- Debugging `copier copy`/`copier update` failures

## Mental Model

- The **template repo** holds `copier.yml` (questions + settings + tasks) and a `template/` subdirectory of scaffold files (some `.jinja`-suffixed for substitution). **Git tags (`v*`) are the version protocol**; GitHub Releases are the changelog protocol.
- Each **descendant** carries `.copier-answers.yml` recording its answers and `_commit: vX.Y.Z` — the template version it's on. Never hand-edit this file; `copier update` maintains it.
- `copier update` re-renders from old-tag → newest tag and three-way merges against local changes. **It always jumps to the latest tag** (unless `--vcs-ref` pins one) — a notification PR advertising v1.5.0 may actually land v1.8.0 if the template moved on.
- Run copier via `uvx copier ...` (no global install needed). Templates with `_tasks` require `--trust` — without it copier refuses to render at all. Non-interactive contexts also need `--defaults` (and `--data key=value` for required questions without defaults).

## Direction of Change

**Prove patterns in a real descendant first, then upstream.** Build and merge the feature in one generated project; once proven, port it into `template/` with jinja-aware adaptations. The upstream PR body should cite the originating repo/PR and include validation evidence (a project generated from the branch passing typecheck/lint/tests). Exception: infra-only changes (CI jobs, hooks config) can go straight to the template. For risky changes, stage the rollout — hand-run script in one repo first, graduate to the template once the win is proven.

When working in a descendant and a fix belongs in the template too: fix the symptom locally *and* make the corresponding change in the template repo (verify you have the right repo with `git remote -v` — don't trust the directory name).

## Releasing a Template Version

After merging to the template's main:

```bash
git checkout main && git pull --ff-only
git tag --sort=-v:refname | head -5          # see existing versions
git cat-file -t v<latest>                     # match the tag type convention (lightweight vs annotated)
git tag v<X.Y.Z> && git push origin v<X.Y.Z>
gh release create v<X.Y.Z> --title "v<X.Y.Z> — <summary>" --notes "$(cat <<'EOF'
## Changes
- ...

## Upgrading
Run `uvx copier update --trust --defaults` in your project.

Full diff: <template-repo-url>/compare/v<prev>...v<X.Y.Z>
EOF
)"
```

- Semver: patch = fixes/dep bumps; minor = new features, questions, or components; major = breaking structure changes.
- **Always create the GitHub Release, not just the tag.** Descendant notification PRs link to `/releases/tag/<version>` — a tag without a release produces dead links downstream.

## Automated Update Notification

The template ships its descendants a checker workflow (daily cron + `workflow_dispatch`) that compares `.copier-answers.yml`'s `_commit` against the template's highest remote tag:

```bash
git ls-remote --tags --refs --sort=-v:refname <template-url> 'v*' | head -1
```

If newer, it pushes a **static branch name** (e.g. `chore/template-update`) with an `--allow-empty` commit and opens a PR whose body contains the version delta, release-notes/compare links, and step-by-step instructions an agent can execute. Hard-won details to keep if reimplementing: an explicit `permissions: contents: write, pull-requests: write` block (default token can't open PRs), a static branch name (dated branches caused duplicate PRs), and comparing **tag versions, not commit SHAs**.

## Further Reading

- **Template anatomy & testing changes**: [template-authoring.md](template-authoring.md)
- **Applying an update in a descendant** (the conflict-resolution procedure): [applying-updates.md](applying-updates.md)

## Contributing Back

This skill grows by capturing what it missed. If you just worked through something in this domain that this skill did not cover — an error you had to figure out, a behavior that contradicts what is documented above, a workflow knot — ask the user: **"Want me to contribute this back to the copier-template skill?"**

If yes, run `/contribute-skill`. If that command is not available, do the equivalent inline: distill the generic lesson (placeholders only — no project names, IDs, domains, or secrets), then branch or fork [gallop-systems/agent-skills](https://github.com/gallop-systems/agent-skills) and open a PR editing this skill.
