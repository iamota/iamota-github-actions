# Scripts Reference

## Shopify Scripts

### `.github/scripts/shopify/shopify-theme-id-resolve.mjs`

Purpose:

- Resolves theme id inputs.
- Supports literal IDs and the alias `live`.

Behavior:

- When input is `live`, runs `shopify theme list --role main` and resolves the single main theme ID.
- Fails if zero or multiple main theme IDs are returned.

### `.github/scripts/shopify/sync-shopify-json.mjs`

Purpose:

- Synchronizes remote pulled Shopify JSON files into repository layout.
- Supports dry-run, duplicate basename handling, optional report output.

Primary environment variables:

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

## GitHub Scripts

### `.github/scripts/github/github-api-lib.mjs`

Shared GitHub API utilities:

- authenticated request helper
- pagination helper for REST list endpoints

### `.github/scripts/github/github-pr-comment-add.mjs`

Creates a new PR comment.

Arguments:

- `--repo`
- `--pr`
- `--body`

### `.github/scripts/github/github-pr-comment-lib.mjs`

Shared PR comment helpers:

- list PR comments
- exact marker matching
- regex value extraction
- marker comment sync logic (create/update/refresh)

### `.github/scripts/github/github-pr-comment-marker-get.mjs`

Reads latest matching marker comment and emits metadata JSON.

Supports:

- optional value extraction via regex (`--extract-regex`)
- staleness detection via comment threshold (`--refresh-after-comments`)

### `.github/scripts/github/github-pr-comment-marker-set.mjs`

Create/update/refresh marker comment.

Supports:

- `--refresh-after-comments N` to force a new marker comment when old marker has at least `N` newer comments.

### `.github/scripts/github/github-pr-guard-core.mjs`

Shared core for guard workflows:

- changed-file detection and formatting
- acknowledgement-label handling
- marker comment lifecycle

### `.github/scripts/github/github-pr-guard-shopify-locale.mjs`

Locale guard runner built on guard core.

Default acknowledgement label:

- `I will manually deploy locales`

### `.github/scripts/github/github-pr-guard-shopify-theme-settings.mjs`

Theme settings guard runner built on guard core.

Default acknowledgement label:

- `I will manually deploy theme settings`
