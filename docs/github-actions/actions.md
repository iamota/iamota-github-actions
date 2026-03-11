# Composite Actions Reference

## GitHub Helpers

### `.github/actions/github-pr-comment-add/action.yml`

Adds a new PR comment.

Inputs:

- `repo` (required)
- `pr` (required)
- `body` (required)
- `scripts_root` (optional, default `.iamota-actions/.github/scripts/github`)

### `.github/actions/github-pr-comment-marker-get/action.yml`

Reads latest marker comment and extracts values.

Inputs:

- `repo` (required)
- `pr` (required)
- `marker` (required)
- `extract_regex` (optional)
- `refresh_after_comments` (optional)
- `scripts_root` (optional)

Outputs:

- `extracted_value`
- `should_refresh`
- `newer_comment_count`
- `raw_output`

### `.github/actions/github-pr-comment-marker-set/action.yml`

Creates/updates marker comment (or refreshes by threshold).

Inputs:

- `repo` (required)
- `pr` (required)
- `marker` (required)
- `body` (required)
- `refresh_after_comments` (optional)
- `scripts_root` (optional)

## Shopify Helpers

### `.github/actions/shopify-cli-install/action.yml`

Sets up Node and installs Shopify CLI.

Inputs:

- `node_version` (optional, default `20`)
- `cli_version` (optional, default `latest`)

### `.github/actions/shopify-theme-pull/action.yml`

Pulls theme files from Shopify.

Inputs:

- `store` (required)
- `theme_id` (required)
- `token` (required)
- `path` (optional, default `./backup`)
- `nodelete` (optional `0`/`1`, default `1`)
- `ignore_csv` (optional comma-separated globs)

Notes:

- `theme_id` supports literal IDs or `live` (resolved to current main theme id).

### `.github/actions/shopify-theme-push/action.yml`

Pushes theme files to Shopify.

Inputs:

- `store` (required)
- `theme_id` (required)
- `token` (required)
- `path` (optional, default `./dist`)
- `allow_live` (optional `0`/`1`, default `0`)
- `nodelete` (optional `0`/`1`, default `1`)
- `ignore` (optional)
- `json` (optional `0`/`1`, default `0`)

Notes:

- `theme_id` supports literal IDs or `live` (resolved to current main theme id).

Outputs:

- `raw_json` (when `json=1`)
- `preview_url` (when available)

### `.github/actions/shopify-theme-backup/action.yml`

Backs up a theme and optionally zips output.

Inputs:

- `store` (required)
- `theme_id` (required)
- `token` (required)
- `output_dir` (optional, default `./backup`)
- `zip_output` (optional)

Notes:

- `theme_id` supports literal IDs or `live` (resolved to current main theme id).

### `.github/actions/shopify-theme-create/action.yml`

Duplicates a base theme into a new preview theme.

Inputs:

- `store` (required)
- `base_theme_id` (required)
- `token` (required)
- `name` (required)

Outputs:

- `theme_id`

Notes:

- `base_theme_id` supports literal IDs or `live` (resolved to current main theme id).

### `.github/actions/shopify-theme-delete/action.yml`

Deletes a theme by ID.

Inputs:

- `store` (required)
- `theme_id` (required)
- `token` (required)
- `ignore_not_found` (optional, default `false`)

Outputs:

- `status` (`deleted` or `missing`)

Notes:

- `theme_id` supports literal IDs or `live` (resolved to current main theme id).

### `.github/actions/shopify-theme-check/action.yml`

Runs `shopify theme check`.

Inputs:

- `path` (required)
- `fail_level` (optional, default `error`)
- `config_path` (optional)
- `verbose` (optional `true`/`false`)
- `auto_correct` (optional `true`/`false`)

### `.github/actions/shopify-theme-prepare/action.yml`

Runs self-aware install/build and resolves effective theme output path.

Inputs:

- `theme_src` (optional, default `.`)
- `theme_dist` (optional)
- `theme_path` (optional legacy alias)
- `build_install_command` (optional)
- `build_command` (optional)

Outputs:

- `theme_dist_effective`
- `webpack_ran`
- `npm_install_ran`

### `.github/actions/shopify-theme-lighthouse/action.yml`

Runs Shopify Lighthouse CI action.

Inputs:

- `access_token` (required)
- `store` (required)
- `lhci_github_app_token` (required)
- `theme_root` (required)

### `.github/actions/shopify-multistore-matrix/action.yml`

Builds normalized store matrix from a single store string or JSON array.

Inputs:

- `stores` (required)
- `allow_empty` (optional, default `false`)

Outputs:

- `stores_json`
- `matrix_json`
- `first_store`

### `.github/actions/shopify-multistore-resolve-value/action.yml`

Resolves scalar/store-keyed value for a specific store.

Inputs:

- `store` (required)
- `raw` (optional)

Outputs:

- `value`

## Build and Artifact Helpers

### `.github/actions/npm-install/action.yml`

Runs install command when `package.json` exists.

Inputs:

- `working_directory` (optional, default `.`)
- `install_command` (optional, default `npm ci`)
- `if_package_json` (optional `1`/`0`, default `1`)

Outputs:

- `ran`
- `has_package_json`

### `.github/actions/webpack-build/action.yml`

Runs build command when `webpack.config.js` exists.

Inputs:

- `working_directory` (optional, default `.`)
- `build_command` (optional)
- `if_webpack_config` (optional `1`/`0`, default `1`)

Outputs:

- `ran`
- `has_webpack_config`

### `.github/actions/zip-folder/action.yml`

Zips a folder into an archive.

Inputs:

- `folder` (required)
- `output` (required)

### `.github/actions/aws-s3-upload/action.yml`

Uploads file to S3.

Inputs:

- `file` (required)
- `bucket` (required)
- `dest_path` (required)

### `.github/actions/github-artifact-upload/action.yml`

Uploads paths to Actions artifacts.

Inputs:

- `name` (required)
- `path` (required)

## Repo Checkout Helper

### `.github/actions/iamota-helper-checkout/action.yml`

Checks out helper repository at explicit ref.

Inputs:

- `workflow_ref` (optional fallback for ref extraction)
- `ref` (optional, default `main`)
- `token` (optional; needed for private cross-repo checkout)
- `repository` (optional, default `iamota/iamota-github-actions`)
- `path` (optional, default `.iamota-actions`)

Outputs:

- `ref` (resolved ref)
