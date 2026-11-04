import fs from "node:fs";
import { loadVarsFile, resolveStoreValue } from "../multistore-vars-load/store-vars-lib.mjs";

// argv: store, raw, [names], [store_index]
// names/store_index are optional; without them (or without a vars file staged by
// multistore-vars-load) this behaves exactly like the original raw-only resolver.
function main() {
    const store = process.argv[2] || "";
    const raw = process.argv[3] || "";
    const names = process.argv[4] || "";
    const index = process.argv[5] || "";

    const vars = names ? loadVarsFile() : {};
    const { value, source, variable } = resolveStoreValue({ vars, names, store, index, raw });

    if (variable) {
        console.log(`Resolved from variable ${variable} (${source}).`);
    }

    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `value<<EOF\n${value}\nEOF\nsource=${source}\n`);
        return;
    }
    process.stdout.write(JSON.stringify({ value, source }, null, 2));
}

main();
