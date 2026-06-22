import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const cfg = {
    themePullDir: envStr("THEME_PULL_DIR", "_remote_theme"),
    themeSrc: envStr("THEME_SRC", envStr("THEME_ROOT", "src")),

    enableDeletions: envBool("ENABLE_DELETIONS", true),
    dryRun: envBool("DRY_RUN", false),

    onDuplicateBasename: envEnum("ON_DUPLICATE_BASENAME", ["replace_first", "fail"], "replace_first"),
    requireRepoBaseExists: envBool("REQUIRE_REPO_BASE_EXISTS", false),

    writeReport: envBool("WRITE_REPORT", false),
    reportPath: envStr("REPORT_PATH", "shopify-json-sync.report.json"),
};

function envStr(name, def) {
    const v = process.env[name];
    return v === undefined || v === null || String(v).trim() === "" ? def : String(v);
}

function envBool(name, def) {
    const v = process.env[name];
    if (v === undefined || v === null || String(v).trim() === "") return def;
    const s = String(v).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(s)) return true;
    if (["0", "false", "no", "n", "off"].includes(s)) return false;
    throw new Error(`Invalid boolean for ${name}: ${v}`);
}

function envEnum(name, allowed, def) {
    const v = envStr(name, def);
    if (!allowed.includes(v)) {
        throw new Error(`Invalid value for ${name}: "${v}". Allowed: ${allowed.join(", ")}`);
    }
    return v;
}

function toPosix(p) {
    return p.split(path.sep).join("/");
}

async function exists(p) {
    try {
        await fs.stat(p);
        return true;
    } catch {
        return false;
    }
}

async function listFilesRecursive(dir) {
    const out = [];
    if (!(await exists(dir))) return out;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            out.push(...(await listFilesRecursive(full)));
        } else if (e.isFile()) {
            out.push(full);
        }
    }
    return out;
}

async function listTopLevelDirs(dir) {
    if (!(await exists(dir))) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
}

async function removeEmptyDirs(dir) {
    if (!(await exists(dir))) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        if (e.isDirectory()) {
            await removeEmptyDirs(path.join(dir, e.name));
        }
    }

    const after = await fs.readdir(dir).catch(() => []);
    if (after.length === 0) {
        await fs.rmdir(dir).catch(() => {});
    }
}

function basenameOf(p) {
    return path.basename(p);
}

function filePrefix(filename) {
    const firstDot = filename.indexOf(".");
    if (firstDot === -1) return filename.replace(/\.json$/i, "");
    return filename.slice(0, firstDot);
}

async function readFileHash(p) {
    const buf = await fs.readFile(p);
    return crypto.createHash("sha256").update(buf).digest("hex");
}

async function copyFileIfDifferent(src, dest) {
    const destExists = await exists(dest);

    if (destExists) {
        const [h1, h2] = await Promise.all([readFileHash(src), readFileHash(dest)]);
        if (h1 === h2) return { changed: false };
    }

    if (!cfg.dryRun) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
    }
    return { changed: true };
}

async function deleteFile(p) {
    if (!cfg.dryRun) {
        await fs.unlink(p);
    }
}

function repoRel(absPath) {
    return toPosix(absPath);
}

async function syncBaseFolder(base) {
    const remoteBaseDir = path.join(cfg.themePullDir, base);
    const repoBaseDir = path.join(cfg.themeSrc, base);

    if (!(await exists(remoteBaseDir))) {
        return {
            base,
            skipped: true,
            reason: `Remote folder missing: ${remoteBaseDir}`,
            added: 0,
            replaced: 0,
            deleted: 0,
            unchanged: 0,
            files: { added: [], replaced: [], deleted: [] },
        };
    }

    const repoBaseExists = await exists(repoBaseDir);
    if (cfg.requireRepoBaseExists && !repoBaseExists) {
        return {
            base,
            skipped: true,
            reason: `Repo base missing and REQUIRE_REPO_BASE_EXISTS=true: ${repoBaseDir}`,
            added: 0,
            replaced: 0,
            deleted: 0,
            unchanged: 0,
            files: { added: [], replaced: [], deleted: [] },
        };
    }

    const remoteJsonFiles = (await listFilesRecursive(remoteBaseDir)).filter((p) => p.toLowerCase().endsWith(".json"));
    const repoJsonFiles = (await listFilesRecursive(repoBaseDir)).filter((p) => p.toLowerCase().endsWith(".json"));

    const remoteByName = new Map();
    for (const f of remoteJsonFiles) {
        remoteByName.set(basenameOf(f), f);
    }

    const repoByName = new Map();
    for (const f of repoJsonFiles) {
        const name = basenameOf(f);
        const list = repoByName.get(name) ?? [];
        list.push(f);
        repoByName.set(name, list);
    }

    if (cfg.onDuplicateBasename === "fail") {
        const dups = [...repoByName.entries()].filter(([, list]) => list.length > 1);
        if (dups.length > 0) {
            const msg = dups
                .slice(0, 10)
                .map(([name, list]) => `- ${name}: ${list.join(", ")}`)
                .join("\n");
            throw new Error(`Duplicate basenames under ${repoBaseDir} (ON_DUPLICATE_BASENAME=fail).\n${msg}`);
        }
    }

    const filesAdded = [];
    const filesReplaced = [];
    const filesDeleted = [];

    let added = 0;
    let replaced = 0;
    let unchanged = 0;

    for (const [name, remotePath] of remoteByName.entries()) {
        const matches = (repoByName.get(name) ?? []).slice().sort();

        let destPath;
        let actionType;

        if (matches.length > 0) {
            destPath = matches[0];
            actionType = "replace";
        } else {
            const prefix = filePrefix(name);
            destPath = path.join(repoBaseDir, prefix, name);
            actionType = "add";
        }

        const { changed } = await copyFileIfDifferent(remotePath, destPath);

        if (!changed) {
            unchanged += 1;
            continue;
        }

        if (actionType === "add") {
            added += 1;
            filesAdded.push(repoRel(destPath));
        } else {
            replaced += 1;
            filesReplaced.push(repoRel(destPath));
        }
    }

    let deleted = 0;
    if (cfg.enableDeletions) {
        for (const [name, repoPaths] of repoByName.entries()) {
            if (!remoteByName.has(name)) {
                for (const p of repoPaths) {
                    await deleteFile(p);
                    deleted += 1;
                    filesDeleted.push(repoRel(p));
                }
            }
        }
    }

    if (!cfg.dryRun) {
        await removeEmptyDirs(repoBaseDir);
    }

    return {
        base,
        skipped: false,
        reason: "",
        added,
        replaced,
        deleted,
        unchanged,
        files: {
            added: filesAdded.sort(),
            replaced: filesReplaced.sort(),
            deleted: filesDeleted.sort(),
        },
    };
}

async function main() {
    const syncBases = await listTopLevelDirs(cfg.themePullDir);

    const report = {
        startedAt: new Date().toISOString(),
        finishedAt: "",
        dryRun: cfg.dryRun,
        config: {
            THEME_PULL_DIR: cfg.themePullDir,
            THEME_SRC: cfg.themeSrc,
            SYNC_BASES_AUTO_DISCOVERED: syncBases,
            ENABLE_DELETIONS: cfg.enableDeletions,
            ON_DUPLICATE_BASENAME: cfg.onDuplicateBasename,
            REQUIRE_REPO_BASE_EXISTS: cfg.requireRepoBaseExists,
        },
        totals: {
            added: 0,
            replaced: 0,
            deleted: 0,
            unchanged: 0,
        },
        bases: [],
    };

    for (const base of syncBases) {
        const r = await syncBaseFolder(base);
        report.bases.push(r);

        if (!r.skipped) {
            report.totals.added += r.added;
            report.totals.replaced += r.replaced;
            report.totals.deleted += r.deleted;
            report.totals.unchanged += r.unchanged;
        }
    }

    report.finishedAt = new Date().toISOString();

    if (cfg.writeReport) {
        await fs.mkdir(path.dirname(cfg.reportPath), { recursive: true }).catch(() => {});
        await fs.writeFile(cfg.reportPath, JSON.stringify(report, null, 4), "utf8");
    }

    console.log(
        JSON.stringify(
            {
                dryRun: cfg.dryRun,
                totals: report.totals,
            },
            null,
            4
        )
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
