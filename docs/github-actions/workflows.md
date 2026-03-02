# Workflows Reference

## Reusable Workflows

### Multi-Store Inputs (Supported)

For store-aware workflows, you can pass:

- Scalar values: `SHOPIFY_STORE=store1.myshopify.com`
- CSV stores: `SHOPIFY_STORE=store1.myshopify.com,store2.myshopify.com`
- JSON array stores: `SHOPIFY_STORE=["store1.myshopify.com","store2.myshopify.com"]`
- Store-keyed values:
  - `SHOPIFY_THEME_ID={"store1.myshopify.com":"123","store2.myshopify.com":"456"}`
  - `CI_RUN_LIGHTHOUSE={"store1.myshopify.com":"true","store2.myshopify.com":"false"}`

Resolution rules:

- Backup/deploy/preview workflows run per store (matrix).
- JSON sync workflows use the first resolved store as the master source.
- Scalar values apply to all stores.

### `.github/workflows/github-warn-merge-conflicts.yml`

Purpose:

- Detect merge conflicts on PRs and push-related PRs.
- Post bot comments when conflicts appear and when they are resolved.

### `.github/workflows/github-warn-possible-conflicts.yml`

Purpose:

- Detect likely overlap/coordination risk across active branches.
- Open/update tracking issues with context and diff snippets.

### `.github/workflows/shopify-theme-backup.yml`

Purpose:

- Backup current Shopify theme
- Optionally upload backup zip to S3

Inputs:

- `branch` (required)
- `SHOPIFY_STORE` (required)
- `SHOPIFY_THEME_ID` (required)
- `aws_region` (default `us-west-2`)
- `aws_s3_bucket` (default empty)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `AWS_ACCESS_KEY_ID` (optional)
- `AWS_SECRET_ACCESS_KEY` (optional)

### `.github/workflows/shopify-theme-deploy.yml`

Purpose:

- Resolve build output and deploy theme to Shopify

Inputs:

- `branch` (required)
- `SHOPIFY_STORE` (required)
- `SHOPIFY_THEME_ID` (required)
- `theme_src` (default `.`)
- `theme_dist` (default empty; auto-resolves to `./dist` when webpack exists, otherwise `theme_src`)
- `build_install_command` (default `npm ci`)
- `build_command` (default `npx webpack --env target=${GITHUB_BRANCH}`)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)

Notes:

- Self-aware build behavior:
  - if repo root has `package.json`, runs install command
  - if repo root has `webpack.config.js`, runs build command
- `--allow-live` is enabled only on production/prod branch names.
- Deletes are blocked by default and enabled only when commit message contains `[Allow Delete]`.

### `.github/workflows/shopify-theme-backup-deploy.yml`

Purpose:

- Orchestrates backup then deploy with strict ordering (`deploy` needs `backup`)

Inputs:

- `branch` (required)
- `SHOPIFY_STORE` (required)
- `SHOPIFY_THEME_ID` (required)
- `theme_src` (default `.`)
- `theme_dist` (default empty; auto-resolves to `./dist` when webpack exists, otherwise `theme_src`)
- `build_install_command` (default `npm ci`)
- `build_command` (default `npx webpack --env target=${GITHUB_BRANCH}`)
- `aws_region` (default `us-west-2`)
- `aws_s3_bucket` (default empty)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `AWS_ACCESS_KEY_ID` (optional)
- `AWS_SECRET_ACCESS_KEY` (optional)

Notes:

- Thin orchestration layer that delegates to:
  - `shopify-theme-backup.yml`
  - `shopify-theme-deploy.yml`

### `.github/workflows/shopify-json-sync-production.yml`

Purpose:

- Pull remote production theme and sync JSON files into `production_branch`
- Commit and push JSON updates directly to production branch when changed

Inputs:

- `production_branch`
- `theme_src`, `theme_pull_dir`
- `SHOPIFY_STORE` (required; first store is the master source)
- `SHOPIFY_PRODUCTION_THEME_ID` (preferred) or `SHOPIFY_THEME_ID` (fallback)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)

Notes:

- Uses `sync-shopify-json.mjs` auto-discovery of top-level folders in pulled remote theme.

### `.github/workflows/shopify-json-sync-dev.yml`

Purpose:

- Monitors divergence between `production_branch` and `default_branch`
- Reuses and refreshes an existing generated `Shopify JSON Sync` PR when present
- Creates a new PR only when none exists for the branch pair
- Enables auto-merge on that PR

Inputs:

- `production_branch`, `default_branch`
- `shopify_store`, `shopify_theme_id`, `shopify_theme_name` (optional metadata; first store is used when multiple provided)

Notes:

- No Shopify credentials required.
- Safe to run on a schedule and/or manually.

### `.github/workflows/shopify-json-sync-manual.yml`

Purpose:

- Run on-demand JSON sync from a chosen Shopify source theme into a chosen target branch.

Inputs:

- `target_branch` (required)
- `source_theme_id` (required; scalar or store-keyed object, resolved from first store)
- `theme_src`, `theme_pull_dir`
- `SHOPIFY_STORE` (required; first store is the master source)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `IAMOTA_ACTIONS_READ_TOKEN` (optional for private helper checkout)

### `.github/workflows/shopify-theme-preview.yml`

Purpose:

- PR preview theme lifecycle (create/reuse/push/comment/cleanup)
- Creates preview from duplicated base theme, then pushes branch output

Inputs:

- `theme_src`, `theme_dist`
- `build_install_command`, `build_command`
- `enable_preview_backup`
- `aws_region`, `aws_s3_bucket`
- `shopify_ignore`
- `SHOPIFY_STORE` (required; supports multi-store matrix)
- `SHOPIFY_PREVIEW_BASE_THEME_ID` (preferred source + create base)
- `SHOPIFY_PRODUCTION_THEME_ID` (fallback source when preview base not set)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (optional)

Notes:

- Preview behavior:
  - resolves/creates preview theme per store using PR comment marker
  - builds theme output
  - pushes branch output to preview theme (including `shopify_ignore` when set)
- Backs up existing preview themes before overwrite when enabled.
- Uses shared comment marker helpers for create/update/cleanup.

### `.github/workflows/shopify-theme-ci.yml`

Purpose:

- Runs theme quality gates (theme check, lint, test, a11y, lighthouse).

Notes:

- Store-agnostic checks run once against prepared theme output.
- Lighthouse runs per resolved store when multi-store input is provided.

### `.github/workflows/shopify-warn-locale-edits.yml`

Purpose:

- PR guard for `src/locales/*.json` edits.
- Requires explicit acknowledgement label before passing.

Inputs:

- `ack_label` (default `I will manually deploy locales`)

### `.github/workflows/shopify-warn-theme-settings-edits.yml`

Purpose:

- PR guard for `config/settings_data.json` edits.
- Requires explicit acknowledgement label before passing.

Inputs:

- `ack_label` (default `I will manually deploy theme settings`)

## Recommended Direction

Use these workflows for all integrations:

- `shopify-theme-backup.yml` (backup-only entry point)
- `shopify-theme-deploy.yml` (deploy-only entry point)
- `shopify-theme-backup-deploy.yml`
- `shopify-json-sync-production.yml`
- `shopify-json-sync-dev.yml`
- `shopify-json-sync-manual.yml`
- `shopify-theme-preview.yml`
- `shopify-warn-locale-edits.yml`
- `shopify-warn-theme-settings-edits.yml`
