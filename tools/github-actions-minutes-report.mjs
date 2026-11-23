#!/usr/bin/env node

// GitHub Actions compute (minutes) usage report.
//
// Two layers:
//   1. Billing (authoritative): the enhanced billing usage API reports billed
//      minutes and dollars per repository, per day, per runner SKU.
//   2. Attribution (estimate): for the top repositories, every workflow run and
//      job in the period is fetched and billed minutes are rebuilt the way
//      GitHub bills them (each job rounded UP to a whole minute, self-hosted
//      free), so spend can be broken down by workflow, job and trigger event.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DAY_MS = 86400000;
const RUNS_SEARCH_CAP = 1000; // GitHub returns at most 1000 results for a filtered runs query.

// Fallback per-minute prices (USD) used only when the billing data has no
// price for that runner SKU in the period. Billing prices always win.
const FALLBACK_PRICE_PER_MINUTE = { linux: 0.006, windows: 0.01, macos: 0.062 };
const SKU_TO_OS = { "Actions Linux": "linux", "Actions Windows": "windows", "Actions macOS": "macos" };

function parseArgs(argv) {
    const now = new Date();
    const out = {
        org: "iamota",
        month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
        trendMonths: 3,
        attributeTop: 10,
        repos: [],
        attribution: true,
        concurrency: 8,
        budgetUsd: 50,
        outputDir: "tools/reports/actions-minutes-usage",
        topWorkflows: 30,
        topJobs: 30,
        verbose: false,
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = argv[i + 1];
        const take = () => {
            if (next === undefined) throw new Error(`Missing value for ${arg}`);
            i += 1;
            return next;
        };

        switch (arg) {
            case "--org": out.org = take(); break;
            case "--month": out.month = take(); break;
            case "--trend-months": out.trendMonths = toInt(take(), arg, 1); break;
            case "--attribute-top": out.attributeTop = toInt(take(), arg, 0); break;
            case "--repo": out.repos.push(take()); break;
            case "--no-attribution": out.attribution = false; break;
            case "--concurrency": out.concurrency = toInt(take(), arg, 1); break;
            case "--budget-usd": out.budgetUsd = toNumber(take(), arg); break;
            case "--output-dir": out.outputDir = take(); break;
            case "--top-workflows": out.topWorkflows = toInt(take(), arg, 1); break;
            case "--top-jobs": out.topJobs = toInt(take(), arg, 1); break;
            case "--verbose": out.verbose = true; break;
            case "--help":
            case "-h":
                printHelp();
                process.exit(0);
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(out.month)) {
        throw new Error("--month must be YYYY-MM");
    }
    return out;
}

function printHelp() {
    console.log(`GitHub Actions compute (minutes) usage report

Usage:
  node tools/github-actions-minutes-report.mjs [options]

Options:
  --org <name>              GitHub organization (default: iamota)
  --month <YYYY-MM>         Billing month to report on (default: current UTC month)
  --trend-months <n>        Months of billing history in the trend table (default: 3)
  --attribute-top <n>       Break down the top N repos by workflow/job (default: 10, 0 = none)
  --repo <name>             Attribute this repo instead of the top N (repeatable)
  --no-attribution          Billing layer only (fast, a handful of API calls)
  --concurrency <n>         Parallel API requests during attribution (default: 8)
  --budget-usd <n>          Monthly Actions budget for % / projection (default: 50)
  --output-dir <path>       Output directory (default: tools/reports/actions-minutes-usage)
  --top-workflows <n>       Workflows listed in the summary (default: 30)
  --top-jobs <n>            Jobs listed in the summary (default: 30)
  --verbose                 Print progress logs
  --help, -h                Show this help

Prerequisites:
  - GitHub CLI installed and authenticated (gh auth login)
  - Org billing access (org owner / billing manager) for the billing layer
  - repo scope for private repos in the attribution layer
`);
}

function toInt(value, flag, min) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < min) throw new Error(`${flag} must be an integer >= ${min}`);
    return n;
}

function toNumber(value, flag) {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a non-negative number`);
    return n;
}

// ---------------------------------------------------------------- gh helpers

async function ghApi(endpoint, { retries = 3 } = {}) {
    const args = ["api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint];
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 100 });
            return stdout && stdout.trim() ? JSON.parse(stdout) : null;
        } catch (error) {
            lastError = error;
            const text = `${error.stderr || ""}${error.message || ""}`;
            // 404/410/403-permission errors will not get better on retry.
            if (/HTTP (404|410|401)/.test(text) || (/HTTP 403/.test(text) && !/rate limit/i.test(text))) break;
            if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
    const detail = `${lastError.stderr || lastError.message || lastError}`.trim().split("\n")[0];
    throw new Error(`gh api ${endpoint} failed: ${detail}`);
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
        throw new Error("GitHub CLI is not authenticated. Run: gh auth login");
    }
}

async function mapPool(items, concurrency, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
            const idx = next;
            next += 1;
            results[idx] = await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return results;
}

// ---------------------------------------------------------------- dates

function monthBounds(month) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 0)); // last day of month
    return { year: y, month: m, start, end, daysInMonth: end.getUTCDate() };
}

function shiftMonth(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const dayKey = (d) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------- billing layer

async function fetchUsage(org, month) {
    const { year, month: m } = monthBounds(month);
    const data = await ghApi(`/organizations/${encodeURIComponent(org)}/settings/billing/usage?year=${year}&month=${m}`);
    return Array.isArray(data?.usageItems) ? data.usageItems : [];
}

const isComputeItem = (item) => item.product === "actions" && item.unitType === "Minutes";
const isStorageItem = (item) => item.product === "actions" && item.unitType === "GigabyteHours";

function emptyMoney() {
    return { minutes: 0, gross: 0, discount: 0, net: 0 };
}

function addMoney(target, item) {
    target.minutes += Number(item.quantity || 0);
    target.gross += Number(item.grossAmount || 0);
    target.discount += Number(item.discountAmount || 0);
    target.net += Number(item.netAmount || 0);
}

function summarizeBilling(items) {
    const totals = emptyMoney();
    const storage = { gross: 0, net: 0 };
    const byRepo = new Map();
    const byDay = new Map();
    const bySku = new Map();
    const prices = {};

    for (const item of items) {
        if (isStorageItem(item)) {
            storage.gross += Number(item.grossAmount || 0);
            storage.net += Number(item.netAmount || 0);
            continue;
        }
        if (!isComputeItem(item)) continue;

        addMoney(totals, item);

        const repo = item.repositoryName || "(no repository)";
        if (!byRepo.has(repo)) byRepo.set(repo, { repo, ...emptyMoney(), bySku: {} });
        const r = byRepo.get(repo);
        addMoney(r, item);
        r.bySku[item.sku] = (r.bySku[item.sku] || 0) + Number(item.quantity || 0);

        const day = String(item.date || "").slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, { day, ...emptyMoney() });
        addMoney(byDay.get(day), item);

        if (!bySku.has(item.sku)) bySku.set(item.sku, { sku: item.sku, ...emptyMoney() });
        addMoney(bySku.get(item.sku), item);

        const os = SKU_TO_OS[item.sku];
        if (os && item.pricePerUnit) prices[os] = Number(item.pricePerUnit);
    }

    const repos = [...byRepo.values()].sort((a, b) => b.minutes - a.minutes);
    for (const r of repos) r.share = totals.minutes ? r.minutes / totals.minutes : 0;

    return {
        totals,
        storage,
        repos,
        days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
        skus: [...bySku.values()].sort((a, b) => b.minutes - a.minutes),
        prices,
    };
}

function projectMonth(billing, bounds, now) {
    const isCurrent = now >= bounds.start && now <= new Date(bounds.end.getTime() + DAY_MS);
    if (!isCurrent) {
        return { isCurrentMonth: false, daysElapsed: bounds.daysInMonth, daysInMonth: bounds.daysInMonth, ...billing.totals };
    }
    // Billing data lags; project from the days that have actually been reported.
    const lastDay = billing.days.length ? Number(billing.days[billing.days.length - 1].day.slice(8, 10)) : now.getUTCDate();
    const daysElapsed = Math.max(1, lastDay);
    const f = bounds.daysInMonth / daysElapsed;
    const t = billing.totals;
    return {
        isCurrentMonth: true,
        daysElapsed,
        daysInMonth: bounds.daysInMonth,
        minutes: t.minutes * f,
        gross: t.gross * f,
        discount: t.discount * f,
        net: t.net * f,
    };
}

// ---------------------------------------------------------------- attribution layer

async function listRuns(org, repo, fromDay, toDay, verbose) {
    const base = `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/actions/runs`;
    const created = `${fromDay}..${toDay}`;
    const first = await ghApi(`${base}?per_page=100&page=1&exclude_pull_requests=true&created=${created}`);
    const total = Number(first?.total_count || 0);

    // Filtered queries are capped at 1000 results; split the range until each slice fits.
    if (total > RUNS_SEARCH_CAP && fromDay !== toDay) {
        const a = new Date(`${fromDay}T00:00:00Z`).getTime();
        const b = new Date(`${toDay}T00:00:00Z`).getTime();
        const mid = new Date(a + Math.floor((b - a) / DAY_MS / 2) * DAY_MS);
        const midNext = new Date(mid.getTime() + DAY_MS);
        if (verbose) console.log(`  ${repo}: ${total} runs in ${created}, splitting range`);
        const left = await listRuns(org, repo, fromDay, dayKey(mid), verbose);
        const right = await listRuns(org, repo, dayKey(midNext), toDay, verbose);
        return [...left, ...right];
    }
    if (total > RUNS_SEARCH_CAP) {
        console.warn(`  ${repo}: ${total} runs on ${fromDay} exceeds the API cap; only the first ${RUNS_SEARCH_CAP} are counted.`);
    }

    const runs = [...(first?.workflow_runs || [])];
    const pages = Math.ceil(Math.min(total, RUNS_SEARCH_CAP) / 100);
    for (let page = 2; page <= pages; page += 1) {
        const data = await ghApi(`${base}?per_page=100&page=${page}&exclude_pull_requests=true&created=${created}`);
        runs.push(...(data?.workflow_runs || []));
    }
    return runs;
}

async function listJobs(org, repo, runId) {
    const jobs = [];
    for (let page = 1; ; page += 1) {
        const data = await ghApi(
            `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/actions/runs/${runId}/jobs?filter=all&per_page=100&page=${page}`
        );
        const chunk = data?.jobs || [];
        jobs.push(...chunk);
        if (chunk.length < 100) break;
    }
    return jobs;
}

function runnerOs(labels) {
    const joined = (labels || []).join(" ").toLowerCase();
    if (joined.includes("windows")) return "windows";
    if (joined.includes("macos")) return "macos";
    return "linux";
}

// GitHub-managed "dynamic" workflows (Dependabot, Copilot review) carry a
// per-PR display name; label them by their stable path instead.
const DYNAMIC_WORKFLOW_NAMES = {
    "dynamic/dependabot/dependabot-updates": "Dependabot updates",
    "dynamic/agents/copilot-pull-request-reviewer": "Copilot code review",
};

function workflowDisplayName(run) {
    const p = run.path || "";
    if (p.startsWith("dynamic/")) return DYNAMIC_WORKFLOW_NAMES[p] || p;
    return run.name || p || "(unknown workflow)";
}

// Collapse matrix legs ("deploy (production, us)") into one job group ("deploy").
function jobGroupName(name) {
    return String(name || "(unnamed job)").replace(/\s+\([^()]*\)\s*$/, "");
}

async function attributeRepo(org, repo, fromDay, toDay, prices, concurrency, verbose) {
    const runs = await listRuns(org, repo, fromDay, toDay, verbose);
    if (verbose) console.log(`  ${repo}: ${runs.length} runs, fetching jobs...`);

    const jobLists = await mapPool(runs, concurrency, async (run) => {
        try {
            return await listJobs(org, repo, run.id);
        } catch (error) {
            if (verbose) console.warn(`  ${repo}: jobs for run ${run.id} failed: ${error.message}`);
            return null;
        }
    });

    const workflows = new Map();
    const totals = { runs: runs.length, failedRunFetches: 0, jobs: 0, rawMinutes: 0, billedMinutes: 0, selfHostedMinutes: 0, usd: 0 };

    runs.forEach((run, idx) => {
        const jobs = jobLists[idx];
        if (!jobs) {
            totals.failedRunFetches += 1;
            return;
        }
        const key = run.path || run.name || "(unknown workflow)";
        if (!workflows.has(key)) {
            workflows.set(key, {
                repo,
                path: run.path || "",
                name: workflowDisplayName(run),
                runIds: new Set(),
                jobs: 0,
                rawMinutes: 0,
                billedMinutes: 0,
                usd: 0,
                byEvent: {},
                byJob: new Map(),
            });
        }
        const wf = workflows.get(key);
        wf.runIds.add(run.id);

        for (const job of jobs) {
            if (!job.started_at || !job.completed_at) continue;
            const ms = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
            if (!(ms > 0)) continue;

            const raw = ms / 60000;
            const selfHosted = (job.labels || []).some((l) => String(l).toLowerCase() === "self-hosted");
            if (selfHosted) {
                totals.selfHostedMinutes += raw;
                continue;
            }
            const os = runnerOs(job.labels);
            const billed = Math.ceil(raw);
            const usd = billed * (prices[os] ?? FALLBACK_PRICE_PER_MINUTE[os]);

            totals.jobs += 1;
            totals.rawMinutes += raw;
            totals.billedMinutes += billed;
            totals.usd += usd;

            wf.jobs += 1;
            wf.rawMinutes += raw;
            wf.billedMinutes += billed;
            wf.usd += usd;
            wf.byEvent[run.event] = (wf.byEvent[run.event] || 0) + billed;

            const group = jobGroupName(job.name);
            if (!wf.byJob.has(group)) wf.byJob.set(group, { name: group, legs: new Set(), jobs: 0, rawMinutes: 0, billedMinutes: 0 });
            const jg = wf.byJob.get(group);
            jg.legs.add(job.name);
            jg.jobs += 1;
            jg.rawMinutes += raw;
            jg.billedMinutes += billed;
        }
    });

    return {
        repo,
        totals,
        workflows: [...workflows.values()].map((wf) => ({
            repo: wf.repo,
            path: wf.path,
            name: wf.name,
            runs: wf.runIds.size,
            jobs: wf.jobs,
            rawMinutes: wf.rawMinutes,
            billedMinutes: wf.billedMinutes,
            usd: wf.usd,
            roundingOverhead: wf.billedMinutes ? (wf.billedMinutes - wf.rawMinutes) / wf.billedMinutes : 0,
            avgJobSeconds: wf.jobs ? (wf.rawMinutes * 60) / wf.jobs : 0,
            byEvent: wf.byEvent,
            jobGroups: [...wf.byJob.values()]
                .map((jg) => ({
                    name: jg.name,
                    matrixLegs: jg.legs.size,
                    jobs: jg.jobs,
                    rawMinutes: jg.rawMinutes,
                    billedMinutes: jg.billedMinutes,
                    avgJobSeconds: jg.jobs ? (jg.rawMinutes * 60) / jg.jobs : 0,
                }))
                .sort((a, b) => b.billedMinutes - a.billedMinutes),
        })),
    };
}

function buildInsights(billing, attribution, projection, args) {
    const out = [];
    const t = billing.totals;

    if (billing.repos.length) {
        const top = billing.repos[0];
        out.push(`${top.repo} is the largest consumer: ${fmtMin(top.minutes)} (${pct(top.share)} of billed minutes).`);
        const top3 = billing.repos.slice(0, 3).reduce((s, r) => s + r.share, 0);
        if (billing.repos.length > 3) out.push(`The top 3 repos account for ${pct(top3)} of billed minutes.`);
    }

    if (args.budgetUsd > 0) {
        const basis = projection.isCurrentMonth ? `projected month-end` : `month total`;
        out.push(
            `Net spend ${usd(t.net)} so far (${usd(projection.net)} ${basis}) against a ${usd(args.budgetUsd)} budget = ${pct(projection.net / args.budgetUsd)}. ` +
                `${usd(t.discount)} of ${usd(t.gross)} gross was covered by included minutes.`
        );
    }

    if (attribution) {
        const a = attribution.totals;
        if (a.billedMinutes) {
            out.push(
                `Per-job round-up adds ${fmtMin(a.billedMinutes - a.rawMinutes)} across attributed repos: ${pct((a.billedMinutes - a.rawMinutes) / a.billedMinutes)} of their billed minutes is rounding, not work.`
            );
        }
        const heavyRounding = attribution.workflows
            .filter((w) => w.billedMinutes >= Math.max(30, a.billedMinutes * 0.03) && w.roundingOverhead >= 0.5)
            .slice(0, 5);
        for (const w of heavyRounding) {
            out.push(
                `${w.repo} / ${w.name}: ${fmtMin(w.billedMinutes)} billed for ${fmtMin(w.rawMinutes)} of runtime (avg job ${Math.round(w.avgJobSeconds)}s). Fewer, longer jobs (less matrix fan-out, merged steps) would cut this.`
            );
        }
        const byEvent = attribution.byEvent;
        const scheduled = byEvent.schedule || 0;
        if (scheduled && a.billedMinutes) {
            out.push(`Scheduled (cron) runs are ${pct(scheduled / a.billedMinutes)} of attributed billed minutes.`);
        }
        for (const r of attribution.repos) {
            const billed = billing.repos.find((b) => b.repo === r.repo)?.minutes || 0;
            if (billed > 20 && r.totals.billedMinutes) {
                const ratio = r.totals.billedMinutes / billed;
                if (ratio < 0.75 || ratio > 1.25) {
                    out.push(
                        `${r.repo}: rebuilt estimate (${fmtMin(r.totals.billedMinutes)}) differs from billing (${fmtMin(billed)}) by ${pct(Math.abs(1 - ratio))}; deleted runs, billing lag or larger runners are likely causes.`
                    );
                }
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------- formatting

const fmtMin = (n) => `${Math.round(n).toLocaleString()} min`;
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const pct = (n) => `${(Number(n || 0) * 100).toFixed(0)}%`;

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function bar(fraction) {
    const w = Math.max(0, Math.min(1, fraction)) * 100;
    return `<div class="bar"><span style="width:${w.toFixed(1)}%"></span></div>`;
}

function buildSummaryText(report) {
    const { billing, projection, trend, attribution, insights } = report;
    const lines = [
        `Org: ${report.org}`,
        `Month: ${report.month}${projection.isCurrentMonth ? ` (month to date, ${projection.daysElapsed}/${projection.daysInMonth} days reported)` : ""}`,
        `Generated: ${report.generatedAt}`,
        "",
        `Billed minutes: ${fmtMin(billing.totals.minutes)}`,
        `Compute gross: ${usd(billing.totals.gross)}  included-minutes discount: ${usd(billing.totals.discount)}  net: ${usd(billing.totals.net)}`,
        `Artifact/log storage net: ${usd(billing.storage.net)} (see github-actions-storage-report.mjs)`,
    ];
    if (projection.isCurrentMonth) {
        lines.push(`Projected month-end: ${fmtMin(projection.minutes)}, net ${usd(projection.net)}`);
    }
    if (report.budgetUsd > 0) lines.push(`Budget: ${usd(report.budgetUsd)} (net projected = ${pct(projection.net / report.budgetUsd)})`);

    lines.push("", "Insights:", ...insights.map((i) => `- ${i}`));

    lines.push("", "Trend (compute):");
    for (const m of trend) lines.push(`- ${m.month}: ${fmtMin(m.minutes)}, gross ${usd(m.gross)}, net ${usd(m.net)}`);

    lines.push("", "Repos by billed minutes (billing API):");
    billing.repos.forEach((r, i) =>
        lines.push(`${i + 1}. ${r.repo} - ${fmtMin(r.minutes)} (${pct(r.share)}), gross ${usd(r.gross)}, net ${usd(r.net)}`)
    );

    if (attribution) {
        lines.push("", `Workflows by estimated billed minutes (attributed repos: ${attribution.repos.map((r) => r.repo).join(", ")}):`);
        attribution.workflows.slice(0, report.limits.topWorkflows).forEach((w, i) =>
            lines.push(
                `${i + 1}. ${w.repo} / ${w.name} - ${fmtMin(w.billedMinutes)} billed, ${fmtMin(w.rawMinutes)} runtime, ${w.runs} runs, ${w.jobs} jobs, rounding ${pct(w.roundingOverhead)}`
            )
        );
        lines.push("", "Job groups by estimated billed minutes (matrix legs combined):");
        attribution.jobs.slice(0, report.limits.topJobs).forEach((j, i) =>
            lines.push(
                `${i + 1}. ${j.repo} / ${j.workflow} / ${j.name} - ${fmtMin(j.billedMinutes)} billed, ${j.jobs} jobs (${j.matrixLegs} legs), avg ${Math.round(j.avgJobSeconds)}s`
            )
        );
        lines.push("", "Billed minutes by trigger event:");
        Object.entries(attribution.byEvent)
            .sort((a, b) => b[1] - a[1])
            .forEach(([event, min]) => lines.push(`- ${event}: ${fmtMin(min)}`));
    }
    return `${lines.join("\n")}\n`;
}

function buildHtml(report) {
    const { billing, projection, trend, attribution, insights } = report;
    const maxDay = Math.max(1, ...billing.days.map((d) => d.minutes));
    const maxRepo = Math.max(1, ...billing.repos.map((r) => r.minutes));

    const dayBars = billing.days
        .map((d, i) => {
            const w = 1000 / Math.max(1, projection.daysInMonth);
            const h = (d.minutes / maxDay) * 180;
            const x = (Number(d.day.slice(8, 10)) - 1) * w;
            return `<rect x="${(x + 2).toFixed(1)}" y="${(200 - h).toFixed(1)}" width="${(w - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--accent)"><title>${d.day}: ${Math.round(d.minutes)} min, ${usd(d.gross)} gross</title></rect>`;
        })
        .join("");

    const repoRows = billing.repos
        .map(
            (r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.repo)}</td><td class="num">${Math.round(r.minutes).toLocaleString()}</td><td>${bar(r.minutes / maxRepo)}</td><td class="num">${pct(r.share)}</td><td class="num">${usd(r.gross)}</td><td class="num">${usd(r.net)}</td></tr>`
        )
        .join("");

    const trendRows = trend
        .map((m) => `<tr><td>${m.month}</td><td class="num">${Math.round(m.minutes).toLocaleString()}</td><td class="num">${usd(m.gross)}</td><td class="num">${usd(m.net)}</td></tr>`)
        .join("");

    let attributionHtml = "";
    if (attribution) {
        const maxWf = Math.max(1, ...attribution.workflows.map((w) => w.billedMinutes));
        const wfRows = attribution.workflows
            .slice(0, report.limits.topWorkflows)
            .map((w, i) => {
                const events = Object.entries(w.byEvent)
                    .sort((a, b) => b[1] - a[1])
                    .map(([e, m]) => `${escapeHtml(e)} ${Math.round(m)}`)
                    .join(", ");
                return `<tr><td>${i + 1}</td><td>${escapeHtml(w.repo)}</td><td title="${escapeHtml(w.path)}">${escapeHtml(w.name)}</td><td class="num">${w.runs.toLocaleString()}</td><td class="num">${w.jobs.toLocaleString()}</td><td class="num">${Math.round(w.billedMinutes).toLocaleString()}</td><td>${bar(w.billedMinutes / maxWf)}</td><td class="num">${Math.round(w.rawMinutes).toLocaleString()}</td><td class="num ${w.roundingOverhead >= 0.5 ? "warn" : ""}">${pct(w.roundingOverhead)}</td><td class="num">${usd(w.usd)}</td><td class="muted">${events}</td></tr>`;
            })
            .join("");
        const jobRows = attribution.jobs
            .slice(0, report.limits.topJobs)
            .map(
                (j, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(j.repo)}</td><td>${escapeHtml(j.workflow)}</td><td>${escapeHtml(j.name)}</td><td class="num">${j.matrixLegs}</td><td class="num">${j.jobs.toLocaleString()}</td><td class="num">${Math.round(j.billedMinutes).toLocaleString()}</td><td class="num">${Math.round(j.avgJobSeconds)}s</td></tr>`
            )
            .join("");
        const reconRows = attribution.repos
            .map((r) => {
                const billed = billing.repos.find((b) => b.repo === r.repo)?.minutes || 0;
                const cov = billed ? r.totals.billedMinutes / billed : 0;
                return `<tr><td>${escapeHtml(r.repo)}</td><td class="num">${r.totals.runs.toLocaleString()}</td><td class="num">${r.totals.jobs.toLocaleString()}</td><td class="num">${Math.round(r.totals.billedMinutes).toLocaleString()}</td><td class="num">${Math.round(billed).toLocaleString()}</td><td class="num">${billed ? pct(cov) : "n/a"}</td></tr>`;
            })
            .join("");
        const eventRows = Object.entries(attribution.byEvent)
            .sort((a, b) => b[1] - a[1])
            .map(([e, m]) => `<tr><td>${escapeHtml(e)}</td><td class="num">${Math.round(m).toLocaleString()}</td><td>${bar(m / Math.max(1, attribution.totals.billedMinutes))}</td></tr>`)
            .join("");

        attributionHtml = `
  <section class="card">
    <h2>Workflows by billed minutes</h2>
    <p>Rebuilt from workflow runs and jobs for the attributed repos: each job rounded up to a whole minute, self-hosted runners excluded. "Rounding" is the share of billed minutes that is round-up rather than runtime.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Repo</th><th>Workflow</th><th>Runs</th><th>Jobs</th><th>Billed min</th><th></th><th>Runtime min</th><th>Rounding</th><th>Est. gross</th><th>By event</th></tr></thead>
      <tbody>${wfRows}</tbody>
    </table></div>
  </section>
  <section class="card">
    <h2>Job groups by billed minutes</h2>
    <p>Matrix legs are combined (e.g. <code>deploy (store-a)</code> + <code>deploy (store-b)</code> = <code>deploy</code>).</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Repo</th><th>Workflow</th><th>Job</th><th>Legs</th><th>Jobs</th><th>Billed min</th><th>Avg job</th></tr></thead>
      <tbody>${jobRows}</tbody>
    </table></div>
  </section>
  <section class="grid2">
    <div class="card">
      <h2>By trigger event</h2>
      <div class="table-wrap"><table><thead><tr><th>Event</th><th>Billed min</th><th></th></tr></thead><tbody>${eventRows}</tbody></table></div>
    </div>
    <div class="card">
      <h2>Estimate vs billing</h2>
      <p>Coverage well under 100% usually means runs were deleted or billing includes days the runs API no longer returns.</p>
      <div class="table-wrap"><table><thead><tr><th>Repo</th><th>Runs</th><th>Jobs</th><th>Est. min</th><th>Billed min</th><th>Coverage</th></tr></thead><tbody>${reconRows}</tbody></table></div>
    </div>
  </section>`;
    }

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Actions Minutes Report</title>
<style>
:root { --bg:#0f172a; --text:#e5e7eb; --muted:#9ca3af; --accent:#22d3ee; --warn:#f59e0b; --bad:#f43f5e; --good:#34d399; --border:#374151; }
* { box-sizing: border-box; }
body { margin:0; font-family:"Segoe UI",Tahoma,sans-serif; background:radial-gradient(1200px 800px at 20% -10%,#1f2937,#0f172a 50%),var(--bg); color:var(--text); }
main { max-width:1280px; margin:0 auto; padding:24px 16px; display:grid; gap:12px; }
h1,h2,h3 { margin:0 0 10px; } h3 { font-size:14px; color:var(--muted); font-weight:600; }
p { margin:0 0 10px; color:var(--muted); }
.card { background:linear-gradient(180deg,rgba(31,41,55,.95),rgba(17,24,39,.95)); border:1px solid var(--border); border-radius:12px; padding:14px; min-width:0; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
.grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(360px,1fr)); gap:12px; }
.kpi { font-size:1.6rem; font-weight:700; color:var(--accent); font-variant-numeric:tabular-nums; }
.kpi.warn { color:var(--warn); } .kpi.bad { color:var(--bad); } .kpi.good { color:var(--good); }
.table-wrap { overflow:auto; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); vertical-align:top; }
th { color:#d1d5db; white-space:nowrap; }
td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
td.warn { color:var(--warn); } td.muted { color:var(--muted); font-size:12px; }
.bar { width:120px; height:8px; background:rgba(148,163,184,.15); border-radius:4px; margin-top:5px; }
.bar span { display:block; height:100%; background:var(--accent); border-radius:4px; }
svg { width:100%; height:auto; display:block; }
code { background:rgba(148,163,184,.15); padding:1px 5px; border-radius:5px; }
ul { margin:0; padding-left:20px; } li { margin-bottom:6px; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>GitHub Actions Minutes Report</h1>
    <p>Org <strong>${escapeHtml(report.org)}</strong> · ${escapeHtml(report.month)}${projection.isCurrentMonth ? ` · month to date (${projection.daysElapsed}/${projection.daysInMonth} days reported)` : ""} · generated ${escapeHtml(report.generatedAt)}</p>
  </div>

  <section class="grid">
    <div class="card"><h3>Billed minutes</h3><div class="kpi">${Math.round(billing.totals.minutes).toLocaleString()}</div><p>${projection.isCurrentMonth ? `~${Math.round(projection.minutes).toLocaleString()} projected` : "month total"}</p></div>
    <div class="card"><h3>Compute gross</h3><div class="kpi">${usd(billing.totals.gross)}</div><p>${usd(billing.totals.discount)} covered by included minutes</p></div>
    <div class="card"><h3>Compute net</h3><div class="kpi ${report.budgetUsd && projection.net > report.budgetUsd ? "bad" : "good"}">${usd(billing.totals.net)}</div><p>${projection.isCurrentMonth ? `${usd(projection.net)} projected` : "month total"}${report.budgetUsd ? ` · ${pct(projection.net / report.budgetUsd)} of ${usd(report.budgetUsd)} budget` : ""}</p></div>
    <div class="card"><h3>Storage net</h3><div class="kpi">${usd(billing.storage.net)}</div><p>artifacts, logs and caches</p></div>
  </section>

  <section class="card">
    <h2>Insights</h2>
    <ul>${insights.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
  </section>

  <section class="grid2">
    <div class="card">
      <h2>Billed minutes per day</h2>
      <svg viewBox="0 0 1000 210" role="img" aria-label="Billed minutes per day"><line x1="0" y1="200" x2="1000" y2="200" stroke="var(--border)" />${dayBars}</svg>
      <p>Peak day ${Math.round(maxDay).toLocaleString()} min. Hover a bar for the value.</p>
    </div>
    <div class="card">
      <h2>Monthly trend (compute)</h2>
      <div class="table-wrap"><table><thead><tr><th>Month</th><th>Minutes</th><th>Gross</th><th>Net</th></tr></thead><tbody>${trendRows}</tbody></table></div>
    </div>
  </section>

  <section class="card">
    <h2>Repos by billed minutes</h2>
    <p>Authoritative: from the org billing usage API.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Repo</th><th>Minutes</th><th></th><th>Share</th><th>Gross</th><th>Net</th></tr></thead>
      <tbody>${repoRows}</tbody>
    </table></div>
  </section>
${attributionHtml}
  <section class="card">
    <details><summary>Method and caveats</summary><ul>${report.assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul></details>
  </section>
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- main

async function main() {
    const args = parseArgs(process.argv);
    const now = new Date();
    const bounds = monthBounds(args.month);

    await ensureGhReady();

    console.log(`Fetching billing usage for ${args.org} ${args.month}...`);
    let items;
    try {
        items = await fetchUsage(args.org, args.month);
    } catch (error) {
        throw new Error(
            `${error.message}\nThe billing usage API needs an org owner or billing manager. If gh lacks scope, try: gh auth refresh -h github.com -s admin:org`
        );
    }
    const billing = summarizeBilling(items);
    const projection = projectMonth(billing, bounds, now);

    const trend = [];
    for (let i = args.trendMonths - 1; i >= 1; i -= 1) {
        const m = shiftMonth(args.month, -i);
        try {
            const t = summarizeBilling(await fetchUsage(args.org, m)).totals;
            trend.push({ month: m, ...t });
        } catch (error) {
            if (args.verbose) console.warn(`  trend ${m}: ${error.message}`);
        }
    }
    trend.push({ month: args.month, ...billing.totals });

    let attribution = null;
    const targets = args.repos.length
        ? args.repos
        : args.attribution
          ? billing.repos.filter((r) => r.repo !== "(no repository)").slice(0, args.attributeTop).map((r) => r.repo)
          : [];

    if (args.attribution && targets.length) {
        const fromDay = dayKey(bounds.start);
        const toDay = dayKey(new Date(Math.min(bounds.end.getTime(), now.getTime())));
        const repos = [];
        for (let i = 0; i < targets.length; i += 1) {
            console.log(`[${i + 1}/${targets.length}] attributing ${targets[i]} (${fromDay}..${toDay})`);
            try {
                repos.push(await attributeRepo(args.org, targets[i], fromDay, toDay, billing.prices, args.concurrency, args.verbose));
            } catch (error) {
                console.warn(`  Skipping ${targets[i]}: ${error.message}`);
            }
        }

        const workflows = repos.flatMap((r) => r.workflows).sort((a, b) => b.billedMinutes - a.billedMinutes);
        const jobs = workflows
            .flatMap((w) => w.jobGroups.map((j) => ({ repo: w.repo, workflow: w.name, ...j })))
            .sort((a, b) => b.billedMinutes - a.billedMinutes);
        const byEvent = {};
        for (const w of workflows) for (const [e, m] of Object.entries(w.byEvent)) byEvent[e] = (byEvent[e] || 0) + m;
        const totals = repos.reduce(
            (acc, r) => {
                for (const k of Object.keys(acc)) acc[k] += r.totals[k] || 0;
                return acc;
            },
            { runs: 0, failedRunFetches: 0, jobs: 0, rawMinutes: 0, billedMinutes: 0, selfHostedMinutes: 0, usd: 0 }
        );
        attribution = { window: { from: fromDay, to: toDay }, repos, workflows, jobs, byEvent, totals };
    }

    const report = {
        generatedAt: now.toISOString(),
        org: args.org,
        month: args.month,
        budgetUsd: args.budgetUsd,
        limits: { topWorkflows: args.topWorkflows, topJobs: args.topJobs },
        billing,
        projection,
        trend,
        attribution,
        insights: [],
        assumptions: [
            "Repo-level minutes and dollars come from the org billing usage API (GET /organizations/{org}/settings/billing/usage) and are authoritative.",
            "Gross is list price; discount is the plan's included minutes; net is what the org actually pays.",
            "Workflow and job figures are rebuilt from the runs and jobs APIs: each job's started_at..completed_at rounded up to a whole minute, matching GitHub's per-job billing. They are estimates.",
            "Self-hosted runner jobs are excluded (not billed). Public-repo minutes on standard runners are free and do not appear in billing.",
            "Runs created inside the month are counted; deleted runs cannot be recovered, so estimates can undershoot billing.",
            "Runner OS is inferred from job labels (windows / macos / otherwise Linux). Larger-runner SKUs are priced as Linux in the estimate.",
            "Billing data usually lags by up to a day; the projection scales month-to-date by the days actually reported.",
        ],
    };
    report.insights = buildInsights(billing, attribution, projection, args);

    const outputDir = path.isAbsolute(args.outputDir) ? args.outputDir : path.resolve(REPO_ROOT, args.outputDir);
    await fs.mkdir(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, "report.json");
    const txtPath = path.join(outputDir, "summary.txt");
    const htmlPath = path.join(outputDir, "dashboard.html");
    await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.writeFile(txtPath, buildSummaryText(report), "utf8");
    await fs.writeFile(htmlPath, buildHtml(report), "utf8");

    console.log("\nReport generation complete.");
    console.log(`- JSON: ${jsonPath}`);
    console.log(`- Summary: ${txtPath}`);
    console.log(`- Dashboard: ${htmlPath}`);
}

main().catch((error) => {
    console.error(`Error: ${error.message || error}`);
    process.exit(1);
});
