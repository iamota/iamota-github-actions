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
const DAY_MS = 86400000;

function parseArgs(argv) {
    const out = {
        org: "iamota",
        includeArchived: false,
        maxRepos: 0,
        repo: "",
        pattern: "^shopify-theme-ci-(node-modules|root)$",
        olderThanDays: 0,
        execute: false,
        outputDir: "tools/reports/actions-artifact-cleanup",
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
        if (arg === "--repo" && next) {
            out.repo = next;
            i += 1;
            continue;
        }
        if (arg === "--pattern" && next) {
            out.pattern = next;
            i += 1;
            continue;
        }
        if (arg === "--older-than-days" && next) {
            out.olderThanDays = toNonNegativeInt(next, "--older-than-days");
            i += 1;
            continue;
        }
        if (arg === "--max-repos" && next) {
            out.maxRepos = toNonNegativeInt(next, "--max-repos");
            i += 1;
            continue;
        }
        if (arg === "--output-dir" && next) {
            out.outputDir = next;
            i += 1;
            continue;
        }
        if (arg === "--include-archived") {
            out.includeArchived = true;
            continue;
        }
        if (arg === "--execute") {
            out.execute = true;
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

    out.patternRegex = new RegExp(out.pattern, "i");
    return out;
}

function printHelp() {
    console.log(`GitHub Actions artifact cleanup (dry-run by default)

Usage:
  node tools/github-actions-artifact-cleanup.mjs [options]

Options:
  --org <name>                 GitHub organization (default: iamota)
  --repo <name>                Limit to a single repository
  --pattern <regex>            Artifact name regex (default: ^shopify-theme-ci-(node-modules|root)$)
  --older-than-days <n>        Only match artifacts older than N days (default: 0)
  --max-repos <n>              Limit repositories scanned (0 = all, default: 0)
  --include-archived           Include archived repos
  --output-dir <path>          Report output dir (default: tools/reports/actions-artifact-cleanup)
  --execute                    Actually delete matched artifacts
  --verbose                    Print progress logs
  --help, -h                   Show this help

Examples:
  # Preview cleanup impact (no deletions)
  node tools/github-actions-artifact-cleanup.mjs --org iamota --older-than-days 2

  # Delete old Shopify Theme CI handoff artifacts
  node tools/github-actions-artifact-cleanup.mjs --org iamota --older-than-days 2 --execute

Prerequisites:
  - GitHub CLI installed: gh
  - Authenticated session: gh auth login
  - Permissions to list repos and delete artifacts
`);
}

function toNonNegativeInt(value, flag) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${flag} must be a non-negative integer`);
    }
    return n;
}

async function ensureGhReady() {
    await execFileAsync("gh", ["--version"]);
    await execFileAsync("gh", ["auth", "status"]);
}

async function ghApiJson(endpoint) {
    const args = ["api", "-H", "Accept: application/vnd.github+json", endpoint];
    const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 50 });
    if (!stdout || !stdout.trim()) return null;
    return JSON.parse(stdout);
}

async function ghApiDelete(endpoint) {
    const args = ["api", "-X", "DELETE", "-H", "Accept: application/vnd.github+json", endpoint];
    await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 10 });
}

async function ghRepoList(org, limit) {
    const args = [
        "repo",
        "list",
        org,
        "--limit",
        String(limit),
        "--json",
        "name,nameWithOwner,isPrivate,isArchived",
    ];
    const { stdout } = await execFileAsync("gh", args, { maxBuffer: 1024 * 1024 * 50 });
    if (!stdout || !stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
}

async function fetchAllOrgRepos(org, includeArchived, maxRepos, repoSingle, verbose) {
    if (repoSingle) {
        return [{
            name: repoSingle,
            fullName: `${org}/${repoSingle}`,
            archived: false,
            private: true,
        }];
    }

    const repos = [];
    let page = 1;

    while (true) {
        const endpoint = `/orgs/${encodeURIComponent(org)}/repos?type=all&per_page=100&page=${page}`;
        const chunk = await ghApiJson(endpoint);

        if (chunk && !Array.isArray(chunk) && typeof chunk === "object" && chunk.message) {
            throw new Error(`GitHub API error while listing repos for org ${org}: ${chunk.message}`);
        }

        if (!Array.isArray(chunk) || chunk.length === 0) break;

        for (const repo of chunk) {
            if (!includeArchived && repo.archived) continue;
            repos.push({
                name: repo.name,
                fullName: repo.full_name,
                archived: Boolean(repo.archived),
                private: Boolean(repo.private),
            });
            if (maxRepos > 0 && repos.length >= maxRepos) return repos;
        }

        if (verbose) {
            console.log(`Fetched repos page ${page}, total repos considered: ${repos.length}`);
        }

        if (chunk.length < 100) break;
        page += 1;
    }

    if (repos.length > 0) return repos;

    const fallbackLimit = maxRepos > 0 ? Math.max(maxRepos, 100) : 5000;
    const fallbackRepos = await ghRepoList(org, fallbackLimit);
    for (const repo of fallbackRepos) {
        if (!includeArchived && repo.isArchived) continue;
        repos.push({
            name: repo.name,
            fullName: repo.nameWithOwner,
            archived: Boolean(repo.isArchived),
            private: Boolean(repo.isPrivate),
        });
        if (maxRepos > 0 && repos.length >= maxRepos) return repos;
    }

    return repos;
}

async function fetchRepoArtifacts(org, repoName) {
    const artifacts = [];
    let page = 1;

    while (true) {
        const endpoint = `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}/actions/artifacts?per_page=100&page=${page}`;
        const data = await ghApiJson(endpoint);

        if (data && !Array.isArray(data) && data.message) {
            throw new Error(data.message);
        }

        const list = Array.isArray(data?.artifacts) ? data.artifacts : [];
        for (const artifact of list) {
            artifacts.push(artifact);
        }

        if (list.length < 100) break;
        page += 1;
    }

    return artifacts;
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

function ageInDays(createdAt, now) {
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return 0;
    return Math.floor((now.getTime() - created.getTime()) / DAY_MS);
}

async function main() {
    const args = parseArgs(process.argv);
    const now = new Date();

    await ensureGhReady();

    console.log(`Scanning ${args.org} for artifacts matching /${args.pattern}/ ...`);
    const repos = await fetchAllOrgRepos(args.org, args.includeArchived, args.maxRepos, args.repo, args.verbose);
    if (repos.length === 0) {
        throw new Error("No repositories found to scan.");
    }

    const matches = [];
    let reposScanned = 0;
    let artifactsScanned = 0;
    const failures = [];

    for (let i = 0; i < repos.length; i += 1) {
        const repo = repos[i];
        reposScanned += 1;
        console.log(`[${i + 1}/${repos.length}] ${repo.name}`);

        try {
            const artifacts = await fetchRepoArtifacts(args.org, repo.name);
            artifactsScanned += artifacts.length;

            for (const artifact of artifacts) {
                const artifactName = String(artifact.name || "");
                if (!args.patternRegex.test(artifactName)) continue;

                const daysOld = ageInDays(artifact.created_at, now);
                if (daysOld < args.olderThanDays) continue;

                matches.push({
                    repo: repo.name,
                    id: artifact.id,
                    name: artifactName,
                    sizeInBytes: Number(artifact.size_in_bytes || 0),
                    createdAt: artifact.created_at || null,
                    expiresAt: artifact.expires_at || null,
                    expired: Boolean(artifact.expired),
                    daysOld,
                });
            }
        } catch (error) {
            failures.push({ repo: repo.name, error: String(error.message || error) });
            if (args.verbose) {
                console.warn(`  Skipping ${repo.name}: ${error.message || error}`);
            }
        }
    }

    matches.sort((a, b) => b.sizeInBytes - a.sizeInBytes);

    let deletedCount = 0;
    let deletedBytes = 0;
    const deleteFailures = [];

    if (args.execute) {
        console.log(`Deleting ${matches.length} matched artifacts...`);
        for (let i = 0; i < matches.length; i += 1) {
            const match = matches[i];
            try {
                await ghApiDelete(`/repos/${encodeURIComponent(args.org)}/${encodeURIComponent(match.repo)}/actions/artifacts/${match.id}`);
                deletedCount += 1;
                deletedBytes += match.sizeInBytes;
                if (args.verbose && (i + 1) % 50 === 0) {
                    console.log(`  Deleted ${i + 1}/${matches.length}`);
                }
            } catch (error) {
                deleteFailures.push({ repo: match.repo, id: match.id, error: String(error.message || error) });
            }
        }
    }

    const matchedBytes = matches.reduce((sum, item) => sum + item.sizeInBytes, 0);

    const report = {
        generatedAt: now.toISOString(),
        mode: args.execute ? "execute" : "dry-run",
        org: args.org,
        filters: {
            repo: args.repo || null,
            includeArchived: args.includeArchived,
            maxRepos: args.maxRepos,
            pattern: args.pattern,
            olderThanDays: args.olderThanDays,
        },
        summary: {
            reposScanned,
            artifactsScanned,
            matchedArtifactCount: matches.length,
            matchedBytes,
            deletedCount,
            deletedBytes,
            repoFailures: failures.length,
            deleteFailures: deleteFailures.length,
        },
        topMatches: matches.slice(0, 200),
        failures,
        deleteFailures,
    };

    const outputDir = path.isAbsolute(args.outputDir)
        ? args.outputDir
        : path.resolve(REPO_ROOT, args.outputDir);
    await fs.mkdir(outputDir, { recursive: true });

    const summaryLines = [
        `Mode: ${args.execute ? "execute" : "dry-run"}`,
        `Org: ${args.org}`,
        `Generated: ${report.generatedAt}`,
        `Repos scanned: ${reposScanned}`,
        `Artifacts scanned: ${artifactsScanned}`,
        `Match pattern: /${args.pattern}/i`,
        `Older than days: ${args.olderThanDays}`,
        `Matched artifacts: ${matches.length}`,
        `Matched bytes: ${formatBytes(matchedBytes)}`,
        `Deleted artifacts: ${deletedCount}`,
        `Deleted bytes: ${formatBytes(deletedBytes)}`,
        `Repo scan failures: ${failures.length}`,
        `Delete failures: ${deleteFailures.length}`,
        "",
        "Top matched artifacts (up to 50):",
        ...matches.slice(0, 50).map((m, idx) => `${idx + 1}. ${m.repo} | ${m.name} | id=${m.id} | ${formatBytes(m.sizeInBytes)} | ${m.daysOld}d old`),
    ];

    const jsonPath = path.join(outputDir, "cleanup-report.json");
    const txtPath = path.join(outputDir, "cleanup-summary.txt");

    await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.writeFile(txtPath, `${summaryLines.join("\n")}\n`, "utf8");

    console.log("\nCleanup scan complete.");
    console.log(`- Summary: ${txtPath}`);
    console.log(`- JSON: ${jsonPath}`);

    if (!args.execute) {
        console.log("\nDry-run only. Re-run with --execute to delete matched artifacts.");
    }
}

main().catch((error) => {
    console.error(`Error: ${error.message || error}`);
    process.exit(1);
});
