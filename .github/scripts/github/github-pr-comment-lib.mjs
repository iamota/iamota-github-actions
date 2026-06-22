import { apiRequest, paginateGet } from "./github-api-lib.mjs";

export async function listPrComments(repo, prNumber, token) {
    const commentsUrl = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
    return paginateGet(commentsUrl, token);
}

export function markerNeedle(marker) {
    return `<!-- ${marker}`;
}

function escapeRegex(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function markerRegex(marker) {
    const esc = escapeRegex(marker);
    // Match marker boundaries exactly:
    // <!-- marker -->
    // <!-- marker:... -->
    return new RegExp(`<!--\\s*${esc}(?:\\s*-->|:)`);
}

export function markerMatches(body, marker) {
    if (typeof body !== "string") return false;
    return markerRegex(marker).test(body);
}

export function orderCommentsAsc(comments) {
    return (comments || [])
        .filter((c) => c && typeof c === "object")
        .sort((a, b) => new Date(a?.created_at || 0) - new Date(b?.created_at || 0));
}

export function findLatestMarkerComment(comments, marker) {
    const matches = (body) => markerMatches(body, marker);
    return (comments || [])
        .filter((c) => matches(c?.body))
        .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0))[0];
}

export function countNewerComments(comments, commentId) {
    const ordered = orderCommentsAsc(comments);
    const idx = ordered.findIndex((c) => Number(c?.id || 0) === Number(commentId || 0));
    return idx === -1 ? 0 : Math.max(0, ordered.length - idx - 1);
}

export function extractByRegex(body, regexPattern) {
    if (!regexPattern) return "";
    const rx = new RegExp(regexPattern);
    const m = String(body || "").match(rx);
    if (!m) return "";
    return m[1] || m[0] || "";
}

export function extractByRegexForMarker(body, marker, regexPattern) {
    if (!regexPattern) return "";
    const text = String(body || "");
    const line = text
        .split(/\r?\n/)
        .find((entry) => markerMatches(entry, marker));

    return extractByRegex(line || text, regexPattern);
}

export async function syncMarkerComment({ repo, prNumber, marker, body, token, refreshAfterComments = 0 }) {
    const comments = await listPrComments(repo, prNumber, token);
    const existing = findLatestMarkerComment(comments, marker);

    if (!existing) {
        const createUrl = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
        const created = await apiRequest("POST", createUrl, token, { body });
        return { action: "created", comment_id: created?.data?.id || "", newer_comment_count: 0, refreshed: false };
    }

    const newerCount = countNewerComments(comments, existing?.id);
    const shouldRefresh = refreshAfterComments > 0 ? newerCount >= refreshAfterComments : false;

    if (shouldRefresh) {
        const createUrl = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
        const created = await apiRequest("POST", createUrl, token, { body });
        return {
            action: "refreshed",
            comment_id: created?.data?.id || "",
            newer_comment_count: newerCount,
            refreshed: true,
        };
    }

    const updateUrl = `https://api.github.com/repos/${repo}/issues/comments/${existing.id}`;
    const updated = await apiRequest("PATCH", updateUrl, token, { body });
    return {
        action: "updated",
        comment_id: updated?.data?.id || existing?.id || "",
        newer_comment_count: newerCount,
        refreshed: false,
    };
}
