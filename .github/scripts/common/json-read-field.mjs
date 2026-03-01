import process from "node:process";

function arg(name, def = "") {
    const i = process.argv.indexOf(name);
    if (i === -1) return def;
    return process.argv[i + 1] || def;
}

function parseBool(v) {
    const s = String(v || "").trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(s)) return true;
    if (["0", "false", "no", "n", "off", ""].includes(s)) return false;
    throw new Error(`Invalid boolean: ${v}`);
}

function getByPath(obj, dottedPath) {
    if (!dottedPath) return obj;
    const parts = dottedPath.split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (cur === null || cur === undefined || typeof cur !== "object" || !(p in cur)) {
            return { found: false, value: undefined };
        }
        cur = cur[p];
    }
    return { found: true, value: cur };
}

async function readStdin() {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data;
}

async function main() {
    const path = arg("--path", "");
    const required = parseBool(arg("--required", "false"));

    const raw = await readStdin();
    const json = raw.trim() ? JSON.parse(raw) : {};
    const { found, value } = getByPath(json, path);

    if (!found || value === undefined || value === null) {
        if (required) {
            throw new Error(`Missing required JSON path: ${path}`);
        }
        return;
    }

    if (typeof value === "object") {
        process.stdout.write(JSON.stringify(value));
        return;
    }

    process.stdout.write(String(value));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
