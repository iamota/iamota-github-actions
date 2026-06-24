# Node version baseline

**Current baseline: Node `24`.**

All CI/CD in this repo runs on a single pinned Node major. We pin (not
`lts/*`) so a new LTS line never silently changes a build — moving forward is a
deliberate, reviewable PR.

## Why 24 (and never below 22.1)

The Shopify CLI's entrypoint imports `module.enableCompileCache`, which only
exists in **Node >= 22.1**. On older Node (e.g. 20.x) the CLI dies at startup
with:

```
SyntaxError: The requested module 'node:module' does not provide an export named 'enableCompileCache'
```

`24` is the current Active LTS, so it's the baseline.

## How to bump the baseline

When moving to the next LTS (e.g. `26`), update **every** location below in one
PR, then cut a new `v1`-track release so consumers pick it up. Each site carries
a `# Node baseline — keep in sync with docs/github-actions/node-version.md`
marker comment.

### Source-of-truth defaults (inputs)

These set the default that flows into everything else:

- `.github/actions/shopify-cli-install/action.yml` — `node_version` default
- `.github/actions/node-modules-restore/action.yml` — `node_version` default
- `.github/workflows/shopify-app-ci.yml` — `node_version` input default
- `.github/workflows/shopify-app-deploy.yml` — `node_version` input default

### Hardcoded `setup-node` sites (theme + housekeeping workflows)

These call `actions/setup-node` with a literal `node-version`:

- `.github/workflows/shopify-theme-ci.yml`
- `.github/workflows/shopify-theme-deploy.yml`
- `.github/workflows/shopify-theme-preview.yml`
- `.github/workflows/shopify-warn.yml`
- `.github/workflows/shopify-warn-locale-edits.yml`
- `.github/workflows/shopify-warn-theme-settings-edits.yml`
- `.github/workflows/github-actions-lint.yml`

### Docs to keep in step

- `docs/github-actions/workflows.md`
- `docs/github-actions/actions.md`

### Quick audit

Find every Node version reference before/after a bump:

```bash
grep -rn 'node-version\|node_version' .github docs
```

Consumer repos can still override per-repo without waiting for a release by
setting the `node_version` input (e.g. via a `CI_NODE_VERSION` repo/Environment
variable wired into their wrapper) — but the baseline above is what ships by
default.
