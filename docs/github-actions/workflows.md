# Workflows Reference

## Reusable Workflows

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
- `aws_region` (default `us-west-2`)
- `aws_s3_bucket` (default empty)

Secrets:

- `SHOPIFY_STORE` (required)
- `SHOPIFY_THEME_ID` (required)
- `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `AWS_ACCESS_KEY_ID` (optional)
- `AWS_SECRET_ACCESS_KEY` (optional)

### `.github/workflows/shopify-theme-deploy.yml`

Purpose:

- Resolve build output and deploy theme to Shopify

Inputs:

- `branch` (required)
- `theme_src` (default `.`)
- `theme_dist` (default empty; auto-resolves to `./dist` when webpack exists, otherwise `theme_src`)
- `build_install_command` (default `npm ci`)
- `build_command` (default `npx webpack --env target=${GITHUB_BRANCH}`)

Secrets:

- `SHOPIFY_STORE` (required)
- `SHOPIFY_THEME_ID` (required)
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
- `theme_src` (default `.`)
- `theme_dist` (default empty; auto-resolves to `./dist` when webpack exists, otherwise `theme_src`)
- `build_install_command` (default `npm ci`)
- `build_command` (default `npx webpack --env target=${GITHUB_BRANCH}`)
- `aws_region` (default `us-west-2`)
- `aws_s3_bucket` (default empty)

Secrets:

- `SHOPIFY_STORE` (required)
- `SHOPIFY_THEME_ID` (required)
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

Secrets:

- `SHOPIFY_STORE`, `SHOPIFY_THEME_ID`, `SHOPIFY_THEME_ACCESS_TOKEN` (required)

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

Notes:

- No Shopify credentials required.
- Safe to run on a schedule and/or manually.

### `.github/workflows/shopify-theme-preview-pr.yml`

Purpose:

- PR preview theme lifecycle (create/reuse/push/comment/cleanup)
- PR drift enforcement between local merge result and remote JSON

Inputs:

- `theme_src`, `theme_dist`, `theme_pull_dir`
- `build_install_command`, `build_command`
- `enable_preview_backup`
- `aws_region`, `aws_s3_bucket`
- `shopify_ignore`

Secrets:

- `SHOPIFY_STORE`, `SHOPIFY_THEME_ID`, `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `SHOPIFY_PREVIEW_BASE_THEME_ID` (required)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (optional)

Notes:

- Preview deploy simulation behavior:
  - pulls full remote production theme into `_remote_theme`
  - applies JSON sync against `theme_src`
  - overlays `theme_dist` onto `_remote_theme` via `rsync` using `.shopifyignore` and `shopify_ignore`
  - pushes `_remote_theme` to preview theme
- Backs up existing preview themes before overwrite when enabled.
- Uses shared comment utility scripts for marker lookup/upsert.
- Fails PR check on merge conflicts and JSON drift.

### `.github/workflows/shopify-sync-preview.yml` (Legacy)

Purpose:

- Backward-compatible orchestration wrapper for the older combined interface.

Notes:

- Composes:
  - `shopify-json-sync-production.yml`
  - `shopify-json-sync-dev.yml`
  - `shopify-theme-preview-pr.yml`

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
- `shopify-theme-preview-pr.yml`
- `shopify-warn-locale-edits.yml`
- `shopify-warn-theme-settings-edits.yml`
