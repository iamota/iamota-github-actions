# Tools

This folder contains local/operational utilities for the `iamota-github-actions` repository.

## Shopify CLI Compatibility Checks

Run `node --test tools/tests/shopify-cli-compatibility.test.mjs` from the repo root (Node and Bash required; Git Bash is supported on Windows). The tests exercise the action JSON parsers, live-theme resolution with a mocked CLI, installer version precedence with mocked commands, and variable wiring for every installation site. Workflow Sanity also runs these checks in CI.

## GitHub Actions Artifact and Log Usage Report

Script: `tools/github-actions-storage-report.mjs`

Purpose:

- Scans repositories in a GitHub organization.
- Collects Actions artifacts and sizes via `gh api`.
- Generates:
  - JSON report
  - text summary
  - HTML dashboard with trend and top contributors
- Estimates retention-policy impact, for example 90 days vs 75 days.

### Prerequisites

- GitHub CLI installed (`gh`)
- Authenticated with sufficient permissions (`gh auth login`)
- Access to org repositories and Actions artifacts

### Usage

From repo root:

```powershell
node tools/github-actions-storage-report.mjs --org iamota
```

Optional flags:

- `--current-retention-days 90`
- `--what-if-retention-days 75`
- `--threshold-gb 2`
- `--output-dir tools/reports/actions-storage-usage`
- `--max-repos 0` (0 means all repos)
- `--include-archived`
- `--resolve-workflows 300`
- `--top-repos 20`
- `--top-workflows 30`
- `--verbose`

### Output

Default output directory:

- `tools/reports/actions-storage-usage/report.json`
- `tools/reports/actions-storage-usage/summary.txt`
- `tools/reports/actions-storage-usage/dashboard.html`

### Notes

- The report directly measures artifact bytes from the GitHub REST API.
- GitHub log-byte usage is not exposed as a straightforward per-repo endpoint in this workflow, so the retention simulation is artifact-based and directional.
- The script includes org billing endpoint snapshots in the report for additional context.

## GitHub Actions Minutes (Compute) Usage Report

Script: `tools/github-actions-minutes-report.mjs`

Purpose: answer "which repos, workflows and jobs are eating the Actions budget?"

- **Billing layer (authoritative):** pulls `GET /organizations/{org}/settings/billing/usage` for the month and reports billed minutes, gross, included-minutes discount and net spend per repo and per day, a month-end projection against the budget, and a multi-month trend.
- **Attribution layer (estimate):** for the top N repos by billed minutes, fetches every workflow run and job in the month and rebuilds billed minutes the way GitHub bills them (each job rounded **up** to a whole minute, self-hosted runners free). Breaks spend down by workflow, job group (matrix legs combined) and trigger event, and shows how much of each workflow's bill is round-up rather than runtime.
- Reconciles the estimate against billing per repo so you can see how far to trust the breakdown.

### Prerequisites

- GitHub CLI (`gh`) authenticated as an org owner or billing manager (billing layer)
- `repo` scope for private repos (attribution layer)

### Usage

From repo root:

```powershell
node tools/github-actions-minutes-report.mjs --org iamota
```

Optional flags:

- `--month 2026-10` (default: current UTC month)
- `--trend-months 3`
- `--attribute-top 10` (0 = none)
- `--repo <name>` attribute specific repos instead of the top N (repeatable)
- `--no-attribution` billing layer only (a few API calls, seconds)
- `--budget-usd 50`
- `--concurrency 8`
- `--top-workflows 30`, `--top-jobs 30`
- `--output-dir tools/reports/actions-minutes-usage`
- `--verbose`

A full run with attribution over 10 repos takes a few minutes (one API call per workflow run).

### Output

- `tools/reports/actions-minutes-usage/report.json`
- `tools/reports/actions-minutes-usage/summary.txt`
- `tools/reports/actions-minutes-usage/dashboard.html`

### Notes

- Runs deleted before the report runs can't be attributed, so the estimate can undershoot billing; the reconciliation table shows coverage per repo.
- Runner OS is inferred from job labels; larger-runner SKUs are priced as Linux in the estimate (billing figures are unaffected).
- Public-repo minutes on standard runners are free and don't appear in billing.

## GitHub Actions Artifact Cleanup

Script: `tools/github-actions-artifact-cleanup.mjs`

Purpose:

- Find and optionally delete existing artifacts by name pattern across the org.
- Defaults to Shopify Theme CI transient artifacts:
  - `shopify-theme-ci-node-modules`
  - `shopify-theme-ci-root`
- Runs in dry-run mode by default.

### Usage

Dry-run preview:

```powershell
node tools/github-actions-artifact-cleanup.mjs --org iamota --older-than-days 2
```

Execute deletions:

```powershell
node tools/github-actions-artifact-cleanup.mjs --org iamota --older-than-days 2 --execute
```

Optional flags:

- `--repo <name>` to target one repo
- `--pattern <regex>` to override artifact name matching
- `--max-repos <n>` to limit scope
- `--include-archived`
- `--output-dir tools/reports/actions-artifact-cleanup`
- `--verbose`

Output files:

- `tools/reports/actions-artifact-cleanup/cleanup-summary.txt`
- `tools/reports/actions-artifact-cleanup/cleanup-report.json`
