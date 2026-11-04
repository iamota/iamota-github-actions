// Decides what a Shopify theme preview run should do for the triggering event:
//   preview  build or update the PR's preview themes
//   cleanup  delete them
//   help     explain how to request previews
//   reply    answer a /preview comment that can't be acted on (reason says why)
//   skip     nothing to do
//
// Pure functions here; github-pr-preview-request.mjs adds the GitHub API checks.

export const MODES = ["auto", "on_demand"];

export function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase().replace(/-/g, "_");
    if (!mode) return "auto";
    if (!MODES.includes(mode)) throw new Error(`Invalid preview mode "${value}" (expected auto or on_demand)`);
    return mode;
}

const SUBCOMMANDS = {
    "": "update",
    update: "update",
    fresh: "fresh",
    rebuild: "fresh",
    stop: "stop",
    delete: "stop",
    remove: "stop",
    help: "help",
};

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reads the command from the first non-empty line of a comment:
// "/preview", "/preview fresh", "/preview stop", "/preview help".
// Returns null when the comment isn't a preview command.
export function parseCommand(body, command = "/preview") {
    const line = String(body || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
    if (!line) return null;
    const m = line.match(new RegExp(`^${escapeRegex(command)}(?:\\s+(\\S+))?(?:\\s.*)?$`, "i"));
    if (!m) return null;
    const word = String(m[1] || "").toLowerCase();
    const sub = SUBCOMMANDS[word];
    return sub ? { sub, word } : { sub: "help", word, unknown: true };
}

function prFields(pr) {
    return {
        pr_number: String(pr?.number || ""),
        head_ref: pr?.head?.ref || "",
        head_sha: pr?.head?.sha || "",
        head_repo: pr?.head?.repo?.full_name || "",
        base_ref: pr?.base?.ref || "",
        base_sha: pr?.base?.sha || "",
    };
}

// First pass from the event payload alone. `needs` lists the API checks the
// caller must run before acting: "permission", "pr" (load + validate the PR)
// and "existing" (only act if preview themes exist).
export function decideFromEvent({ eventName, event, mode, command = "/preview" }) {
    const m = normalizeMode(mode);

    if (eventName === "pull_request") {
        const pr = event?.pull_request;
        const base = { ...prFields(pr), checkout_ref: "", comment_id: "", fresh: "false", needs: [] };
        const action = event?.action;
        if (action === "closed") return { ...base, action: "cleanup", reason: "PR closed", needs: ["existing"] };
        if (m === "auto" && ["opened", "reopened", "synchronize", "labeled"].includes(action)) {
            return { ...base, action: "preview", reason: `auto: ${action}` };
        }
        if (m === "on_demand" && ["opened", "reopened"].includes(action)) {
            return { ...base, action: "help", reason: `on_demand: ${action}` };
        }
        return { ...base, action: "skip", reason: `${m}: ${action} does not build previews` };
    }

    if (eventName === "issue_comment") {
        const empty = { pr_number: String(event?.issue?.number || ""), checkout_ref: "", comment_id: "", fresh: "false", needs: [] };
        if (event?.action !== "created") return { ...empty, action: "skip", reason: "comment not newly created" };
        if (!event?.issue?.pull_request) return { ...empty, action: "skip", reason: "comment is not on a PR" };
        if (event?.comment?.user?.type === "Bot") return { ...empty, action: "skip", reason: "comment by a bot" };
        const parsed = parseCommand(event?.comment?.body, command);
        if (!parsed) return { ...empty, action: "skip", reason: "not a preview command" };

        const base = { ...empty, comment_id: String(event?.comment?.id || ""), requested_by: event?.comment?.user?.login || "" };
        if (parsed.sub === "help") {
            return {
                ...base,
                action: "help",
                reason: parsed.unknown ? `unknown option "${parsed.word}"` : "help requested",
                needs: ["pr"],
            };
        }
        if (parsed.sub === "stop") return { ...base, action: "cleanup", reason: "stop requested", needs: ["permission", "pr", "existing"] };
        return {
            ...base,
            action: "preview",
            fresh: parsed.sub === "fresh" ? "true" : "false",
            reason: parsed.sub === "fresh" ? "fresh rebuild requested" : "preview requested",
            needs: ["permission", "pr"],
        };
    }

    return { pr_number: "", checkout_ref: "", comment_id: "", fresh: "false", needs: [], action: "skip", reason: `unsupported event ${eventName}` };
}

export const WRITE_PERMISSIONS = ["admin", "maintain", "write"];
const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

export function canRequest({ permission, association }) {
    if (permission) return WRITE_PERMISSIONS.includes(String(permission).toLowerCase());
    return TRUSTED_ASSOCIATIONS.includes(String(association || "").toUpperCase());
}

// Applies the loaded PR to a comment-triggered decision.
export function applyPr(decision, pr, repository) {
    const fields = prFields(pr);
    const next = { ...decision, ...fields, checkout_ref: fields.head_sha };
    if (decision.action === "help" || decision.action === "skip") return next;
    if (pr?.state !== "open") return { ...next, action: "reply", reason: "This PR is closed, so previews can't be built." };
    if (fields.head_repo && fields.head_repo.toLowerCase() !== String(repository || "").toLowerCase()) {
        return { ...next, action: "reply", reason: "Previews aren't built for PRs from forks, because the build would run with this repo's store tokens." };
    }
    return next;
}

// A preview exists when some PR comment carries a per-store marker with a theme id.
export function hasPreviewMarker(comments) {
    return (comments || []).some((c) => /<!--\s*iamota-shopify-preview-(?!summary|help)[^\s:]+:theme_id=\d+/.test(String(c?.body || "")));
}
