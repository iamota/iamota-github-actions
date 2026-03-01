import { upsertMarkerComment } from "./github-pr-comment-lib.mjs";

function arg(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) throw new Error(`Missing ${name}`);
    return process.argv[idx + 1];
}

function argOptional(name, def = "") {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return def;
    return process.argv[idx + 1];
}

async function main() {
    const repo = arg("--repo");
    const pr = arg("--pr");
    const marker = arg("--marker");
    const body = arg("--body");
    const refreshAfter = Number(argOptional("--refresh-after-comments", "0") || "0");

    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Missing GH_TOKEN/GITHUB_TOKEN");

    const result = await upsertMarkerComment({
        repo,
        prNumber: pr,
        marker,
        body,
        token,
        refreshAfterComments: refreshAfter,
    });

    process.stdout.write(JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
