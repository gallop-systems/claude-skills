# Releases & Publishing

## Tags and GitHub releases

```bash
# Latest existing version tag, without a local checkout of all tags
git ls-remote --tags --refs --sort=-v:refname origin 'v*' | head -1

gh release create v<X.Y.Z> --target main --title "v<X.Y.Z>" --notes "$(cat <<'EOF'
## Changes
- ...
EOF
)"
```

## npm Trusted Publishing (OIDC, no NPM_TOKEN)

Publish from GitHub Actions with provenance and zero long-lived secrets:

1. On npmjs.com, configure the package's **Trusted Publisher**: the repo and the **exact workflow filename** (e.g. `release.yml`). The match is on the workflow file path — renaming the workflow breaks publishing.
2. The workflow job needs `permissions: id-token: write` and a registry-aware setup:

```yaml
permissions:
  contents: write
  id-token: write
steps:
  - uses: actions/checkout@v5
  - uses: actions/setup-node@v5
    with:
      node-version: 24
      registry-url: https://registry.npmjs.org
  - run: npm publish        # no NODE_AUTH_TOKEN needed
```

3. The published version must be new — Trusted Publishing doesn't bypass the "version already exists" check.
4. Verify provenance landed:

```bash
npm view <pkg> dist.attestations.provenance.predicateType
```

## release-please (tag/changelog automation)

Conventional commits (`feat:`, `fix:`, `chore(release):` etc.) drive everything: release-please opens/updates a release PR collecting changes; merging that PR creates the tag + GitHub release, which triggers the publish workflow. With this in place, never hand-create tags — just merge the release PR.

## Bootstrapping a repo

```bash
gh repo create <owner>/<name> --private --source=. --remote=origin --push [--description "..."]
```

If the push step fails inside this compound command (often a pre-push hook), the repo was still created — push separately and read the real error (see SKILL.md on hook noise).
