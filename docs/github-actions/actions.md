# Composite Actions Reference

## `.github/actions/shopify-cli-install/action.yml`

Sets up Node and installs Shopify CLI.

Inputs:

- `node_version` (default `20`)
- `cli_version` (default `latest`)

## `.github/actions/shopify-theme-pull/action.yml`

Pulls theme files from Shopify.

Inputs:

- `store` (required)
- `theme_id` (required)
- `token` (required)
- `path` (default `./backup`)
- `nodelete` (`0`/`1`, default `1`)
- `ignore_csv` (comma-separated ignore globs, default empty)

Behavior:

- Runs `shopify theme pull ... --nodelete` into the provided path.

## `.github/actions/shopify-theme-push/action.yml`

Pushes a theme build to Shopify.

Inputs:

- `store` (required)
- `theme_id` (required)
- `token` (required)
- `path` (default `./dist`)
- `allow_live` (`0`/`1`, default `0`)
- `nodelete` (`0`/`1`, default `1`)
- `ignore` (default empty)

Behavior:

- Adds `--allow-live` only when `allow_live == 1`.
- Adds `--nodelete` only when `nodelete == 1`.


## `.github/actions/shopify-theme-backup/action.yml`

Backs up a Shopify theme into a local folder and optionally zips it.

Inputs:

- `store` (required)
- `theme_id` (required)
- `token` (required)
- `output_dir` (default `./backup`)
- `zip_output` (optional zip filename)

## `.github/actions/shopify-theme-create/action.yml`

Creates a new unpublished Shopify theme by duplicating a base theme.

Inputs:

- `store` (required)
- `base_theme_id` (required)
- `token` (required)
- `name` (required)

Outputs:

- `theme_id` (newly created theme id)

## `.github/actions/shopify-theme-delete/action.yml`

Deletes a Shopify theme by id.

Inputs:

- `store` (required)
- `theme_id` (required)
- `token` (required)

## `.github/actions/shopify-theme-lighthouse/action.yml`

Runs Shopify Lighthouse CI against a supplied theme root.

Inputs:

- `access_token` (required)
- `store` (required)
- `lhci_github_app_token` (required)
- `theme_root` (required)

## `.github/actions/iamota-helper-checkout/action.yml`

Checks out the centralized helper repository at the same ref as the running reusable workflow.

Inputs:

- `workflow_ref` (required, pass `${{ github.workflow_ref }}`)
- `repository` (default `iamota/iamota-github-actions`)
- `path` (default `.iamota-actions`)

Outputs:

- `ref` (resolved ref from `workflow_ref`)

## `.github/actions/npm-install/action.yml`

Runs npm install command when `package.json` exists.

Inputs:

- `working_directory` (default `.`)
- `install_command` (default `npm ci`)
- `if_package_json` (`1`/`0`, default `1`)

Outputs:

- `ran` (`true`/`false`)
- `has_package_json` (`true`/`false`)

## `.github/actions/webpack-build/action.yml`

Runs webpack build command when `webpack.config.js` exists.

Inputs:

- `working_directory` (default `.`)
- `build_command` (default `npx webpack --env target=${GITHUB_BRANCH}`)
- `if_webpack_config` (`1`/`0`, default `1`)

Outputs:

- `ran` (`true`/`false`)
- `has_webpack_config` (`true`/`false`)

## `.github/actions/zip-folder/action.yml`

Zips a folder to a target archive file.

Inputs:

- `folder` (required)
- `output` (required)

## `.github/actions/aws-s3-upload/action.yml`

Uploads a file to S3.

Inputs:

- `file` (required)
- `bucket` (required)
- `dest_path` (required)

## `.github/actions/github-artifact-upload/action.yml`

Uploads files/folders to GitHub Actions artifacts.

Inputs:

- `name` (required)
- `path` (required)
