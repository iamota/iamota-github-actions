import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyPr,
    canRequest,
    decideFromEvent,
    hasPreviewMarker,
    normalizeMode,
    parseCommand,
} from "../../.github/scripts/github/github-pr-preview-request-lib.mjs";
import { findLatestMarkerComment } from "../../.github/scripts/github/github-pr-comment-lib.mjs";

const PR = {
    number: 12,
    state: "open",
    head: { ref: "feature/x", sha: "abc", repo: { full_name: "iamota/site" } },
    base: { ref: "dev", sha: "def" },
};

function comment(body, extra = {}) {
    return {
        action: "created",
        issue: { number: 12, pull_request: { url: "x" } },
        comment: { id: 99, body, user: { login: "dev", type: "User" }, author_association: "MEMBER", ...extra },
    };
}

test("normalizeMode", () => {
    assert.equal(normalizeMode(""), "auto");
    assert.equal(normalizeMode("On-Demand"), "on_demand");
    assert.throws(() => normalizeMode("sometimes"));
});

test("parseCommand reads the first non-empty line only", () => {
    assert.deepEqual(parseCommand("/preview"), { sub: "update", word: "" });
    assert.deepEqual(parseCommand("\n  /Preview fresh  \nthanks"), { sub: "fresh", word: "fresh" });
    assert.equal(parseCommand("/preview stop please").sub, "stop");
    assert.deepEqual(parseCommand("/preview banana"), { sub: "help", word: "banana", unknown: true });
    assert.equal(parseCommand("please /preview"), null);
    assert.equal(parseCommand("/previews"), null);
    assert.equal(parseCommand("looks good\n/preview"), null);
    assert.equal(parseCommand("/deploy", "/deploy").sub, "update");
});

test("pull_request events in auto and on_demand modes", () => {
    const ev = (action) => ({ action, pull_request: PR });
    assert.equal(decideFromEvent({ eventName: "pull_request", event: ev("synchronize"), mode: "auto" }).action, "preview");
    assert.equal(decideFromEvent({ eventName: "pull_request", event: ev("synchronize"), mode: "on_demand" }).action, "skip");
    assert.equal(decideFromEvent({ eventName: "pull_request", event: ev("opened"), mode: "on_demand" }).action, "help");
    const closed = decideFromEvent({ eventName: "pull_request", event: ev("closed"), mode: "on_demand" });
    assert.equal(closed.action, "cleanup");
    assert.deepEqual(closed.needs, ["existing"]);
    assert.equal(closed.head_sha, "abc");
    assert.equal(closed.checkout_ref, "");
});

test("comment commands work in either mode", () => {
    for (const mode of ["auto", "on_demand"]) {
        const d = decideFromEvent({ eventName: "issue_comment", event: comment("/preview fresh"), mode });
        assert.equal(d.action, "preview");
        assert.equal(d.fresh, "true");
        assert.equal(d.comment_id, "99");
        assert.deepEqual(d.needs, ["permission", "pr"]);
    }
    assert.equal(decideFromEvent({ eventName: "issue_comment", event: comment("/preview stop") }).action, "cleanup");
    assert.equal(decideFromEvent({ eventName: "issue_comment", event: comment("/preview help") }).action, "help");
});

test("comments that are not commands are skipped", () => {
    assert.equal(decideFromEvent({ eventName: "issue_comment", event: comment("nice work") }).action, "skip");
    assert.equal(decideFromEvent({ eventName: "issue_comment", event: comment("/preview", { user: { login: "bot", type: "Bot" } }) }).action, "skip");
    const onIssue = comment("/preview");
    delete onIssue.issue.pull_request;
    assert.equal(decideFromEvent({ eventName: "issue_comment", event: onIssue }).action, "skip");
    assert.equal(decideFromEvent({ eventName: "issue_comment", event: { ...comment("/preview"), action: "edited" } }).action, "skip");
});

test("canRequest needs write access", () => {
    assert.equal(canRequest({ permission: "write" }), true);
    assert.equal(canRequest({ permission: "admin" }), true);
    assert.equal(canRequest({ permission: "read", association: "MEMBER" }), false);
    assert.equal(canRequest({ permission: "", association: "COLLABORATOR" }), true);
    assert.equal(canRequest({ permission: "", association: "CONTRIBUTOR" }), false);
});

test("applyPr fills refs and refuses closed or fork PRs", () => {
    const d = decideFromEvent({ eventName: "issue_comment", event: comment("/preview") });
    const ok = applyPr(d, PR, "iamota/site");
    assert.equal(ok.action, "preview");
    assert.equal(ok.base_ref, "dev");
    assert.equal(ok.checkout_ref, "abc");
    assert.equal(applyPr(d, { ...PR, state: "closed" }, "iamota/site").action, "reply");
    const fork = { ...PR, head: { ...PR.head, repo: { full_name: "someone/site" } } };
    assert.equal(applyPr(d, fork, "iamota/site").action, "reply");
});

test("hasPreviewMarker ignores summary, help and emptied markers", () => {
    assert.equal(hasPreviewMarker([{ body: "<!-- iamota-shopify-preview-store-a:theme_id=123 -->" }]), true);
    assert.equal(hasPreviewMarker([{ body: "<!-- iamota-shopify-preview-store-a:theme_id= -->" }]), false);
    assert.equal(hasPreviewMarker([{ body: "<!-- iamota-shopify-preview-summary -->\n<!-- iamota-shopify-preview-help -->" }]), false);
});

test("findLatestMarkerComment prefers the most recently edited comment", () => {
    const marker = "iamota-shopify-preview-store-a";
    const summary = { id: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z", body: `<!-- ${marker}:theme_id=2 -->` };
    const cleanup = { id: 2, created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", body: `<!-- ${marker}:theme_id= -->` };
    assert.equal(findLatestMarkerComment([summary, cleanup], marker).id, 1);
});
