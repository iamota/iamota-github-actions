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

function main() {
    const storeRaw = process.argv[2] || "";
    const raw = process.argv[3] || "";
    const store = normalizeStore(storeRaw);
    const slug = store.replace(/\.myshopify\.com$/i, "");
    const trimmed = String(raw).trim();

    if (!trimmed) {
        process.stdout.write("");
        return;
    }

    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        process.stdout.write(raw);
        return;
    }

    let obj;
    try {
        obj = JSON.parse(trimmed);
    } catch {
        process.stdout.write(raw);
        return;
    }

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        process.stdout.write(raw);
        return;
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
            process.stdout.write(asString(obj[k]));
            return;
        }
    }

    process.stdout.write("");
}

main();
