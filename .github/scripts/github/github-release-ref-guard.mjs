import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { apiRequest, paginateGet } from "./github-api-lib.mjs";

const SCAN_DIRS = [
    ".github/workflows",
    ".github/actions",
];

const USES_REF_REGEX = /uses:\s*iamota\/iamota-github-actions\/[\w./-]+@v(\d+)\b/g;

function parseReleaseMajor(branchName) {
    const m = String(branchName || "").match(/^(?:release\/)?v(\d+)(?:\.\d+)?$/);
    if (!m) return null;
    return Number(m[1]);
}

async function walk(dir) {
    const out = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await walk(full)));
            continue;
        }
        if (/\.ya?ml$/i.test(entry.name)) out.push(full);
    }
    return out;
}

async function findInternalVersionRefs() {
    const refs = [];

    for (const scanDir of SCAN_DIRS) {
        let files = [];
        try {
            files = await walk(scanDir);
        } catch {
            continue;
        }

        for (const file of files) {
            const text = await readFile(file, "utf8");
            const lines = text.split(/\r?\n/);

            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i];
                USES_REF_REGEX.lastIndex = 0;
                let match;
                while ((match = USES_REF_REGEX.exec(line)) !== null) {
                    refs.push({
                        file: file.replaceAll("\\", "/"),
                        line: i + 1,
                        major: Number(match[1]),
                        snippet: line.trim(),
                    });
                }
            }
        }
    }

    return refs;
}

function formatIssueBody({ branchName, expectedMajor, mismatches }) {
    const marker = `<!-- release-ref-guard:branch=${branchName} -->`;
    const header = [
        marker,
        `Release reference guard detected mismatched internal version pins.`,
        "",
        `- Branch: \`${branchName}\``,
        `- Expected internal pin: \`@v${expectedMajor}\``,
        `- Mismatch count: ${mismatches.length}`,
        "",
        "## Mismatches",
    ];

    const rows = mismatches.slice(0, 200).map((m) =>
        `- ${m.file}:${m.line} expected @v${expectedMajor}, found @v${m.major}  \\`${m.snippet}\\``
    );

    if (mismatches.length > 200) {
        rows.push(`- ...and ${mismatches.length - 200} more`);
    }

    const footer = [
        "",
        "Please update internal `uses: iamota/iamota-github-actions/...@vN` references to match the release major before tagging.",
    ];

    return [...header, ...rows, ...footer].join("\n");
}

async function upsertIssue({ repo, token, title, body, marker }) {
    const issues = await paginateGet(
        `https://api.github.com/repos/${repo}/issues?state=open&per_page=100`,
        token
    );

    const existing = issues.find(
        (i) => !i?.pull_request && (i?.title === title || String(i?.body || "").includes(marker))
    );

    if (existing) {
        await apiRequest("PATCH", `https://api.github.com/repos/${repo}/issues/${existing.number}`, token, {
            title,
            body,
        });
        return { action: "updated", number: existing.number };
    }

    const created = await apiRequest("POST", `https://api.github.com/repos/${repo}/issues`, token, {
        title,
        body,
    });

    return { action: "created", number: created?.data?.number || "" };
}

async function main() {
    const branchName = process.env.GITHUB_REF_NAME || "";
    const releaseMajor = parseReleaseMajor(branchName);

    if (releaseMajor == null) {
        console.log(
            `Release ref guard skipped: branch '${branchName}' is not release/v<major>[.<minor>] or v<major>[.<minor>].`
        );
        return;
    }

    const refs = await findInternalVersionRefs();
    const mismatches = refs.filter((r) => r.major !== releaseMajor);

    if (mismatches.length === 0) {
        console.log(
            `Release ref guard passed for ${branchName}: all internal iamota refs match @v${releaseMajor}.`
        );
        return;
    }

    const repo = process.env.GITHUB_REPOSITORY;
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const title = `Release ref mismatch: ${branchName} expects @v${releaseMajor}`;
    const marker = `<!-- release-ref-guard:branch=${branchName} -->`;
    const body = formatIssueBody({
        branchName,
        expectedMajor: releaseMajor,
        mismatches,
    });

    if (!repo || !token) {
        console.error("Release ref guard failed and could not open an issue (missing GITHUB_REPOSITORY or GITHUB_TOKEN).");
        console.error(body);
        process.exit(1);
    }

    const issueResult = await upsertIssue({ repo, token, title, body, marker });
    console.error(
        `Release ref guard failed for ${branchName}: found ${mismatches.length} mismatch(es). Issue ${issueResult.action} #${issueResult.number}.`
    );
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
