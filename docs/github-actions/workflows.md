# Workflows Reference

## Multi-Store Contract

Store-aware workflows use the same resolution model:

- `SHOPIFY_STORE` accepts:
  - single store string: `store1` or `store1.myshopify.com`
  - JSON array: `["store1","store2"]` (must be valid JSON)
- Store-scoped values can be JSON objects keyed by slug or full host:
  - `{"store1":"123","store2":"456"}`
  - `{"store1.myshopify.com":"123","store2.myshopify.com":"456"}`
- Non-object values are treated as scalars and applied to all stores.
- Theme-id inputs also support the alias `live` (resolved to current main theme id at runtime).

Resolution behavior:

- `shopify-theme-backup`, `shopify-theme-deploy`, `shopify-theme-backup-deploy`, `shopify-theme-preview`, and lighthouse in `shopify-theme-ci` run as store matrix jobs.
- `shopify-json-sync-production` and `shopify-json-sync-dev` use the first resolved store as the master source.

## Reusable Workflows

### `.github/workflows/github-warn-merge-conflicts.yml`

Purpose:

- Detect merge conflicts on PRs (and related branch activity).
- Create/update bot comments when conflict state changes.
- Fail the run when conflicts exist.

Inputs: none  
Secrets: none

### `.github/workflows/github-warn-possible-conflicts.yml`

Purpose:

- Scan active branches for probable overlap against the current branch.
- Open/update tracking issues with candidate conflict files and snippets.
- Reconcile and close stale tracking issues when the branch pair no longer overlaps or one branch has been deleted.

Inputs: none  
Secrets: none

### `.github/workflows/shopify-theme-backup.yml`

Purpose:

- Pull Shopify theme files and produce timestamped backups.
- Optionally upload backup zips to S3.

Inputs:

- `branch` (required)
- `SHOPIFY_STORE` (optional, but required at runtime)
- `SHOPIFY_THEME_ID` (required)
- `aws_region` (optional, default `us-west-2`)
- `aws_s3_bucket` (optional)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `AWS_ACCESS_KEY_ID` (optional)
- `AWS_SECRET_ACCESS_KEY` (optional)

### `.github/workflows/shopify-theme-deploy.yml`

Purpose:

- Build/prepare theme output and deploy to Shopify.

Inputs:

- `branch` (required)
- `SHOPIFY_STORE` (optional, but required at runtime)
- `SHOPIFY_THEME_ID` (required)
- `theme_root` (optional, default repo root)
- `theme_src` (optional)
- `theme_dist` (optional)
- `build_install_command` (optional, default `npm ci`)
- `build_command` (optional, default `npx webpack --env target=${GITHUB_BRANCH}`)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)

Notes:

- Uses `shopify-theme-prepare` to auto-resolve effective output path.
- `--allow-live` enabled only for production/prod branch names.
- Deletes are blocked by default; enabled only if commit message contains `[Allow Delete]`.

### `.github/workflows/shopify-theme-ci.yml`

Purpose:

- Central CI pipeline for theme quality checks.

Inputs:

- Build roots: `theme_root`, `theme_src`, `theme_dist`, `build_install_command`, `build_command`
- Store metadata: `shopify_store`, `shopify_theme_id`
- Lighthouse mode: `lighthouse_align_with_production_json`
- Feature toggles: `run_theme_check`, `run_lint`, `run_test`, `run_lighthouse`
- Theme check tuning: `theme_check_fail_level`, `theme_check_config_path`, `theme_check_verbose`, `theme_check_auto_correct`

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (optional; needed for lighthouse alignment mode)
- `LHCI_GITHUB_APP_TOKEN` (optional; needed for lighthouse)

Notes:

- Prepare stage builds once; `theme_check`, `test`, and lighthouse consume the prepared output.
- Store-agnostic jobs run once; lighthouse runs per store when enabled.

### `.github/workflows/shopify-json-sync-production.yml`

Purpose:

- Pull JSON-oriented view of Shopify theme source.
- Sync remote JSON into `production_branch` and push commit when changed.

Inputs:

- `production_branch` (optional, default `production`)
- `theme_root` (optional, default repo root)
- `theme_src` (optional)
- `theme_pull_dir` (optional, default `_remote_theme`)
- `SHOPIFY_STORE` (optional, but required at runtime)
- `SHOPIFY_PRODUCTION_THEME_ID` (preferred)
- `SHOPIFY_THEME_ID` (fallback)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `IAMOTA_ACTIONS_READ_TOKEN` (optional, for private helper checkout)

### `.github/workflows/shopify-json-sync-dev.yml`

Purpose:

- Keep a sync PR from `production_branch` to `default_branch` up to date.
- Reuse/open PRs titled `Shopify JSON Sync...` and attempt to enable auto-merge.

Inputs:

- `production_branch` (optional)
- `default_branch` (optional)
- `shopify_store` (optional metadata)
- `shopify_theme_id` (optional metadata)
- `shopify_theme_name` (optional metadata)

Secrets: none

Notes:

- Uses `gh` + `GITHUB_TOKEN`; caller must grant `contents: write` + `pull-requests: write`.
- Auto-merge success still depends on repository Actions permissions.

### `.github/workflows/shopify-theme-preview.yml`

Purpose:

- PR preview lifecycle per store: resolve/create preview theme, optional backup, build/push, comment sync, and cleanup on close.

Inputs:

- `production_branch` (optional)
- `theme_root`, `theme_src`, `theme_dist`
- `build_install_command`, `build_command`
- `enable_preview_backup`
- `aws_region`, `aws_s3_bucket`
- `shopify_ignore`
- `SHOPIFY_STORE`
- `SHOPIFY_THEME_ID` (optional metadata)
- `SHOPIFY_PRODUCTION_THEME_ID` (fallback source)
- `SHOPIFY_PREVIEW_BASE_THEME_ID` (preferred source/base)

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (required)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (optional)
- `IAMOTA_ACTIONS_READ_TOKEN` (optional)

Notes:

- Per-store marker comments prevent cross-store preview ID collisions.
- Cleanup posts a new historical cleanup comment and clears marker theme_id for reopen freshness.
- Cleanup tolerates missing/deleted preview themes.

### `.github/workflows/shopify-warn-locale-edits.yml`

Purpose:

- Guard PRs touching locale JSON files.

Inputs:

- `ack_label` (optional, default `I will manually deploy locales`)

Secrets:

- `IAMOTA_ACTIONS_READ_TOKEN` (optional)

### `.github/workflows/shopify-warn-theme-settings-edits.yml`

Purpose:

- Guard PRs touching `config/settings_data.json`.

Inputs:

- `ack_label` (optional, default `I will manually deploy theme settings`)

Secrets:

- `IAMOTA_ACTIONS_READ_TOKEN` (optional)

## Internal Validation

### `.github/workflows/github-actions-lint.yml`

Purpose:

- Runs `actionlint` and `node --check` on `.github/scripts/**/*.mjs` for this repo.

## Internal Release

### `.github/workflows/release-semver-tags.yml`

Purpose:

- Auto-tag pushes on release branches named `v<major>.<minor>`.
- Create immutable patch tags (`v1.0.0`, `v1.0.1`, ...).
- Move floating line tag (`v1.0`) to latest patch in that line.
- Move floating major tag (`v1`) to highest semantic version across all `v1.*.*` tags.

Inputs: none
Secrets: none

Notes:

- Runs on pushes to branches matching `v*.*`.
- Supports release branch names `v<major>.<minor>` and `release/v<major>.<minor>`.
- Validation enforces canonical version format: `v<major>.<minor>`.
- Runs release ref guard script before tagging and fails when internal `@vN` refs conflict with branch major.
- On mismatch, creates/updates a repository issue with file/line details.
- Uses `contents: write` to create immutable tags and force-update floating tags.
