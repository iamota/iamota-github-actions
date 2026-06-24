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
- Artifact retention: `ci_artifact_retention_days` (optional, default `1`; applies to transient CI handoff artifacts)
- Store metadata: `shopify_store`, `shopify_theme_id`
- Lighthouse mode: `lighthouse_align_with_production_json`
- Feature toggles: `run_theme_check`, `run_lint`, `run_test`, `run_lighthouse`
- Theme check tuning: `theme_check_fail_level`, `theme_check_config_path`, `theme_check_verbose`, `theme_check_auto_correct`
  `theme_check_fail_level` accepts Shopify values `error|suggestion|style` and aliases `warning->suggestion`, `info->style`.

Secrets:

- `SHOPIFY_THEME_ACCESS_TOKEN` (optional; needed for lighthouse alignment mode)
- `LHCI_GITHUB_APP_TOKEN` (optional; needed for lighthouse)

Notes:

- Prepare stage builds once; `theme_check`, `test`, and lighthouse consume the prepared output.
- Store-agnostic jobs run once; lighthouse runs per store when enabled.
- `ci_artifact_retention_days` controls retention for intermediate artifacts (`shopify-theme-ci-node-modules`, `shopify-theme-ci-root`) used to pass files between CI jobs.

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

## App Deploy Workflows

These deploy Shopify **apps** (not themes). Unlike the theme workflows, per-environment
structural config (app `client_id`, `application_url`, scopes, Fly app/region) lives in
committed `shopify.app.<env>.toml` / `fly.<env>.toml` files selected by `--config`, not in
GitHub Variables. GitHub Environments supply only the secrets. Branch-per-environment: the
caller passes `branch`, which pins the GitHub Environment of the same name. See iamota-ai
`instructions/dev/ci-cd.md`.

### `.github/workflows/shopify-app-deploy.yml`

Purpose:

- Publish a new Shopify app version (extensions + `shopify.app.toml` config) via `shopify app deploy`.

Inputs:

- `branch` (required) — pins the GitHub Environment and concurrency group.
- `config` (optional, default empty) — Shopify config name passed to `--config` (selects `shopify.app.<config>.toml`). Empty = single-environment app (uses committed `shopify.app.toml`). Multi-environment apps pass the branch name.
- `working_directory` (optional, default `.`)
- `install_command` (optional, default `npm install`) — `npm install`, not `npm ci` (Windows-generated lockfile + platform-specific optional deps).
- `node_version` (optional, default `24` — see [node-version.md](node-version.md))
- `cli_version` (optional, default `latest`)

Secrets:

- `SHOPIFY_CLI_PARTNERS_TOKEN` (required) — Partner org CLI token; authorizes non-interactive deploy.
- `SHOPIFY_API_KEY` (optional) — the app's `client_id`.

Notes:

- Stamps each app version with `--source-control-url` (commit) and a sanitized `--message` (commit message), so Partner Dashboard version history links back to the exact commit.
- `-f` skips the interactive confirmation (required for CI).

### `.github/workflows/fly-deploy.yml`

Purpose:

- Deploy a Fly.io-hosted app via `flyctl deploy --remote-only`.

Inputs:

- `branch` (required)
- `config` (optional, default empty) — environment token selecting `fly.<config>.toml` via `--config`. Empty = single-environment app (uses committed `fly.toml`). Multi-environment apps pass the branch name.
- `remote_only` (optional, default `true`) — build on Fly's remote builder (no local Docker daemon).
- `dockerhub_login` (optional, default `false`) — add a Docker Hub login step; set only when remote builds hit Docker Hub's anonymous pull rate limit.
- `dockerhub_username` (optional) — pair with the `DOCKERHUB_TOKEN` secret.

Secrets:

- `FLY_API_TOKEN` (required) — Fly deploy token scoped to the app.
- `SHOPIFY_API_KEY` (optional) — staged as a Fly secret for OAuth.
- `SHOPIFY_API_SECRET` (optional) — staged as a Fly secret for OAuth.
- `DOCKERHUB_TOKEN` (optional) — only when `dockerhub_login` is enabled.

Notes:

- Stages **only** the two universal Shopify secrets (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`) with `--stage`, so the app restarts once on the following `deploy`. App-specific runtime secrets (Stripe, Google, etc.) persist on the Fly app once set — set them once at provisioning with `fly secrets set`; they do not need re-staging on every deploy.
- A failed `deploy_shopify` does not roll back `deploy_fly` — the two jobs are independent by default. Add `needs: [deploy_shopify]` in the wrapper to gate Fly on a successful Shopify deploy.

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
