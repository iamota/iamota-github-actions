#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const TWO_GB_THRESHOLD = 2 * GIB;

function parseArgs(argv) {
    const out = {
        org: "iamota",
        currentRetentionDays: 90,
        whatIfRetentionDays: 75,
        thresholdGb: 2,
        outputDir: "tools/reports/actions-storage-usage",
        includeArchived: false,
        maxRepos: 0,
        resolveWorkflows: 300,
        topRepos: 20,
        topWorkflows: 30,
        verbose: false,
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === "--org" && next) {
            out.org = next;
            i += 1;
            continue;
        }
        if (arg === "--current-retention-days" && next) {
            out.currentRetentionDays = toPositiveInt(next, "--current-retention-days");
            i += 1;
            continue;
        }
        if (arg === "--what-if-retention-days" && next) {
            out.whatIfRetentionDays = toPositiveInt(next, "--what-if-retention-days");
            i += 1;
            continue;
        }
        if (arg === "--threshold-gb" && next) {
            out.thresholdGb = toPositiveNumber(next, "--threshold-gb");
            i += 1;
            continue;
        }
        if (arg === "--output-dir" && next) {
            out.outputDir = next;
            i += 1;
            continue;
        }
        if (arg === "--max-repos" && next) {
            out.maxRepos = toNonNegativeInt(next, "--max-repos");
            i += 1;
            continue;
        }
        if (arg === "--resolve-workflows" && next) {
            out.resolveWorkflows = toNonNegativeInt(next, "--resolve-workflows");
            i += 1;
            continue;
        }
        if (arg === "--top-repos" && next) {
            out.topRepos = toPositiveInt(next, "--top-repos");
            i += 1;
            continue;
        }
        if (arg === "--top-workflows" && next) {
            out.topWorkflows = toPositiveInt(next, "--top-workflows");
            i += 1;
            continue;
        }
        if (arg === "--include-archived") {
            out.includeArchived = true;
            continue;
        }
        if (arg === "--verbose") {
            out.verbose = true;
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }

        throw new Error(`Unknown or incomplete argument: ${arg}`);
    }

    if (out.whatIfRetentionDays > out.currentRetentionDays) {
        console.warn(
            "Warning: what-if retention is greater than current retention. The estimate is still computed, but only shorter retention usually helps reduce storage."
        );
    }

    return out;
}

function printHelp() {
    console.log(`GitHub Actions artifact storage report

Usage:
  node tools/github-actions-storage-report.mjs [options]

Options:
  --org <name>                      GitHub organization (default: iamota)
  --current-retention-days <n>      Current retention policy in days (default: 90)
  --what-if-retention-days <n>      What-if retention policy in days (default: 75)
  --threshold-gb <n>                Threshold in GB for pass/fail checks (default: 2)
  --output-dir <path>               Output directory (default: tools/reports/actions-storage-usage)
  --max-repos <n>                   Limit repos analyzed (0 = all, default: 0)
  --include-archived                Include archived repos (default: false)
  --resolve-workflows <n>           Resolve up to N top workflow runs to workflow names (default: 300)
  --top-repos <n>                   Top repositories shown in summary (default: 20)
  --top-workflows <n>               Top workflows shown in summary (default: 30)
  --verbose                         Print progress logs
  --help, -h                        Show this help

Prerequisites:
  - GitHub CLI installed: gh
  - Authenticated session: gh auth login
  - Permissions to read org repos and actions artifacts
`);
}

function toPositiveInt(value, flag) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return n;
}

function toNonNegativeInt(value, flag) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${flag} must be a non-negative integer`);
    }
    return n;
}

function toPositiveNumber(value, flag) {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`${flag} must be a positive number`);
    }
    return n;
}

async function ghApi(endpoint) {
    const args = ["api", "-H", "Accept: application/vnd.github+json", endpoint];
    const { stdout, stderr } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 50 });
    if (stderr && stderr.trim()) {
        // gh sometimes writes warnings to stderr; keep going.
    }
    if (!stdout || !stdout.trim()) return null;
    return JSON.parse(stdout);
}

async function ghRepoList(org, limit) {
    const args = [
        "repo",
        "list",
        org,
        "--limit",
        String(limit),
        "--json",
        "name,nameWithOwner,isPrivate,isArchived,visibility",
    ];
    const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 50 });
    if (!stdout || !stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
        size /= 1024;
        idx += 1;
    }
    return `${size.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function formatGiB(bytes) {
    return (bytes / GIB).toFixed(3);
}

function toDayKey(date) {
    return date.toISOString().slice(0, 10);
}

function parseIsoDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function dayIndexFromEpochMs(ms) {
    return Math.floor(ms / 86400000);
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

async function ensureGhReady() {
    try {
        await execFileAsync("gh", ["--version"]);
    } catch {
        throw new Error("GitHub CLI (gh) was not found on PATH.");
    }

    try {
        await execFileAsync("gh", ["auth", "status"]);
    } catch {
        throw new Error(
            "GitHub CLI is not authenticated. Run: gh auth login (and ensure org access includes private repos if needed)."
        );
    }
}

async function fetchAllOrgRepos(org, includeArchived, maxRepos, verbose) {
    const repos = [];
    let page = 1;

    while (true) {
        const endpoint = `/orgs/${encodeURIComponent(org)}/repos?type=all&per_page=100&page=${page}`;
        const chunk = await ghApi(endpoint);

        if (chunk && !Array.isArray(chunk) && typeof chunk === "object" && chunk.message) {
            throw new Error(`GitHub API error while listing repos for org ${org}: ${chunk.message}`);
        }

        if (!Array.isArray(chunk) || chunk.length === 0) break;

        for (const repo of chunk) {
            if (!includeArchived && repo.archived) continue;
            repos.push({
                name: repo.name,
                fullName: repo.full_name,
                private: Boolean(repo.private),
                archived: Boolean(repo.archived),
            });
            if (maxRepos > 0 && repos.length >= maxRepos) {
                return repos;
            }
        }

        if (verbose) {
            console.log(`Fetched repos page ${page}, total repos considered: ${repos.length}`);
        }

        if (chunk.length < 100) break;
        page += 1;
    }

    if (repos.length > 0) {
        return repos;
    }

    if (verbose) {
        console.log("Primary org repo listing returned no repositories; trying gh repo list fallback...");
    }

    const fallbackLimit = maxRepos > 0 ? Math.max(maxRepos, 100) : 5000;
    const fallbackRepos = await ghRepoList(org, fallbackLimit);

    for (const repo of fallbackRepos) {
        if (!includeArchived && repo.isArchived) continue;
        repos.push({
            name: repo.name,
            fullName: repo.nameWithOwner,
            private: Boolean(repo.isPrivate),
            archived: Boolean(repo.isArchived),
        });

        if (maxRepos > 0 && repos.length >= maxRepos) {
            return repos;
        }
    }

    return repos;
}

async function fetchRepoArtifacts(org, repo, verbose) {
    const artifacts = [];
    let page = 1;

    while (true) {
        const endpoint = `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/actions/artifacts?per_page=100&page=${page}`;
        const data = await ghApi(endpoint);
        const list = Array.isArray(data?.artifacts) ? data.artifacts : [];

        for (const artifact of list) {
            artifacts.push({
                id: artifact.id,
                name: artifact.name,
                sizeInBytes: Number(artifact.size_in_bytes || 0),
                expired: Boolean(artifact.expired),
                createdAt: artifact.created_at || null,
                expiresAt: artifact.expires_at || null,
                updatedAt: artifact.updated_at || null,
                runId: artifact.workflow_run?.id || null,
                runHeadBranch: artifact.workflow_run?.head_branch || null,
                runHeadSha: artifact.workflow_run?.head_sha || null,
            });
        }

        if (list.length < 100) break;
        page += 1;

        if (verbose && page % 10 === 0) {
            console.log(`  ${repo}: fetched ${artifacts.length} artifacts so far...`);
        }
    }

    return artifacts;
}

function buildRetentionSeries(artifacts, horizonDays, retentionDays, now) {
    const todayIdx = dayIndexFromEpochMs(now.getTime());
    const startIdx = todayIdx - (horizonDays - 1);
    const diff = new Array(horizonDays + 1).fill(0);

    for (const artifact of artifacts) {
        const created = parseIsoDate(artifact.createdAt);
        if (!created) continue;

        const createdIdx = dayIndexFromEpochMs(created.getTime());
        const policyEndIdxExclusive = createdIdx + retentionDays;

        let actualEndIdxExclusive = todayIdx + 1;
        const expires = parseIsoDate(artifact.expiresAt);
        if (expires) {
            actualEndIdxExclusive = dayIndexFromEpochMs(expires.getTime());
        }

        const endIdxExclusive = Math.min(policyEndIdxExclusive, actualEndIdxExclusive, todayIdx + 1);
        if (endIdxExclusive <= startIdx || createdIdx > todayIdx) continue;

        const start = clamp(createdIdx, startIdx, todayIdx + 1);
        const end = clamp(endIdxExclusive, startIdx, todayIdx + 1);
        if (end <= start) continue;

        const a = start - startIdx;
        const b = end - startIdx;
        diff[a] += artifact.sizeInBytes;
        diff[b] -= artifact.sizeInBytes;
    }

    const points = [];
    const values = [];
    let running = 0;
    for (let i = 0; i < horizonDays; i += 1) {
        running += diff[i];
        values.push(running);

        const date = new Date((startIdx + i) * 86400000);
        points.push({ date: toDayKey(date), bytes: running });
    }

    const avg = values.reduce((sum, n) => sum + n, 0) / (values.length || 1);
    const max = values.length ? Math.max(...values) : 0;
    const latest = values.length ? values[values.length - 1] : 0;

    return { points, avgBytes: avg, maxBytes: max, latestBytes: latest };
}

function toSortedEntries(mapObj) {
    return Object.entries(mapObj).sort((a, b) => b[1] - a[1]);
}

function buildSparklinePath(values, width, height, padding = 8) {
    if (!Array.isArray(values) || values.length === 0) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = Math.max(1, width - padding * 2);
    const h = Math.max(1, height - padding * 2);

    return values
        .map((v, i) => {
            const x = padding + (i / Math.max(1, values.length - 1)) * w;
            const yRatio = max === min ? 0.5 : (v - min) / (max - min);
            const y = padding + (1 - yRatio) * h;
            return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
}

function buildChartPath(values, chart) {
    if (!Array.isArray(values) || values.length === 0) return "";
    const { left, top, width, height, minY, maxY } = chart;

    return values
        .map((v, i) => {
            const x = left + (i / Math.max(1, values.length - 1)) * width;
            const yRatio = maxY === minY ? 0 : (v - minY) / (maxY - minY);
            const y = top + (1 - yRatio) * height;
            return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
}

function chartYTicks(minY, maxY, tickCount = 5) {
    const ticks = [];
    for (let i = 0; i <= tickCount; i += 1) {
        const ratio = i / tickCount;
        const value = minY + (maxY - minY) * ratio;
        ticks.push(value);
    }
    return ticks;
}

function formatYAxisLabel(bytes) {
    const gib = bytes / GIB;
    if (gib >= 1) return `${gib.toFixed(1)} GiB`;
    const mib = bytes / MIB;
    return `${mib.toFixed(0)} MiB`;
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function buildHtmlReport(report) {
    const {
        generatedAt,
        org,
        assumptions,
        billing,
        summary,
        topRepositories,
        topWorkflows,
        retentionCurrent,
        retentionWhatIf,
    } = report;

    const currentValues = retentionCurrent.series.map((p) => p.bytes);
    const whatIfValues = retentionWhatIf.series.map((p) => p.bytes);

    const maxY = Math.max(1, ...currentValues, ...whatIfValues);
    const minY = 0;

    const chart = {
        left: 84,
        top: 20,
        width: 980,
        height: 220,
        minY,
        maxY,
    };

    const currentPath = buildChartPath(currentValues, chart);
    const whatIfPath = buildChartPath(whatIfValues, chart);

    const yTicks = chartYTicks(minY, maxY, 5).reverse();
    const yTickMarkup = yTicks
        .map((tick) => {
            const ratio = maxY === minY ? 0 : (tick - minY) / (maxY - minY);
            const y = chart.top + (1 - ratio) * chart.height;
            return `
      <line x1="${chart.left}" y1="${y.toFixed(2)}" x2="${chart.left + chart.width}" y2="${y.toFixed(2)}" stroke="rgba(156,163,175,0.25)" stroke-width="1" />
      <text x="${chart.left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="#9ca3af" font-size="12">${formatYAxisLabel(tick)}</text>`;
        })
        .join("\n");

    const horizonDays = Math.max(retentionCurrent.series.length, retentionWhatIf.series.length);
    const xTicks = [horizonDays - 1, Math.round((horizonDays - 1) * 0.75), Math.round((horizonDays - 1) * 0.5), Math.round((horizonDays - 1) * 0.25), 0];
    const xTickMarkup = xTicks
        .map((daysOld) => {
            const idx = (horizonDays - 1) - daysOld;
            const ratio = idx / Math.max(1, horizonDays - 1);
            const x = chart.left + ratio * chart.width;
            return `
      <line x1="${x.toFixed(2)}" y1="${chart.top}" x2="${x.toFixed(2)}" y2="${chart.top + chart.height}" stroke="rgba(156,163,175,0.15)" stroke-width="1" />
      <text x="${x.toFixed(2)}" y="${chart.top + chart.height + 22}" text-anchor="middle" fill="#9ca3af" font-size="12">${daysOld}d</text>`;
        })
        .join("\n");

    const repoRows = topRepositories
        .map((r, idx) => {
            return `<tr>
<td>${idx + 1}</td>
<td>${escapeHtml(r.repo)}</td>
<td>${r.artifactCount.toLocaleString()}</td>
<td>${formatBytes(r.currentActiveBytes)}</td>
<td>${formatBytes(r.bytesCreatedWithinCurrentWindow)}</td>
<td>${r.currentActiveGb.toFixed(3)}</td>
</tr>`;
        })
        .join("\n");

    const workflowRows = topWorkflows
        .map((w, idx) => {
            return `<tr>
<td>${idx + 1}</td>
<td>${escapeHtml(w.repo)}</td>
<td>${escapeHtml(w.workflowName)}</td>
<td>${w.runCount.toLocaleString()}</td>
<td>${formatBytes(w.bytes)}</td>
</tr>`;
        })
        .join("\n");

    const billingRows = Object.entries(billing || {})
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(JSON.stringify(v))}</td></tr>`)
        .join("\n");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GitHub Actions Storage Report - ${escapeHtml(org)}</title>
<style>
:root {
  --bg: #0f172a;
  --panel: #111827;
  --panel2: #1f2937;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --accent: #22d3ee;
  --accent2: #fb7185;
  --good: #34d399;
  --warn: #f59e0b;
  --bad: #f43f5e;
  --border: #374151;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", Tahoma, sans-serif;
  background: radial-gradient(1200px 800px at 20% -10%, #1f2937, #0f172a 50%), var(--bg);
  color: var(--text);
}
main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}
h1, h2, h3 { margin: 0 0 12px; }
p { margin: 0 0 10px; color: var(--muted); }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}
.card {
  background: linear-gradient(180deg, rgba(31,41,55,0.95), rgba(17,24,39,0.95));
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
}
.kpi { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
.kpi.warn { color: var(--warn); }
.kpi.bad { color: var(--bad); }
.kpi.good { color: var(--good); }
svg { width: 100%; height: auto; display: block; background: rgba(2,6,23,0.6); border: 1px solid var(--border); border-radius: 8px; }
.table-wrap { overflow: auto; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th, td {
  text-align: left;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
th { color: #d1d5db; }
summary {
  cursor: pointer;
  color: #d1d5db;
  margin-bottom: 8px;
}
code {
  background: rgba(148,163,184,0.15);
  padding: 2px 6px;
  border-radius: 6px;
}
.badge {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 8px;
  color: #d1d5db;
  font-size: 12px;
}
</style>
</head>
<body>
<main>
  <div class="card" style="margin-bottom:12px">
    <h1>GitHub Actions Artifact and Log Usage Report</h1>
    <p>Organization: <strong>${escapeHtml(org)}</strong></p>
    <p>Generated at: ${escapeHtml(generatedAt)}</p>
    <p><span class="badge">Data source: GitHub REST via gh api</span></p>
  </div>

  <section class="grid" style="margin-bottom:12px">
    <div class="card">
      <h3>Repositories Scanned</h3>
      <div class="kpi">${summary.reposScanned.toLocaleString()}</div>
    </div>
    <div class="card">
      <h3>Artifacts Scanned</h3>
      <div class="kpi">${summary.artifactsScanned.toLocaleString()}</div>
    </div>
    <div class="card">
      <h3>Current Active Artifact Storage</h3>
      <div class="kpi">${summary.currentActiveArtifactGiB.toFixed(3)} GiB</div>
      <p>${formatBytes(summary.currentActiveArtifactBytes)}</p>
    </div>
    <div class="card">
      <h3>Current Policy Avg (${summary.currentRetentionDays}d)</h3>
      <div class="kpi ${summary.currentAvgBytes <= summary.thresholdBytes ? "good" : "bad"}">${(summary.currentAvgBytes / GIB).toFixed(3)} GiB</div>
      <p>${summary.currentAvgBytes <= summary.thresholdBytes ? "At or below threshold" : "Above threshold"}</p>
    </div>
    <div class="card">
      <h3>What-if Policy Avg (${summary.whatIfRetentionDays}d)</h3>
      <div class="kpi ${summary.whatIfAvgBytes <= summary.thresholdBytes ? "good" : "bad"}">${(summary.whatIfAvgBytes / GIB).toFixed(3)} GiB</div>
      <p>${summary.whatIfAvgBytes <= summary.thresholdBytes ? "Likely within threshold" : "Likely above threshold"}</p>
    </div>
    <div class="card">
      <h3>Estimated Delta</h3>
      <div class="kpi ${summary.avgDeltaBytes <= 0 ? "good" : "warn"}">${(summary.avgDeltaBytes / GIB).toFixed(3)} GiB</div>
      <p>Current avg minus what-if avg</p>
    </div>
  </section>

  <section class="card" style="margin-bottom:12px">
    <h2>Estimated Storage Over Time</h2>
    <p>Artifact-based model. Each artifact contributes size from creation until min(expiration, retention policy, now).</p>
        <svg viewBox="0 0 1100 300" role="img" aria-label="Storage trend chart">
            <rect x="${chart.left}" y="${chart.top}" width="${chart.width}" height="${chart.height}" fill="rgba(2,6,23,0.15)" stroke="var(--border)" stroke-width="1" />
            ${yTickMarkup}
            ${xTickMarkup}
            <line x1="${chart.left}" y1="${chart.top + chart.height}" x2="${chart.left + chart.width}" y2="${chart.top + chart.height}" stroke="#9ca3af" stroke-width="1.5" />
            <line x1="${chart.left}" y1="${chart.top}" x2="${chart.left}" y2="${chart.top + chart.height}" stroke="#9ca3af" stroke-width="1.5" />
            <path d="${currentPath}" fill="none" stroke="var(--accent)" stroke-width="3" />
            <path d="${whatIfPath}" fill="none" stroke="var(--accent2)" stroke-width="2" stroke-dasharray="8 6" />
            <text x="${chart.left + chart.width / 2}" y="${chart.top + chart.height + 44}" text-anchor="middle" fill="#d1d5db" font-size="13">Age of data (days old)</text>
            <text x="22" y="${chart.top + chart.height / 2}" text-anchor="middle" fill="#d1d5db" font-size="13" transform="rotate(-90 22 ${chart.top + chart.height / 2})">Estimated storage size</text>
    </svg>
    <p><span style="color:var(--accent)">Current ${summary.currentRetentionDays}d</span> | <span style="color:var(--accent2)">What-if ${summary.whatIfRetentionDays}d</span></p>
  </section>

  <section class="card" style="margin-bottom:12px">
    <h2>Top Repositories by Active Artifact Storage</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Repository</th>
            <th>Artifacts</th>
            <th>Current Active</th>
            <th>Created Within ${summary.currentRetentionDays}d</th>
            <th>Current Active (GiB)</th>
          </tr>
        </thead>
        <tbody>
          ${repoRows}
        </tbody>
      </table>
    </div>
  </section>

  <section class="card" style="margin-bottom:12px">
    <h2>Top Workflow Contributors (Artifact Size)</h2>
    <p>Workflow names are resolved from the largest workflow runs first. Smaller runs may remain unresolved.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Repository</th>
            <th>Workflow</th>
            <th>Runs</th>
            <th>Total Size</th>
          </tr>
        </thead>
        <tbody>
          ${workflowRows}
        </tbody>
      </table>
    </div>
  </section>

  <section class="card" style="margin-bottom:12px">
    <details>
      <summary>Assumptions and Caveats</summary>
      <ul>
        ${assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join("\n")}
      </ul>
    </details>
  </section>

  <section class="card" style="margin-bottom:12px">
    <details>
      <summary>Billing Endpoint Snapshot (raw)</summary>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Key</th><th>Value</th></tr></thead>
          <tbody>${billingRows}</tbody>
        </table>
      </div>
    </details>
  </section>
</main>
</body>
</html>`;
}

async function fetchBilling(org, verbose) {
    const result = {};
    const endpoints = [
        [
            "actions",
            [
                `/orgs/${encodeURIComponent(org)}/settings/billing/actions`,
                `/organizations/${encodeURIComponent(org)}/settings/billing/actions`,
            ],
        ],
        [
            "sharedStorage",
            [
                `/orgs/${encodeURIComponent(org)}/settings/billing/shared-storage`,
                `/organizations/${encodeURIComponent(org)}/settings/billing/shared-storage`,
            ],
        ],
    ];

    for (const [key, candidateEndpoints] of endpoints) {
        let lastError = null;
        for (const endpoint of candidateEndpoints) {
            try {
                result[key] = await ghApi(endpoint);
                lastError = null;
                break;
            } catch (error) {
                lastError = error;
                if (verbose) {
                    console.warn(`Unable to fetch billing endpoint ${endpoint}: ${error.message || error}`);
                }
            }
        }

        if (lastError) {
            result[key] = { error: String(lastError.message || lastError) };
        }
    }

    return result;
}

function summarizeRepoArtifacts(repoName, artifacts, now, currentRetentionDays) {
    const nowMs = now.getTime();
    const windowStartMs = nowMs - currentRetentionDays * 86400000;

    let currentActiveBytes = 0;
    let bytesCreatedWithinCurrentWindow = 0;

    for (const artifact of artifacts) {
        const created = parseIsoDate(artifact.createdAt);
        const expires = parseIsoDate(artifact.expiresAt);

        if (created && created.getTime() >= windowStartMs) {
            bytesCreatedWithinCurrentWindow += artifact.sizeInBytes;
        }

        const notExpiredByFlag = !artifact.expired;
        const notExpiredByDate = !expires || expires.getTime() > nowMs;
        if (notExpiredByFlag && notExpiredByDate) {
            currentActiveBytes += artifact.sizeInBytes;
        }
    }

    return {
        repo: repoName,
        artifactCount: artifacts.length,
        currentActiveBytes,
        bytesCreatedWithinCurrentWindow,
        currentActiveGb: currentActiveBytes / GIB,
    };
}

async function resolveWorkflowNames(org, runEntries, limit, verbose) {
    const sorted = [...runEntries].sort((a, b) => b.bytes - a.bytes);
    const selected = sorted.slice(0, limit);
    const nameMap = new Map();

    for (let i = 0; i < selected.length; i += 1) {
        const entry = selected[i];
        const runKey = `${entry.repo}#${entry.runId}`;
        if (nameMap.has(runKey)) continue;

        const endpoint = `/repos/${encodeURIComponent(org)}/${encodeURIComponent(entry.repo)}/actions/runs/${entry.runId}`;
        try {
            const run = await ghApi(endpoint);
            const wfName = run?.name || run?.display_title || "(workflow name unavailable)";
            nameMap.set(runKey, wfName);
        } catch {
            nameMap.set(runKey, "(unresolved workflow)");
        }

        if (verbose && (i + 1) % 50 === 0) {
            console.log(`Resolved workflow names: ${i + 1}/${selected.length}`);
        }
    }

    return nameMap;
}

function buildWorkflowAggregation(perRepoArtifacts, workflowNameMap) {
    const byWorkflow = new Map();

    for (const [repo, artifacts] of perRepoArtifacts.entries()) {
        for (const artifact of artifacts) {
            if (!artifact.runId) continue;
            const runKey = `${repo}#${artifact.runId}`;
            const workflowName = workflowNameMap.get(runKey) || "(unresolved workflow)";
            const key = `${repo}|||${workflowName}`;

            if (!byWorkflow.has(key)) {
                byWorkflow.set(key, { repo, workflowName, bytes: 0, runIds: new Set() });
            }
            const row = byWorkflow.get(key);
            row.bytes += artifact.sizeInBytes;
            row.runIds.add(artifact.runId);
        }
    }

    return [...byWorkflow.values()]
        .map((row) => ({
            repo: row.repo,
            workflowName: row.workflowName,
            bytes: row.bytes,
            runCount: row.runIds.size,
        }))
        .sort((a, b) => b.bytes - a.bytes);
}

async function main() {
    const args = parseArgs(process.argv);
    const now = new Date();
    const thresholdBytes = args.thresholdGb * GIB;

    await ensureGhReady();

    console.log(`Scanning org ${args.org} for actions artifact usage...`);
    const repos = await fetchAllOrgRepos(args.org, args.includeArchived, args.maxRepos, args.verbose);
    if (!repos.length) {
        throw new Error("No repositories found to scan.");
    }

    const perRepoArtifacts = new Map();
    const repoSummaries = [];
    const allArtifacts = [];

    for (let i = 0; i < repos.length; i += 1) {
        const repo = repos[i];
        console.log(`[${i + 1}/${repos.length}] ${repo.name}`);

        let artifacts = [];
        try {
            artifacts = await fetchRepoArtifacts(args.org, repo.name, args.verbose);
        } catch (error) {
            console.warn(`  Skipping ${repo.name} due to error: ${error.message || error}`);
            continue;
        }

        perRepoArtifacts.set(repo.name, artifacts);
        allArtifacts.push(...artifacts);

        repoSummaries.push(summarizeRepoArtifacts(repo.name, artifacts, now, args.currentRetentionDays));
    }

    const currentActiveArtifactBytes = repoSummaries.reduce((sum, r) => sum + r.currentActiveBytes, 0);
    const currentActiveArtifactGiB = currentActiveArtifactBytes / GIB;

    const horizonDays = Math.max(args.currentRetentionDays, args.whatIfRetentionDays);
    const retentionCurrent = buildRetentionSeries(allArtifacts, horizonDays, args.currentRetentionDays, now);
    const retentionWhatIf = buildRetentionSeries(allArtifacts, horizonDays, args.whatIfRetentionDays, now);

    const runEntries = [];
    for (const [repo, artifacts] of perRepoArtifacts.entries()) {
        const byRun = new Map();
        for (const artifact of artifacts) {
            if (!artifact.runId) continue;
            byRun.set(artifact.runId, (byRun.get(artifact.runId) || 0) + artifact.sizeInBytes);
        }
        for (const [runId, bytes] of byRun.entries()) {
            runEntries.push({ repo, runId, bytes });
        }
    }

    console.log(`Resolving workflow names for up to ${args.resolveWorkflows} largest workflow runs...`);
    const workflowNameMap = await resolveWorkflowNames(args.org, runEntries, args.resolveWorkflows, args.verbose);
    const workflowRows = buildWorkflowAggregation(perRepoArtifacts, workflowNameMap);

    console.log("Fetching org billing snapshots...");
    const billing = await fetchBilling(args.org, args.verbose);

    const topRepositories = [...repoSummaries]
        .sort((a, b) => b.currentActiveBytes - a.currentActiveBytes)
        .slice(0, args.topRepos);

    const topWorkflows = workflowRows.slice(0, args.topWorkflows);

    const assumptions = [
        "This report directly measures artifact sizes from repository artifact endpoints.",
        "GitHub does not provide a simple per-repo log-bytes endpoint in this workflow; storage projections are artifact-based and should be treated as directional.",
        "Current active artifact storage is computed from artifacts that are not expired and whose expiration date is in the future.",
        "Retention what-if estimates apply a policy cap to each artifact lifespan: min(actual expiration, created + what-if retention).",
        "If your org has large log volume, actual artifact+log storage may exceed artifact-only estimates.",
    ];

    const report = {
        generatedAt: now.toISOString(),
        org: args.org,
        assumptions,
        summary: {
            reposScanned: repoSummaries.length,
            artifactsScanned: allArtifacts.length,
            currentActiveArtifactBytes,
            currentActiveArtifactGiB,
            currentRetentionDays: args.currentRetentionDays,
            whatIfRetentionDays: args.whatIfRetentionDays,
            thresholdBytes,
            thresholdGb: args.thresholdGb,
            currentAvgBytes: retentionCurrent.avgBytes,
            whatIfAvgBytes: retentionWhatIf.avgBytes,
            avgDeltaBytes: retentionCurrent.avgBytes - retentionWhatIf.avgBytes,
            currentPeakBytes: retentionCurrent.maxBytes,
            whatIfPeakBytes: retentionWhatIf.maxBytes,
        },
        retentionCurrent: {
            days: args.currentRetentionDays,
            averageBytes: retentionCurrent.avgBytes,
            peakBytes: retentionCurrent.maxBytes,
            latestBytes: retentionCurrent.latestBytes,
            series: retentionCurrent.points,
        },
        retentionWhatIf: {
            days: args.whatIfRetentionDays,
            averageBytes: retentionWhatIf.avgBytes,
            peakBytes: retentionWhatIf.maxBytes,
            latestBytes: retentionWhatIf.latestBytes,
            series: retentionWhatIf.points,
        },
        topRepositories,
        topWorkflows,
        billing,
    };

    const outputDir = path.isAbsolute(args.outputDir)
        ? args.outputDir
        : path.resolve(REPO_ROOT, args.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const summaryText = [
        `Org: ${args.org}`,
        `Generated: ${report.generatedAt}`,
        `Repos scanned: ${report.summary.reposScanned}`,
        `Artifacts scanned: ${report.summary.artifactsScanned}`,
        `Current active artifact storage: ${formatBytes(report.summary.currentActiveArtifactBytes)} (${formatGiB(report.summary.currentActiveArtifactBytes)} GiB)`,
        `Current retention (${args.currentRetentionDays}d) avg: ${formatBytes(report.summary.currentAvgBytes)} (${formatGiB(report.summary.currentAvgBytes)} GiB)`,
        `What-if retention (${args.whatIfRetentionDays}d) avg: ${formatBytes(report.summary.whatIfAvgBytes)} (${formatGiB(report.summary.whatIfAvgBytes)} GiB)`,
        `Delta avg: ${formatBytes(report.summary.avgDeltaBytes)} (${formatGiB(report.summary.avgDeltaBytes)} GiB)`,
        `Threshold: ${args.thresholdGb} GB`,
        `Within threshold (what-if avg): ${report.summary.whatIfAvgBytes <= thresholdBytes ? "yes" : "no"}`,
        "",
        "Top repos by current active artifact storage:",
        ...topRepositories.map((r, idx) => `${idx + 1}. ${r.repo} - ${formatBytes(r.currentActiveBytes)} (${r.artifactCount} artifacts)`),
        "",
        "Top workflows by artifact size:",
        ...topWorkflows.map((w, idx) => `${idx + 1}. ${w.repo} / ${w.workflowName} - ${formatBytes(w.bytes)} (${w.runCount} runs)`),
    ].join("\n");

    const jsonPath = path.join(outputDir, "report.json");
    const txtPath = path.join(outputDir, "summary.txt");
    const htmlPath = path.join(outputDir, "dashboard.html");

    await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.writeFile(txtPath, `${summaryText}\n`, "utf8");
    await fs.writeFile(htmlPath, buildHtmlReport(report), "utf8");

    console.log("\nReport generation complete.");
    console.log(`- JSON: ${jsonPath}`);
    console.log(`- Summary: ${txtPath}`);
    console.log(`- Dashboard: ${htmlPath}`);
}

main().catch((error) => {
    console.error(`Error: ${error.message || error}`);
    process.exit(1);
});
