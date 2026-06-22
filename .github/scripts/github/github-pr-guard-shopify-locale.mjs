import { runManualDeployGuard } from "./github-pr-guard-core.mjs";

function arg(name, fallback = "") {
    const i = process.argv.indexOf(name);
    if (i === -1) return fallback;
    return process.argv[i + 1] || fallback;
}

async function main() {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Missing GH_TOKEN/GITHUB_TOKEN");

    const repo = arg("--repo");
    const prNumber = arg("--pr");
    const eventAction = arg("--event-action");
    const beforeSha = arg("--before");
    const afterSha = arg("--after");
    const ackLabel = arg("--ack-label", "I will manually deploy locales");

    if (!repo || !prNumber) throw new Error("Missing --repo or --pr");

    const result = await runManualDeployGuard({
        token,
        repo,
        prNumber,
        marker: "shopify-locale-edit-guard",
        ackLabel,
        pathRegex: /^src\/locales\/.*\.json$/,
        eventAction,
        beforeSha,
        afterSha,
        title: "## [WARN] Locale files changed in this PR",
        trackedNote:
            "This repository tracks `src/locales/*.json` for source control, but locale values are managed in Shopify and are not deployed by the standard theme deploy workflow.",
        requiredSteps: [
            "1. Review the locale diff snippets above.",
            "2. In Shopify Admin on the destination theme/environment, apply only the specific key-level changes from this PR.",
            "3. Do not replace the entire locale file; CMS-managed locale content may contain additional changes not present in Git.",
            "4. Confirm the destination theme remains in sync and no unrelated CMS locale updates were overwritten.",
        ],
        failSummary: `Locale files were modified. Add the PR label \"${ackLabel}\" after applying changes in Shopify.`,
        maxFilesInComment: 12,
        maxPatchLines: 80,
    });

    if (!result.passed) {
        console.error(result.reason);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
