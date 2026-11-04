// Shared helpers for per-store variable overrides.
//
// A store-scoped value resolves, for each store, in this order:
//   1. named variable    NAME__STORE_KEY   (e.g. SHOPIFY_THEME_ID__PRODUCTION_HERSCHEL_US)
//   2. indexed variable  NAME_N            (N = the store's 1-based position in the store list)
//   3. the raw value the wrapper passed in: a store-keyed JSON object or a scalar
// When several NAMEs are given, each name's named and indexed forms are tried in
// order before falling back to the raw value. This mirrors multistore-resolve-secret.

import fs from "node:fs";

export function normalizeStore(v) {
    let s = String(v ?? "").trim();
    if (!s) return "";
    s = s.replace(/^https?:\/\//i, "");
    s = s.split("/")[0].trim().toLowerCase();
    if (!s) return "";
    if (!s.includes(".")) s = `${s}.myshopify.com`;
    return s;
}

// Must stay identical to toSecretKey in shopify-multistore-matrix/parse-matrix.mjs.
export function toStoreKey(v) {
    const slug = normalizeStore(v).replace(/\.myshopify\.com$/i, "");
    if (!slug) return "";
    return slug.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

export function asString(v) {
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
}

export function parseVarsJson(raw, label) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return {};
    let obj;
    try {
        obj = JSON.parse(trimmed);
    } catch {
        throw new Error(`${label} must be a JSON object (pass toJSON(vars)).`);
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        throw new Error(`${label} must be a JSON object (pass toJSON(vars)).`);
    }
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null) continue;
        out[k] = asString(v);
    }
    return out;
}

// Later sources win, so pass the most specific (environment-level) last.
export function mergeVars(...sources) {
    return Object.assign({}, ...sources.map((s, i) => parseVarsJson(s, `vars source ${i + 1}`)));
}

export function loadVarsFile(file = process.env.IAMOTA_STORE_VARS_FILE) {
    if (!file) return {};
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

export function splitNames(names) {
    return String(names ?? "")
        .split(/[\s,]+/)
        .map((n) => n.trim())
        .filter(Boolean);
}

// Returns { value, source, variable } for the first non-empty named/indexed variable.
export function lookupStoreVar(vars, names, store, index) {
    const key = toStoreKey(store);
    const idx = String(index ?? "").trim();
    for (const name of splitNames(names)) {
        if (key) {
            const variable = `${name}__${key}`;
            const v = vars[variable];
            if (v !== undefined && v !== null && String(v) !== "") return { value: String(v), source: "named", variable };
        }
        if (idx) {
            const variable = `${name}_${idx}`;
            const v = vars[variable];
            if (v !== undefined && v !== null && String(v) !== "") return { value: String(v), source: "indexed", variable };
        }
    }
    return { value: "", source: "empty", variable: "" };
}

// Raw wrapper value: store-keyed JSON object, or a scalar applied to every store.
export function resolveRawValue(raw, storeRaw) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return "";
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return String(raw);

    let obj;
    try {
        obj = JSON.parse(trimmed);
    } catch {
        throw new Error(`Store-scoped values must be valid JSON objects. Invalid value: ${trimmed}`);
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return String(raw);

    const store = normalizeStore(storeRaw);
    const slug = store.replace(/\.myshopify\.com$/i, "");
    const keyVariants = [storeRaw, store, slug, String(storeRaw || "").toLowerCase(), String(slug || "").toLowerCase()];
    for (const k of keyVariants) {
        if (!k) continue;
        if (Object.prototype.hasOwnProperty.call(obj, k)) return asString(obj[k]);
    }
    return "";
}

export function resolveStoreValue({ vars = {}, names = "", store = "", index = "", raw = "" }) {
    const hit = lookupStoreVar(vars, names, store, index);
    if (hit.source !== "empty") return hit;
    const value = resolveRawValue(raw, store);
    if (value === "") return { value: "", source: "empty", variable: "" };
    const t = String(raw).trim();
    return { value, source: t.startsWith("{") && t.endsWith("}") ? "store_scoped" : "scalar", variable: "" };
}
