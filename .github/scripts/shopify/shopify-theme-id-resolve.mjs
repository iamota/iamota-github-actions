import { spawnSync } from "node:child_process";

function arg(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) throw new Error(`Missing ${name}`);
    return process.argv[idx + 1] || "";
}

function toThemeId(value) {
    const s = String(value ?? "").trim();
    const digits = s.replace(/\D/g, "");
    return digits || "";
}

function isLiveAlias(value) {
    return String(value ?? "").trim().toLowerCase() === "live";
}

function collectThemeLikeObjects(node, out = []) {
    if (!node || typeof node !== "object") return out;

    if (Array.isArray(node)) {
        for (const item of node) collectThemeLikeObjects(item, out);
        return out;
    }

    if (Object.prototype.hasOwnProperty.call(node, "id")) {
        out.push(node);
    }

    for (const key of ["themes", "theme", "data", "items", "results"]) {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
            collectThemeLikeObjects(node[key], out);
        }
    }
    return out;
}

function resolveLiveThemeId({ store, token }) {
    const cmd = spawnSync(
        "shopify",
        ["theme", "list", "--store", store, "--password", token, "--role", "main", "--json", "--no-color"],
        {
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
        }
    );

    if (cmd.status !== 0) {
        const err = String(cmd.stderr || cmd.stdout || "").trim();
        throw new Error(`Failed to resolve live theme id via shopify theme list --role main. ${err}`);
    }

    const raw = String(cmd.stdout || "").trim();
    if (!raw) {
        throw new Error("Shopify CLI returned empty output while resolving live theme id.");
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`Shopify CLI returned non-JSON output while resolving live theme id: ${raw}`);
    }

    const items = collectThemeLikeObjects(parsed, []);
    const ids = [];
    for (const item of items) {
        const role = String(item?.role ?? "").trim().toLowerCase();
        if (role && role !== "main") continue;
        const id = toThemeId(item?.id);
        if (id) ids.push(id);
    }

    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length !== 1) {
        throw new Error(
            `Expected exactly one main theme id but found ${uniqueIds.length}. Resolved ids: ${uniqueIds.join(", ") || "(none)"}`
        );
    }

    return uniqueIds[0];
}

function main() {
    const store = arg("--store").trim();
    const themeIdInput = arg("--theme-id").trim();
    const token = arg("--token").trim();

    if (!themeIdInput) {
        throw new Error("Missing --theme-id value.");
    }

    if (!isLiveAlias(themeIdInput)) {
        process.stdout.write(themeIdInput);
        return;
    }

    if (!store) throw new Error("Missing --store value for live theme id resolution.");
    if (!token) throw new Error("Missing --token value for live theme id resolution.");

    const resolved = resolveLiveThemeId({ store, token });
    process.stdout.write(resolved);
}

main();
