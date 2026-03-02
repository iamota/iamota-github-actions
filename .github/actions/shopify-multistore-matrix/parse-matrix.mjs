function normalizeStore(v) {
    let s = String(v ?? "").trim();
    if (!s) return "";
    s = s.replace(/^https?:\/\//i, "");
    s = s.split("/")[0].trim().toLowerCase();
    if (!s) return "";
    if (!s.includes(".")) s = `${s}.myshopify.com`;
    return s;
}

function parseStores(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return [];

    if (s.startsWith("[") && s.endsWith("]")) {
        let arr;
        try {
            arr = JSON.parse(s);
        } catch {
            throw new Error(
                `Invalid SHOPIFY_STORE JSON array: ${s}. Use valid JSON like ["store1","store2"] or a single string like store1.`
            );
        }
        if (!Array.isArray(arr)) throw new Error("stores JSON must be an array");
        return arr.map((x) => normalizeStore(String(x ?? ""))).filter(Boolean);
    }

    if (s.includes(",")) {
        throw new Error('Multiple stores must use a valid JSON array, e.g. ["store1","store2"].');
    }

    const single = normalizeStore(s.replace(/^["']|["']$/g, ""));
    return single ? [single] : [];
}

function main() {
    const raw = process.argv[2] || "";
    const allowEmpty = String(process.argv[3] || "").toLowerCase() === "true";
    const seen = new Set();
    const stores = [];

    for (const st of parseStores(raw)) {
        if (!seen.has(st)) {
            seen.add(st);
            stores.push(st);
        }
    }

    if (stores.length === 0) {
        if (!allowEmpty) {
            throw new Error("No stores resolved from input.");
        }

        process.stdout.write(
            JSON.stringify(
                {
                    stores_json: "[]",
                    matrix_json: JSON.stringify({ include: [{ store: "", store_slug: "" }] }),
                    first_store: "",
                },
                null,
                2
            )
        );
        return;
    }

    const include = stores.map((store) => {
        const slug = store.replace(/\.myshopify\.com$/i, "");
        return { store, store_slug: slug };
    });

    process.stdout.write(
        JSON.stringify(
            {
                stores_json: JSON.stringify(stores),
                matrix_json: JSON.stringify({ include }),
                first_store: stores[0] || "",
            },
            null,
            2
        )
    );
}

main();
