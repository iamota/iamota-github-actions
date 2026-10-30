# Security

These workflows run with client and iamota credentials (Shopify, Fly, AWS, GitHub Packages), so they are hardened as supply-chain code. This page lists what the workflows do, what callers must do, and the GitHub settings that complete the protection. The settings are not code: an org or repo admin must apply them.

## What the workflows do

- **Third-party actions are pinned to full commit SHAs** with a `# vX.Y.Z` comment, never a tag or branch (`setup-flyctl` was on `@master`). Bump them deliberately, to a release at least 14 days old.
- **Every reusable workflow declares `permissions: {}`**, and each job grants only what it uses. Jobs that only compute values get `{}`, checkouts get `contents: read`, and write scopes stay on the jobs that comment, push or publish.
- **Checkouts use `persist-credentials: false`**, so the token isn't left in `.git/config` for later steps (dependency installs, Shopify CLI, theme scripts). Two exceptions keep it, each with a comment in place: `release-semver-tags.yml` pushes the bump commit and tags (that job runs no package code, and `npm version` runs with `--ignore-scripts`), and `github-warn-possible-conflicts.yml` runs `git fetch --all` with a read-only contents token. `shopify-json-sync-production.yml` now pushes with a token passed to that one `git push` only.
- **Secrets live on the steps that use them.** `FLY_API_TOKEN` is set only on the single stage-and-deploy step, the Shopify app tokens only on the `shopify app deploy` step (never during `npm install`), and `NODE_AUTH_TOKEN` with write scope only on `npm publish`.
- **`github-npm-publish.yml` keeps the publish token away from package code.** An unprivileged `build` job (`contents: read`, `packages: read`) runs `npm ci --ignore-scripts` (lockfile required), the build, the tests and `npm pack --ignore-scripts`. A `publish` job (`packages: write`) has no checkout or install: it checks the tarball's sha256 against the build job's and runs `npm publish <tarball> --ignore-scripts`. There is no provenance: npm `--provenance` works only with registry.npmjs.org, and artifact attestations for private repositories need GitHub Enterprise Cloud.
- **flyctl is pinned** (`flyctl_version`, currently `0.4.118`) instead of installing `latest`.

### Residual risk: internal composite actions follow `@v1`

The workflows call this repo's own composite actions as `iamota/iamota-github-actions/.github/actions/<name>@v1`, deliberately not by SHA. The release model moves the `v1` and `v1.0` tags on every release (`release-semver-tags.yml`), and `github-release-ref-guard.mjs` enforces `@vN` internal refs. A caller that pins a workflow by SHA therefore still runs the composites from the *latest* v1 release. Whoever can move `v1` can change what every caller runs. The tag rulesets below limit that to the release automation. A caller that needs full reproducibility should review the composites at the pinned release.

The multistore Shopify theme workflows resolve per-store secrets by computed name and export the resolved values to `$GITHUB_ENV`, so those values are visible to every later step in the job. Scoping them per step means restructuring the multistore resolution. That is out of scope here.

## What callers must do

1. **Pin the workflow** to an immutable release tag (`@v1.0.71`) or its commit SHA (`@<sha> # v1.0.71`) in repos that deploy to production or publish packages. `@v1` is acceptable for low-risk workflows (PR warnings, CI).
2. **Pass secrets explicitly**, never `secrets: inherit`, to `fly-deploy.yml`, `shopify-app-deploy.yml`, `github-npm-publish.yml` and `shopify-warn*.yml`. The multistore `shopify-theme-*` and `shopify-json-sync-production.yml` workflows read per-store secrets by computed name, which only `inherit` can supply. Keep those callers' repos free of unrelated secrets.
3. **Grant minimal `permissions:` on the calling job**, for example `contents: read` plus `packages: write` for publishing, or `pull-requests: write` for PR comments. Set `permissions: {}` at the top of the caller workflow.
4. **Pin third-party actions in your own wrappers by SHA**, and let Dependabot (with a 14-day `cooldown`) propose bumps.

## GitHub settings to apply (not applied by this change)

Apply these to `iamota/iamota-github-actions`. Apply the branch, tag and Actions items to the repos that publish or deploy as well (iamota-kit, iamota-migrate, the apps).

1. **Branch protection on `main` and `release/v*`:** require a pull request with at least one approving review (dismiss stale approvals, and require review from CODEOWNERS where present), require the status checks (actionlint and node-check here), block force pushes and deletions, and include administrators.
2. **Tag rulesets:**
   - `v*.*.*` (immutable releases): restrict updates and deletions, with no bypass actors.
   - `v*` floating tags (`v1`, `v1.0`): restrict deletions, and restrict updates to the release automation as the only bypass actor. That actor is GitHub Actions, or better a dedicated GitHub App used by `release-semver-tags.yml`. Restrict creation of new `v*` tags the same way.
   - In repos without floating tags (iamota-kit's `v0.9.0`-style tags), one `v*` ruleset restricting creation, update and deletion to maintainers (create only) is enough.
3. **Org default `GITHUB_TOKEN` permissions: read-only** (Organization → Actions → General → Workflow permissions → "Read repository contents and packages permissions"). Every workflow here declares what it needs.
4. **Disallow GitHub Actions from creating or approving pull requests**, at org level and in every repo that doesn't need it. Caveat: `shopify-json-sync-dev.yml` creates its sync PR with `GITHUB_TOKEN` and needs this setting in the repos that use it. Prefer moving it to a GitHub App token, then turn the setting off everywhere. Actions must never be able to approve.
5. **Allowed actions:** restrict to actions by GitHub, verified creators and an explicit allow-list (`superfly/flyctl-actions`, `shopify/lighthouse-ci-action`, `aws-actions/*`, `docker/*`, `iamota/*`), and require full-length commit SHA pinning where the plan offers it.
6. **Fork pull requests:** require approval for all outside collaborators before workflows run, and don't send secrets or write tokens to fork PR workflows.
7. **Access from other repos:** keep "Accessible from repositories in the 'iamota' organization" (needed by callers), and nothing wider.
