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
    const sourceStoreHostRaw = arg("--source-store-host", "");
    const sourceThemeId = arg("--source-theme-id", "");
    const syncAt = arg("--sync-at", "");
    const previewThemeName = arg("--preview-theme-name", "Preview Theme");

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

    const sourceStoreHost = sourceStoreHostRaw
        ? sourceStoreHostRaw
        : sourceStore
          ? `${sourceStore}.myshopify.com`
          : "";

    let resolvedThemeId = themeId || "";
    if (!resolvedThemeId && previewUrl) {
        const m = String(previewUrl).match(/[?&]preview_theme_id=(\d+)/);
        resolvedThemeId = m ? m[1] : "";
    }
    if (!resolvedThemeId) resolvedThemeId = "unknown";

    const baseThemeUrl =
        sourceStoreHost && sourceThemeId
            ? `https://${sourceStoreHost}?preview_theme_id=${sourceThemeId}`
            : "";

    const firstLine = baseThemeUrl
        ? `Shopify preview theme [${previewThemeName}](${previewUrl || "#"}) generated using the latest JSON content from [base theme](${baseThemeUrl}) @ ${syncAt || "unknown-time"}.`
        : `Shopify preview theme [${previewThemeName}](${previewUrl || "#"}) generated @ ${syncAt || "unknown-time"}.`;

    let driftBlock = "";
    if (driftCount > 0) {
        const driftLines = readDriftLines(driftFilesPath);
        driftBlock = `\n[WARN] JSON drift vs remote detected (**${driftCount}** file(s)).\n\nChanged files:\n${driftLines}`;
    }

    const body = [
        `<!-- iamota-shopify-preview:theme_id=${resolvedThemeId} -->`,
        firstLine,
        "",
        `Preview Theme ID: \`${resolvedThemeId}\``,
        `Base Theme ID (JSON content source): \`${sourceThemeId || "unknown"}\``,
        driftBlock,
    ].join("\n");

    process.stdout.write(body);
}

main();
