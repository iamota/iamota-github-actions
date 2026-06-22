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
    const ackLabel = arg("--ack-label", "I will manually deploy theme settings");

    if (!repo || !prNumber) throw new Error("Missing --repo or --pr");

    const result = await runManualDeployGuard({
        token,
        repo,
        prNumber,
        marker: "shopify-theme-settings-edit-guard",
        ackLabel,
        pathRegex: /^(src\/)?config\/settings_data\.json$/,
        eventAction,
        beforeSha,
        afterSha,
        title: "## [WARN] Theme settings file changed in this PR",
        trackedNote:
            "This repository tracks `config/settings_data.json` for source control, but theme settings are often changed directly in Shopify Admin and may not match Git exactly.",
        requiredSteps: [
            "1. Review the settings diff snippets above.",
            "2. In Shopify Admin on the destination theme/environment, apply only the specific setting changes from this PR.",
            "3. Do not replace the entire settings file; preserve unrelated CMS-managed theme settings changes.",
            "4. Confirm the destination theme remains in sync and no unrelated settings were overwritten.",
        ],
        failSummary: `Theme settings were modified. Add the PR label \"${ackLabel}\" after applying changes in Shopify.`,
        maxFilesInComment: 8,
        maxPatchLines: 120,
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
