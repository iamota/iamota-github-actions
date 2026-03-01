import { apiRequest, paginateGet } from "./github-api-lib.mjs";
import { listPrComments, markerNeedle, upsertMarkerComment } from "./github-pr-comment-lib.mjs";

async function tryDeleteComment(token, repo, commentId) {
    const url = `https://api.github.com/repos/${repo}/issues/comments/${commentId}`;
    try {
        await apiRequest("DELETE", url, token);
    } catch {
        // best-effort cleanup
    }
}

async function upsertComment(token, repo, prNumber, marker, body) {
    await upsertMarkerComment({
        repo,
        prNumber,
        marker,
        body,
        token,
        refreshAfterComments: 0,
    });
}

async function removeLabel(token, repo, prNumber, label) {
    const encoded = encodeURIComponent(label);
    const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/labels/${encoded}`;
    try {
        await apiRequest("DELETE", url, token);
        return true;
    } catch {
        return false;
    }
}

function normalizeLabelNames(labels) {
    return (labels || []).map((l) => String(l?.name || "").toLowerCase());
}

function renderFileDetails(files, maxFilesInComment, maxPatchLines) {
    const displayed = files.slice(0, maxFilesInComment);

    const details = displayed
        .map((file) => {
            const patch = file.patch
                ? String(file.patch).split("\n").slice(0, maxPatchLines).join("\n")
                : "_Diff unavailable (file too large, binary, or GitHub patch omitted)._";

            const fileHeader = `**${file.filename}** (${file.status}, +${file.additions}/-${file.deletions})`;
            const fileLinks = file.blob_url ? `[View file](${file.blob_url})` : "View file unavailable";

            return ["<details>", `<summary>${fileHeader}</summary>`, "", fileLinks, "", "```diff", patch, "```", "</details>"].join(
                "\n"
            );
        })
        .join("\n\n");

    const hiddenCount = files.length - displayed.length;
    const hiddenNote =
        hiddenCount > 0 ? `\n\n_...and ${hiddenCount} additional file(s) not shown to keep this comment readable._` : "";

    return { details, hiddenNote };
}

export async function runManualDeployGuard(opts) {
    const {
        token,
        repo,
        prNumber,
        marker,
        ackLabel,
        pathRegex,
        eventAction,
        beforeSha,
        afterSha,
        title,
        trackedNote,
        requiredSteps,
        failSummary,
        maxFilesInComment,
        maxPatchLines,
    } = opts;

    const filesUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100`;
    const allFiles = await paginateGet(filesUrl, token);
    const matchedFiles = allFiles.filter((file) => pathRegex.test(String(file.filename || "")));

    const markerNeedleValue = markerNeedle(marker);

    if (matchedFiles.length === 0) {
        const comments = await listPrComments(repo, prNumber, token);
        const existing = comments.find((c) => typeof c?.body === "string" && c.body.includes(markerNeedleValue));
        if (existing?.id) await tryDeleteComment(token, repo, existing.id);
        return { passed: true, reason: "no-matching-files" };
    }

    const pullUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}`;
    const { data: pull } = await apiRequest("GET", pullUrl, token);

    const labelNames = normalizeLabelNames(pull?.labels || []);
    let acknowledged = labelNames.includes(String(ackLabel).toLowerCase());
    let ackRevoked = false;

    if (eventAction === "synchronize" && acknowledged && beforeSha && afterSha) {
        const compareUrl = `https://api.github.com/repos/${repo}/compare/${beforeSha}...${afterSha}`;
        try {
            const { data: compare } = await apiRequest("GET", compareUrl, token);
            const changedInPush = Array.isArray(compare?.files) ? compare.files : [];
            const touched = changedInPush.some((f) => pathRegex.test(String(f?.filename || "")));
            if (touched) {
                const removed = await removeLabel(token, repo, prNumber, ackLabel);
                if (removed) {
                    acknowledged = false;
                    ackRevoked = true;
                }
            }
        } catch {
            // best effort only
        }
    }

    const { details, hiddenNote } = renderFileDetails(matchedFiles, maxFilesInComment, maxPatchLines);

    const body = [
        `<!-- ${marker} -->`,
        title,
        "",
        trackedNote,
        "",
        `Detected **${matchedFiles.length}** changed file(s):`,
        "",
        details,
        hiddenNote,
        "",
        "### Required before merge",
        "",
        ...requiredSteps.map((s) => `${s}`),
        "",
        `Acknowledge by adding label \`${ackLabel}\`.`,
        "",
        ackRevoked ? `[INFO] Previous \`${ackLabel}\` acknowledgement was removed after new matching edits.` : "",
        acknowledged
            ? `[OK] Required label \`${ackLabel}\` is present. Guard passes.`
            : `[FAIL] Required label \`${ackLabel}\` is missing. Guard fails until this label is added.`,
    ]
        .filter(Boolean)
        .join("\n");

    await upsertComment(token, repo, prNumber, marker, body);

    if (!acknowledged) {
        return { passed: false, reason: failSummary };
    }

    return { passed: true, reason: "acknowledged" };
}
