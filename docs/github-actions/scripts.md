# Scripts Reference

## Shopify Sync Script

### `.github/scripts/shopify/sync-shopify-json.mjs`

Purpose:

- Synchronizes remote pulled Shopify JSON files into repository layout.
- Supports dry-run, duplicate basename handling, optional report output.

Primary env vars:

- `THEME_PULL_DIR`
- `THEME_SRC`
- `ENABLE_DELETIONS`
- `DRY_RUN`
- `ON_DUPLICATE_BASENAME`
- `REQUIRE_REPO_BASE_EXISTS`
- `WRITE_REPORT`
- `REPORT_PATH`

Output:

- Prints compact totals JSON.
- Optionally writes detailed report JSON when `WRITE_REPORT=true`.

## Common Scripts

### `.github/scripts/common/json-read-field.mjs`

Reads JSON from stdin and prints a value by dotted path.

Inputs:

- `--path <dotted.path>`
- `--required <true|false>` (default false)

## GitHub Helper Scripts

### `.github/scripts/github/github-api-lib.mjs`

Shared GitHub API primitives:

- authenticated request helper
- paginated GET traversal (Link header support)

### `.github/scripts/github/github-pr-comment-lib.mjs`

Shared PR comment helpers:

- list PR comments
- marker matching
- value extraction
- marker upsert with refresh threshold support

### `.github/scripts/github/github-pr-comment-marker-get.mjs`

Finds the latest marker comment and returns metadata JSON.

Supports:

- optional value extraction via regex (`--extract-regex`)
- staleness detection by comment count (`--refresh-after-comments`)

### `.github/scripts/github/github-pr-comment-upsert.mjs`

Creates or updates a marker-based PR comment for idempotent bot messaging.

Supports:

- optional comment refresh via `--refresh-after-comments N`:
  creates a new marker comment when existing marker has at least `N` newer comments.

### `.github/scripts/github/github-pr-guard-core.mjs`

Shared utility library for PR guard scripts.

Responsibilities:

- guard flow orchestration (build body, label checks, compare logic)
- marker comment cleanup/upsert via shared comment library
- stale acknowledgement label removal
- standardized diff snippet rendering

### `.github/scripts/github/github-pr-guard-shopify-locale.mjs`

Locale guard runner built on `github-pr-guard-core.mjs`.

Guarded files:

- `^src/locales/.*\.json$`

Default acknowledgement label:

- `I will manually deploy locales`

### `.github/scripts/github/github-pr-guard-shopify-theme-settings.mjs`

Theme settings guard runner built on `github-pr-guard-core.mjs`.

Guarded files:

- `^(src/)?config/settings_data\.json$`

Default acknowledgement label:

- `I will manually deploy theme settings`
