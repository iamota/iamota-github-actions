import fs from "node:fs";

function normalizeStore(v) {
    let s = String(v ?? "").trim();
    if (!s) return "";
    s = s.replace(/^https?:\/\//i, "");
    s = s.split("/")[0].trim().toLowerCase();
    if (!s) return "";
    if (!s.includes(".")) s = `${s}.myshopify.com`;
    return s;
}

function asString(v) {
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
}

function resolveValue(raw, storeRaw) {
    const store = normalizeStore(storeRaw);
    const slug = store.replace(/\.myshopify\.com$/i, "");
    const trimmed = String(raw).trim();

    if (!trimmed) {
        return "";
    }

    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        return String(raw ?? "");
    }

    let obj;
    try {
        obj = JSON.parse(trimmed);
    } catch {
        throw new Error(`Store-scoped values must be valid JSON objects. Invalid value: ${trimmed}`);
    }

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        return String(raw ?? "");
    }

    const keyVariants = [
        storeRaw,
        store,
        slug,
        String(storeRaw || "").toLowerCase(),
        String(slug || "").toLowerCase(),
    ];

    for (const k of keyVariants) {
        if (!k) continue;
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
            return asString(obj[k]);
        }
    }

    return "";
}

function appendOutput(name, value) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<EOF\n${value}\nEOF\n`);
}

function main() {
    const storeRaw = process.argv[2] || "";
    const raw = process.argv[3] || "";
    const rawNamed = process.argv[4] || "";
    const rawIndexed = process.argv[5] || "";

    let value = "";
    let source = "empty";

    if (String(rawNamed ?? "") !== "") {
        value = String(rawNamed);
        source = "named";
    } else if (String(rawIndexed ?? "") !== "") {
        value = String(rawIndexed);
        source = "indexed";
    } else {
        value = resolveValue(raw, storeRaw);
        const trimmed = String(raw).trim();
        if (value !== "") {
            source = trimmed.startsWith("{") && trimmed.endsWith("}") ? "store_scoped" : "scalar";
        }
    }

    if (process.env.GITHUB_OUTPUT) {
        appendOutput("value", value);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `source=${source}\n`);
        return;
    }

    process.stdout.write(JSON.stringify({ value, source }, null, 2));
}

main();
