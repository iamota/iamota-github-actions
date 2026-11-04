import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mergeVars } from "./store-vars-lib.mjs";

const merged = mergeVars(process.env.INPUT_VARS_JSON, process.env.INPUT_ENV_VARS_JSON);
const dir = process.env.RUNNER_TEMP || os.tmpdir();
const file = path.join(dir, "iamota-store-vars.json");
fs.writeFileSync(file, JSON.stringify(merged));

if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `IAMOTA_STORE_VARS_FILE=${file}\n`);
}
if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `file=${file}\n`);
}
console.log(`Staged ${Object.keys(merged).length} variable(s) for per-store resolution.`);
