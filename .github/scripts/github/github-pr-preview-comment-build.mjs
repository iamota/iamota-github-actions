import fs from "node:fs";

function arg(name, def = "") {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return def;
    return process.argv[idx + 1] || def;
}

function readDriftLines(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return "";
    const lines = fs
        .readFileSync(filePath, "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200)
        .map((s) => `- \`${s}\``);
    return lines.join("\n");
}

function main() {
    const mode = arg("--mode", "success");
    const author = arg("--author");
    const branch = arg("--branch");
    const baseRef = arg("--base-ref");
    const headSha = arg("--head-sha");
    const themeId = arg("--theme-id");
    const previewUrl = arg("--preview-url");
    const driftCount = Number(arg("--drift-count", "0") || "0");
    const driftFilesPath = arg("--drift-files-path", "");
    const sourceStore = arg("--source-store", "");
    const sourceThemeId = arg("--source-theme-id", "");
    const syncAt = arg("--sync-at", "");

    if (mode === "conflict") {
        const body = [
            "<!-- iamota-shopify-preview -->",
            "[FAIL] **Preview not generated** - merge conflicts with `" + baseRef + "`.",
            "",
            "@" + author + " please rebase/merge `" + baseRef + "` into your branch and resolve conflicts.",
        ].join("\n");
        process.stdout.write(body);
        return;
    }

    const driftLines = readDriftLines(driftFilesPath);
    const driftBlock =
        driftCount === 0
            ? "[OK] JSON matches remote."
            : `[FAIL] JSON drift vs remote detected (**${driftCount}** file(s)). This check will fail until the PR matches remote JSON.\n\nChanged files:\n${driftLines}`;

    const body = [
        `<!-- iamota-shopify-preview:theme_id=${themeId} -->`,
        `[OK] **Shopify preview generated** from base \`${sourceStore || "unknown-store"}#${sourceThemeId || "unknown-theme"}\` overlaid with branch \`${branch || "unknown-branch"}\` output.`,
        "",
        `- Preview: ${previewUrl || "(missing)"}`,
        `- Preview Theme ID: \`${themeId || "unknown"}\``,
        `- JSON sync source: \`${sourceStore || "unknown-store"}#${sourceThemeId || "unknown-theme"}\` @ ${syncAt || "unknown-time"}`,
        "",
        driftBlock,
    ].join("\n");

    process.stdout.write(body);
}

main();
