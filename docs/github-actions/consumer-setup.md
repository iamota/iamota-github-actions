# Consumer Setup Guide

This guide explains how project repos should consume `iamota/iamota-github-actions` reusable workflows.

## 1) Enable Cross-Repo Actions Access

### In `iamota/iamota-github-actions` (shared repo)

- `Settings` -> `Actions` -> `General`
- Under Access, enable:
  - `Accessible from repositories in the 'iamota' organization`

### In each consumer repo

- `Settings` -> `Actions` -> `General`
- Allow reusable workflows/actions usage per your policy.
- Under Workflow permissions:
  - enable `Read and write permissions`
  - enable `Allow GitHub Actions to create and approve pull requests` (needed by sync-dev auto-merge flow)

## 2) Configure Secrets and Variables

### Required baseline

Repository/org variables:

- `SHOPIFY_STORE`

Repository/org secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN`

### Common additional variables

- `THEME_ROOT`
- `SHOPIFY_THEME_ID`
- `SHOPIFY_PRODUCTION_THEME_ID`
- `SHOPIFY_PREVIEW_BASE_THEME_ID`
- `THEME_SRC`
- `THEME_DIST`
- `THEME_PULL_DIR`
- `BUILD_INSTALL_COMMAND`
- `BUILD_COMMAND`
- `PRODUCTION_BRANCH`
- `DEFAULT_BRANCH`
- `SHOPIFY_IGNORE`
- `ENABLE_PREVIEW_BACKUP`
- `AWS_S3_BUCKET_SHOPIFY_BACKUPS`
- `AWS_REGION`

### Common additional secrets

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `LHCI_GITHUB_APP_TOKEN`
- `IAMOTA_ACTIONS_READ_TOKEN` (recommended when consuming private shared repo helpers)

Token note:

- `IAMOTA_ACTIONS_READ_TOKEN` can be a fine-grained PAT with `Contents: Read` for `iamota/iamota-github-actions` (or broader org coverage if preferred).

## 3) Multi-Store Value Format

Use strict JSON for multi-store values.

Valid:

- `SHOPIFY_STORE=store1`
- `SHOPIFY_STORE=["store1","store2"]`
- `SHOPIFY_THEME_ID={"store1":"123","store2":"456"}`
- `SHOPIFY_THEME_ID=live` (resolve store main theme at runtime)

Invalid:

- `SHOPIFY_STORE=store1,store2`
- `SHOPIFY_STORE=[store1,store2]`
- `SHOPIFY_THEME_ID={store1:123,store2:456}`

Notes:

- Store keys may be slug or full host.
- Single scalar values apply to all stores.

## 4) Input Name Casing Is Strict

Reusable workflow input names are case-sensitive. Keep wrapper `with:` keys exactly aligned:

- Uppercase examples: `SHOPIFY_STORE`, `SHOPIFY_THEME_ID`
- Lowercase examples (some workflows): `shopify_store`, `shopify_theme_id`

## 5) Add Thin Wrapper Workflows In Consumer Repo

Keep wrappers in the project repo under `.github/workflows/` and call centralized reusable workflows.

### Example: Theme Backup + Deploy

```yaml
name: Shopify Theme Backup + Deploy

on:
  push:
    branches: ["dev", "production"]

permissions:
  contents: read

jobs:
  backup:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-theme-backup.yml@v1
    with:
      branch: ${{ github.ref_name }}
      SHOPIFY_STORE: ${{ vars.SHOPIFY_STORE || '' }}
      SHOPIFY_THEME_ID: ${{ vars.SHOPIFY_THEME_ID || '' }}
      aws_s3_bucket: ${{ vars.AWS_S3_BUCKET_SHOPIFY_BACKUPS || '' }}
      aws_region: ${{ vars.AWS_REGION || 'us-west-2' }}
    secrets:
      SHOPIFY_THEME_ACCESS_TOKEN: ${{ secrets.SHOPIFY_THEME_ACCESS_TOKEN }}
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

  deploy:
    needs: [backup]
    uses: iamota/iamota-github-actions/.github/workflows/shopify-theme-deploy.yml@v1
    with:
      branch: ${{ github.ref_name }}
      SHOPIFY_STORE: ${{ vars.SHOPIFY_STORE || '' }}
      SHOPIFY_THEME_ID: ${{ vars.SHOPIFY_THEME_ID || '' }}
      theme_root: ${{ vars.THEME_ROOT || '' }}
      theme_src: ${{ vars.THEME_SRC || '' }}
      theme_dist: ${{ vars.THEME_DIST || '' }}
      build_install_command: ${{ vars.BUILD_INSTALL_COMMAND || 'npm ci' }}
      build_command: ${{ vars.BUILD_COMMAND || 'npx webpack --env target=${GITHUB_BRANCH}' }}
    secrets:
      SHOPIFY_THEME_ACCESS_TOKEN: ${{ secrets.SHOPIFY_THEME_ACCESS_TOKEN }}
```

### Example: App Deploy (Shopify + Fly)

For Shopify **app** repos (not themes). Per-environment app IDs/URLs/scopes live in the
committed `shopify.app[.<env>].toml` / `fly[.<env>].toml`; GitHub Environments supply only
the secrets below. Single-environment shown (no `config`); for a multi-environment app add
the branch to `on.push` and pass `config: ${{ github.ref_name }}` to both jobs. Omit the
`deploy_fly` job for apps that are not Fly-hosted.

```yaml
name: Deploy App

on:
  push:
    branches: ["dev"]   # add "production" for a multi-env app

permissions:
  contents: read

jobs:
  deploy_shopify:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-app-deploy.yml@v1
    with:
      branch: ${{ github.ref_name }}
      # config: ${{ github.ref_name }}   # multi-env only
    secrets: inherit

  deploy_fly:
    uses: iamota/iamota-github-actions/.github/workflows/fly-deploy.yml@v1
    with:
      branch: ${{ github.ref_name }}
      # config: ${{ github.ref_name }}   # multi-env only
      # dockerhub_login: 'true'          # only if hitting Docker Hub pull limits
      # dockerhub_username: ${{ vars.DOCKERHUB_USERNAME }}
    secrets: inherit
```

Per **GitHub Environment** (one named for each deploy branch), provide the secrets:

- `SHOPIFY_APP_AUTOMATION_TOKEN` — **preferred.** App-scoped automation token (Partner Dashboard → the app → CLI credentials); authorizes `shopify app deploy` non-interactively with least privilege.
- `SHOPIFY_CLI_PARTNERS_TOKEN` — legacy fallback only, used when `SHOPIFY_APP_AUTOMATION_TOKEN` isn't set. Partner-org-wide CLI token — don't add it to a new app.
- `SHOPIFY_API_KEY` — the app's `client_id`.
- `SHOPIFY_API_SECRET` — staged as a Fly secret for OAuth (Fly-hosted apps).
- `FLY_API_TOKEN` — Fly deploy token scoped to the app (Fly-hosted apps).
- `DOCKERHUB_TOKEN` *(optional)* — only if `dockerhub_login` is enabled; pair with a `DOCKERHUB_USERNAME` variable.

App-specific Fly runtime secrets (Stripe, Google, etc.) persist on the Fly app — set them
once with `fly secrets set`; they are not re-staged on every deploy.

### Example: JSON Sync Production

```yaml
name: Shopify JSON Sync Production

on:
  workflow_dispatch: {}
  schedule:
    - cron: "0 12-23 * * 1-5"
    - cron: "0 0-3 * * 2-6"

permissions:
  contents: write

jobs:
  run:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-json-sync-production.yml@v1
    with:
      production_branch: ${{ vars.PRODUCTION_BRANCH || 'production' }}
      theme_root: ${{ vars.THEME_ROOT || '' }}
      theme_src: ${{ vars.THEME_SRC || '' }}
      theme_pull_dir: ${{ vars.THEME_PULL_DIR || '_remote_theme' }}
      SHOPIFY_STORE: ${{ vars.SHOPIFY_STORE || '' }}
      SHOPIFY_PRODUCTION_THEME_ID: ${{ vars.SHOPIFY_PRODUCTION_THEME_ID || vars.SHOPIFY_THEME_ID || '' }}
    secrets:
      SHOPIFY_THEME_ACCESS_TOKEN: ${{ secrets.SHOPIFY_THEME_ACCESS_TOKEN }}
      IAMOTA_ACTIONS_READ_TOKEN: ${{ secrets.IAMOTA_ACTIONS_READ_TOKEN }}
```

### Example: JSON Sync Dev PR

```yaml
name: Shopify JSON Sync Dev

on:
  workflow_dispatch: {}
  schedule:
    - cron: "5 12 * * 1"

permissions:
  contents: write
  pull-requests: write

jobs:
  run:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-json-sync-dev.yml@v1
    with:
      production_branch: ${{ vars.PRODUCTION_BRANCH || 'production' }}
      default_branch: ${{ vars.DEFAULT_BRANCH || 'dev' }}
      shopify_store: ${{ vars.SHOPIFY_STORE || '' }}
      shopify_theme_id: ${{ vars.SHOPIFY_PRODUCTION_THEME_ID || vars.SHOPIFY_THEME_ID || '' }}
      shopify_theme_name: ${{ vars.SHOPIFY_THEME_NAME || '' }}
```

### Example: PR Preview

```yaml
name: Shopify Theme Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, closed]

permissions:
  contents: write
  pull-requests: write

jobs:
  run:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-theme-preview.yml@v1
    with:
      production_branch: ${{ vars.PRODUCTION_BRANCH || 'production' }}
      theme_root: ${{ vars.THEME_ROOT || '' }}
      theme_src: ${{ vars.THEME_SRC || '' }}
      theme_dist: ${{ vars.THEME_DIST || '' }}
      build_install_command: ${{ vars.BUILD_INSTALL_COMMAND || 'npm ci' }}
      build_command: ${{ vars.BUILD_COMMAND || 'npx webpack --env target=${GITHUB_BRANCH}' }}
      enable_preview_backup: ${{ vars.ENABLE_PREVIEW_BACKUP || 'true' }}
      aws_s3_bucket: ${{ vars.AWS_S3_BUCKET_SHOPIFY_BACKUPS || '' }}
      aws_region: ${{ vars.AWS_REGION || 'us-west-2' }}
      shopify_ignore: ${{ vars.SHOPIFY_IGNORE || '' }}
      SHOPIFY_STORE: ${{ vars.SHOPIFY_STORE || '' }}
      SHOPIFY_PRODUCTION_THEME_ID: ${{ vars.SHOPIFY_PRODUCTION_THEME_ID || vars.SHOPIFY_THEME_ID || '' }}
      SHOPIFY_PREVIEW_BASE_THEME_ID: ${{ vars.SHOPIFY_PREVIEW_BASE_THEME_ID || vars.SHOPIFY_PRODUCTION_THEME_ID || vars.SHOPIFY_THEME_ID || '' }}
    secrets:
      SHOPIFY_THEME_ACCESS_TOKEN: ${{ secrets.SHOPIFY_THEME_ACCESS_TOKEN }}
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      IAMOTA_ACTIONS_READ_TOKEN: ${{ secrets.IAMOTA_ACTIONS_READ_TOKEN }}
```

### Example: Publish An NPM Package To GitHub Packages

For library repos that ship an `@iamota/...` package privately to the org. The package must
be scoped (`"name": "@iamota/<pkg>"`) and should carry
`"publishConfig": { "registry": "https://npm.pkg.github.com" }` so a stray local `npm publish`
cannot reach the public registry. No PAT is needed — `permissions: packages: write` on the
wrapper job is what authorizes the publish.

The recommended shape pairs it with `release-semver-tags.yml` so the release-line
branch model works the same way it does in this repo: every push to
`release/v<major>.<minor>` bumps the patch version, tags it, and publishes. Ship a
minor by cutting a new line branch (`release/v2.1`) — no hand-edited versions.

```yaml
name: Release

on:
  push:
    branches:
      - "release/v*.*"
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
        default: true

permissions:
  contents: read

jobs:
  tag:
    if: github.event_name == 'push'
    uses: iamota/iamota-github-actions/.github/workflows/release-semver-tags.yml@v1
    permissions:
      contents: write
      issues: write
    with:
      bump_package_version: "true"

  publish:
    needs: [tag]
    if: github.event_name == 'push' && needs.tag.outputs.tagged == 'true'
    uses: iamota/iamota-github-actions/.github/workflows/github-npm-publish.yml@v1
    permissions:
      contents: read
      packages: write
    with:
      # Publish the bump commit the tag job created, not the pushed commit.
      ref: ${{ needs.tag.outputs.tag }}
      expected_version: ${{ needs.tag.outputs.version }}

  publish_dry_run:
    if: github.event_name == 'workflow_dispatch'
    uses: iamota/iamota-github-actions/.github/workflows/github-npm-publish.yml@v1
    permissions:
      contents: read
      packages: write
    with:
      dry_run: ${{ inputs.dry_run }}
```

`ref` matters: without it the publish job would check out the pushed commit and
publish the pre-bump version. `expected_version` then fails the run loudly if the
wrong ref ever lands in the checkout.

For a repo that would rather cut releases by hand, drop the `tag` job and trigger
`github-npm-publish.yml` on `release: [published]` instead — its
`verify_version_matches_tag` guard keeps the release tag and `package.json` in step.

Consuming the published package from another repo or a developer machine needs an `.npmrc`
pointing the scope at GitHub Packages, with a token carrying `read:packages`:

```ini
@iamota:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

In CI, `secrets.GITHUB_TOKEN` covers same-repo reads; cross-repo reads need
`IAMOTA_ACTIONS_READ_TOKEN` (or another fine-grained PAT with `Packages: Read`).

## 6) Common Wrapper Set To Enable

Most Shopify repos should wire these wrappers:

- `shopify-theme-backup.yml`
- `shopify-theme-deploy.yml`
- `shopify-theme-ci.yml`
- `shopify-theme-preview.yml`
- `shopify-json-sync-production.yml`
- `shopify-json-sync-dev.yml`
- `shopify-warn-locale-edits.yml`
- `shopify-warn-theme-settings-edits.yml`
- `github-warn-merge-conflicts.yml`
- `github-warn-possible-conflicts.yml`

## 7) Caller Workflow Permissions Must Match

If reusable workflow validation fails with permission errors, set explicit permissions in the consumer wrapper job/workflow.

Examples:

- Sync workflows need `contents: write`
- PR-commenting workflows need `pull-requests: write`
- `github-npm-publish.yml` needs `packages: write`

## 8) Version Pinning Strategy

- Use stable tags (`@v1`) for production repositories.
- Use stable tags (for example `@v1`) for production repositories.
- After validating branch changes, cut/update the release tag used by consumers.

## 9) Remove Legacy Overlapping Workflows

When adopting centralized wrappers, remove older project-local workflows that use the same triggers and intent.
