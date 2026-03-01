# Consumer Setup Guide

This guide shows how a project repository should consume shared workflows from `iamota/iamota-github-actions`.

## 1) Add Wrapper Workflows In The Consumer Repo

Use thin wrappers under `.github/workflows/` that call reusable workflows by version tag.

Example: deploy + backup wrapper

```yaml
name: Shopify Theme Backup & Deploy

on:
  push:
    branches: ["dev", "production"]

jobs:
  run:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-backup-deploy.yml@v1
    with:
      branch: ${{ github.ref_name }}
      theme_src: ${{ vars.THEME_SRC || '.' }}
      theme_dist: ${{ vars.THEME_DIST || '' }}
      build_install_command: ${{ vars.BUILD_INSTALL_COMMAND || 'npm ci' }}
      build_command: ${{ vars.BUILD_COMMAND || 'npx webpack --env target=${GITHUB_BRANCH}' }}
      aws_s3_bucket: ${{ vars.AWS_S3_BUCKET_SHOPIFY_BACKUPS || '' }}
      aws_region: ${{ vars.AWS_REGION || 'us-west-2' }}
    secrets:
      SHOPIFY_STORE: ${{ secrets.SHOPIFY_STORE }}
      SHOPIFY_THEME_ID: ${{ secrets.SHOPIFY_THEME_ID }}
      SHOPIFY_CLI_PARTNERS_TOKEN: ${{ secrets.SHOPIFY_CLI_PARTNERS_TOKEN }}
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

Example: split JSON sync + forward + preview wrappers

```yaml
name: Shopify JSON Sync (Production Branch)

on:
  schedule:
    - cron: "0 10 * * 1-5"
  workflow_dispatch: {}

jobs:
  run:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-json-sync-production.yml@v1
    with:
      production_branch: ${{ vars.PRODUCTION_BRANCH || 'production' }}
      theme_src: ${{ vars.THEME_SRC || 'src' }}
      theme_pull_dir: ${{ vars.THEME_PULL_DIR || '_remote_theme' }}
    secrets:
      SHOPIFY_STORE: ${{ secrets.SHOPIFY_STORE }}
      SHOPIFY_THEME_ID: ${{ secrets.SHOPIFY_THEME_ID }}
      SHOPIFY_CLI_PARTNERS_TOKEN: ${{ secrets.SHOPIFY_CLI_PARTNERS_TOKEN }}
```

```yaml
name: Shopify JSON Sync Dev

on:
  schedule:
    - cron: "5 12 * * 1"
  workflow_dispatch: {}

jobs:
  run:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-json-sync-dev.yml@v1
    with:
      production_branch: ${{ vars.PRODUCTION_BRANCH || 'production' }}
      default_branch: ${{ vars.DEFAULT_BRANCH || 'dev' }}
```

```yaml
name: Shopify PR Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, closed]

jobs:
  run:
    uses: iamota/iamota-github-actions/.github/workflows/shopify-pr-preview.yml@v1
    with:
      theme_src: ${{ vars.THEME_SRC || 'src' }}
      theme_dist: ${{ vars.THEME_DIST || '' }}
      theme_pull_dir: ${{ vars.THEME_PULL_DIR || '_remote_theme' }}
      build_install_command: ${{ vars.BUILD_INSTALL_COMMAND || 'npm ci' }}
      build_command: ${{ vars.BUILD_COMMAND || 'npx webpack --env target=${GITHUB_BRANCH}' }}
      enable_preview_backup: ${{ vars.ENABLE_PREVIEW_BACKUP || 'true' }}
      aws_s3_bucket: ${{ vars.AWS_S3_BUCKET_SHOPIFY_BACKUPS || '' }}
      aws_region: ${{ vars.AWS_REGION || 'us-west-2' }}
      shopify_ignore: ${{ vars.SHOPIFY_IGNORE || '' }}
    secrets:
      SHOPIFY_STORE: ${{ secrets.SHOPIFY_STORE }}
      SHOPIFY_THEME_ID: ${{ secrets.SHOPIFY_THEME_ID }}
      SHOPIFY_CLI_PARTNERS_TOKEN: ${{ secrets.SHOPIFY_CLI_PARTNERS_TOKEN }}
      SHOPIFY_PREVIEW_BASE_THEME_ID: ${{ secrets.SHOPIFY_PREVIEW_BASE_THEME_ID }}
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

## 2) Configure Required Secrets/Vars In Consumer Repo

Minimum Shopify secrets:

- `SHOPIFY_STORE`
- `SHOPIFY_THEME_ID`
- `SHOPIFY_CLI_PARTNERS_TOKEN`

Preview workflow additional secret:

- `SHOPIFY_PREVIEW_BASE_THEME_ID`

Optional AWS backup secrets/vars:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET_SHOPIFY_BACKUPS`
- `AWS_REGION`

Optional behavior vars:

- `THEME_SRC`
- `THEME_DIST`
- `THEME_PULL_DIR`
- `BUILD_INSTALL_COMMAND`
- `BUILD_COMMAND`
- `PRODUCTION_BRANCH`
- `DEFAULT_BRANCH`
- `ENABLE_PREVIEW_BACKUP`
- `SHOPIFY_IGNORE`
- `SHOPIFY_LOCALE_ACK_LABEL`
- `SHOPIFY_THEME_SETTINGS_ACK_LABEL`

## 3) Keep Versions Pinned

Use tag references (for example `@v1`) in consumer wrappers. Avoid `@main` in production repos unless you intentionally want immediate upstream changes.

## 4) Avoid Duplicate Triggers

When adopting centralized wrappers, remove old inlined workflows in the consumer repo that use the same triggers.
