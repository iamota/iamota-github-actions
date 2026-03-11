# GitHub Actions Docs

This folder is the source of truth for shared automation maintained in `iamota-github-actions`.

## Current Inventory

### Reusable Workflows

- `.github/workflows/github-warn-merge-conflicts.yml`
- `.github/workflows/github-warn-possible-conflicts.yml`
- `.github/workflows/shopify-json-sync-dev.yml`
- `.github/workflows/shopify-json-sync-production.yml`
- `.github/workflows/shopify-theme-backup.yml`
- `.github/workflows/shopify-theme-backup-deploy.yml`
- `.github/workflows/shopify-theme-ci.yml`
- `.github/workflows/shopify-theme-deploy.yml`
- `.github/workflows/shopify-theme-preview.yml`
- `.github/workflows/shopify-warn-locale-edits.yml`
- `.github/workflows/shopify-warn-theme-settings-edits.yml`

### Internal Validation Workflow

- `.github/workflows/github-actions-lint.yml`

### Composite Actions

- `.github/actions/aws-s3-upload/action.yml`
- `.github/actions/github-artifact-upload/action.yml`
- `.github/actions/github-pr-comment-add/action.yml`
- `.github/actions/github-pr-comment-marker-get/action.yml`
- `.github/actions/github-pr-comment-marker-set/action.yml`
- `.github/actions/iamota-helper-checkout/action.yml`
- `.github/actions/npm-install/action.yml`
- `.github/actions/shopify-cli-install/action.yml`
- `.github/actions/shopify-multistore-matrix/action.yml`
- `.github/actions/shopify-multistore-resolve-value/action.yml`
- `.github/actions/shopify-theme-backup/action.yml`
- `.github/actions/shopify-theme-check/action.yml`
- `.github/actions/shopify-theme-create/action.yml`
- `.github/actions/shopify-theme-delete/action.yml`
- `.github/actions/shopify-theme-lighthouse/action.yml`
- `.github/actions/shopify-theme-prepare/action.yml`
- `.github/actions/shopify-theme-pull/action.yml`
- `.github/actions/shopify-theme-push/action.yml`
- `.github/actions/webpack-build/action.yml`
- `.github/actions/zip-folder/action.yml`

### Helper Scripts

- `.github/scripts/shopify/shopify-theme-id-resolve.mjs`
- `.github/scripts/shopify/sync-shopify-json.mjs`
- `.github/scripts/github/github-api-lib.mjs`
- `.github/scripts/github/github-pr-comment-add.mjs`
- `.github/scripts/github/github-pr-comment-lib.mjs`
- `.github/scripts/github/github-pr-comment-marker-get.mjs`
- `.github/scripts/github/github-pr-comment-marker-set.mjs`
- `.github/scripts/github/github-pr-guard-core.mjs`
- `.github/scripts/github/github-pr-guard-shopify-locale.mjs`
- `.github/scripts/github/github-pr-guard-shopify-theme-settings.mjs`

## Start Here

- [Consumer Setup Guide](./consumer-setup.md)
- [Workflows Reference](./workflows.md)
- [Composite Actions Reference](./actions.md)
- [Scripts Reference](./scripts.md)

## Architecture Contract

- Consumer repos call centralized reusable workflows.
- Reusable workflows orchestrate control flow and policy.
- Composite actions provide stateless reusable primitives.
- `*.mjs` scripts handle stateful orchestration and API logic.
- Libraries (`*lib.mjs`, `*core.mjs`) are internal implementation details.
