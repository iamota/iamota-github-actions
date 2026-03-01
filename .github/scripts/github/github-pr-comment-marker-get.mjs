import { countNewerComments, extractByRegex, findLatestMarkerComment, listPrComments } from "./github-pr-comment-lib.mjs";

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

function boolFromInput(v) {
    const s = String(v || "").trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(s)) return true;
    if (["0", "false", "no", "n", "off", ""].includes(s)) return false;
    throw new Error(`Invalid boolean: ${v}`);
}

async function main() {
    const repo = arg("--repo");
    const pr = arg("--pr");
    const marker = arg("--marker");
    const extractRegex = argOptional("--extract-regex", "");
    const refreshAfter = Number(argOptional("--refresh-after-comments", "0") || "0");
    const includeBody = boolFromInput(argOptional("--include-body", "false"));

    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Missing GH_TOKEN/GITHUB_TOKEN");

    const comments = await listPrComments(repo, pr, token);
    const markerComment = findLatestMarkerComment(comments, marker);

    if (!markerComment) {
        process.stdout.write(
            JSON.stringify(
                {
                    found: false,
                    comment_id: "",
                    extracted_value: "",
                    newer_comment_count: 0,
                    should_refresh: false,
                    body: "",
                },
                null,
                2
            )
        );
        return;
    }

    const body = String(markerComment?.body || "");
    const newerCount = countNewerComments(comments, markerComment?.id);
    const shouldRefresh = refreshAfter > 0 ? newerCount >= refreshAfter : false;

    process.stdout.write(
        JSON.stringify(
            {
                found: true,
                comment_id: markerComment?.id || "",
                extracted_value: extractByRegex(body, extractRegex),
                newer_comment_count: newerCount,
                should_refresh: shouldRefresh,
                body: includeBody ? body : "",
            },
            null,
            2
        )
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
