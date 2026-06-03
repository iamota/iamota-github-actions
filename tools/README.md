# Tools

This folder contains local/operational utilities for the `iamota-github-actions` repository.

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
