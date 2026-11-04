// Resolves what a theme preview run should do (see github-pr-preview-request-lib.mjs)
// and writes the decision to GITHUB_OUTPUT. Read-only: posts nothing.
//
// Env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GH_TOKEN,
//      INPUT_MODE (auto | on_demand), INPUT_COMMAND (default /preview).
import fs from "node:fs";
import { apiRequest } from "./github-api-lib.mjs";
import { listPrComments } from "./github-pr-comment-lib.mjs";
import { applyPr, canRequest, decideFromEvent, hasPreviewMarker, normalizeMode } from "./github-pr-preview-request-lib.mjs";

const OUTPUTS = ["action", "reason", "fresh", "pr_number", "head_ref", "head_sha", "base_ref", "base_sha", "checkout_ref", "comment_id", "requested_by", "mode"];

async function main() {
    const eventName = process.env.GITHUB_EVENT_NAME || "";
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const repo = process.env.GITHUB_REPOSITORY || "";
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
    const command = process.env.INPUT_COMMAND || "/preview";

    let d = decideFromEvent({ eventName, event, mode: process.env.INPUT_MODE, command });
    d.mode = normalizeMode(process.env.INPUT_MODE);
    const needs = new Set(d.needs || []);

    if (needs.has("permission") && d.action !== "skip") {
        const login = event?.comment?.user?.login || "";
        let permission = "";
        try {
            const res = await apiRequest("GET", `https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`, token);
            permission = res?.data?.permission || "none";
        } catch (err) {
            console.log(`Permission lookup failed (${err.message}); falling back to author_association.`);
        }
        if (!canRequest({ permission, association: event?.comment?.author_association })) {
            d = { ...d, action: "reply", reason: `@${login} needs write access to this repo to request previews.` };
        }
    }

    if (needs.has("pr") && d.action !== "skip") {
        const res = await apiRequest("GET", `https://api.github.com/repos/${repo}/pulls/${d.pr_number}`, token);
        d = d.action === "reply" ? { ...applyPr(d, res.data, repo), action: "reply", reason: d.reason } : applyPr(d, res.data, repo);
    }

    if (needs.has("existing") && d.action === "cleanup") {
        const comments = await listPrComments(repo, d.pr_number, token);
        if (!hasPreviewMarker(comments)) {
            d = eventName === "issue_comment"
                ? { ...d, action: "reply", reason: "There are no preview themes to delete." }
                : { ...d, action: "skip", reason: "PR closed with no preview themes" };
        }
    }

    console.log(`Preview request: ${d.action} (${d.reason})`);
    const out = process.env.GITHUB_OUTPUT;
    for (const key of OUTPUTS) {
        const value = String(d[key] ?? "").replace(/\r?\n/g, " ");
        if (out) fs.appendFileSync(out, `${key}=${value}\n`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
