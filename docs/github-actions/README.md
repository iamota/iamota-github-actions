# GitHub Actions Docs

This folder is the source of truth for shared automation maintained in `iamota-github-actions`.

## What Is In This Repo

### Reusable Workflows

- `.github/workflows/shopify-backup.yml`
- `.github/workflows/shopify-deploy.yml`
- `.github/workflows/shopify-backup-deploy.yml`
- `.github/workflows/shopify-json-sync-production.yml`
- `.github/workflows/shopify-json-sync-forward.yml`
- `.github/workflows/shopify-pr-preview.yml`
- `.github/workflows/shopify-sync-preview.yml` (legacy orchestration wrapper)
- `.github/workflows/shopify-warn-locale-edits.yml`
- `.github/workflows/shopify-warn-theme-settings-edits.yml`

### Internal Validation Workflow

- `.github/workflows/github-actions-lint.yml`

### Composite Actions

- `.github/actions/shopify-cli-install/action.yml`
- `.github/actions/shopify-cli-pull/action.yml`
- `.github/actions/shopify-cli-push/action.yml`
- `.github/actions/iamota-helper-checkout/action.yml`
- `.github/actions/npm-install/action.yml`
- `.github/actions/webpack-build/action.yml`
- `.github/actions/zip-folder/action.yml`
- `.github/actions/aws-s3-upload/action.yml`
- `.github/actions/github-artifact-upload/action.yml`

### Helper Scripts

- `.github/scripts/shopify/sync-shopify-json.mjs`
- `.github/scripts/common/json-read-field.mjs`
- `.github/scripts/github/github-api-lib.mjs`
- `.github/scripts/github/github-pr-comment-lib.mjs`
- `.github/scripts/github/github-pr-comment-marker-get.mjs`
- `.github/scripts/github/github-pr-comment-upsert.mjs`
- `.github/scripts/github/github-pr-guard-core.mjs`
- `.github/scripts/github/github-pr-guard-shopify-locale.mjs`
- `.github/scripts/github/github-pr-guard-shopify-theme-settings.mjs`

## Start Here

- [Consumer Setup Guide](./consumer-setup.md)
- [Workflows Reference](./workflows.md)
- [Composite Actions Reference](./actions.md)
- [Scripts Reference](./scripts.md)

## Architecture Contract

- Consumer repos call centralized reusable workflows only.
- Centralized workflows use composite actions for stateless primitives.
- Centralized workflows call script entrypoints for stateful orchestration logic.
- `*.mjs` libraries are internal implementation details; workflows should not call library files directly.
