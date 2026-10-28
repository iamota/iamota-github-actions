import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const bash = process.platform === "win32" && existsSync("C:/Program Files/Git/bin/bash.exe")
    ? "C:/Program Files/Git/bin/bash.exe"
    : "bash";

// Execute the action's actual inline parser, so changing the action changes the test.
function parseOutput(action, payload) {
    const source = read(`.github/actions/${action}/action.yml`);
    const parser = source.match(/\| node -e "([^"\r\n]+)"/)[1];
    const result = spawnSync(process.execPath, ["-e", parser], {
        input: typeof payload === "string" ? payload : JSON.stringify(payload),
        encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

test("push accepts CLI 4 and CLI 5 preview URLs, preferring camelCase", () => {
    for (const theme of [
        { preview_url: "https://example.com/old" },
        { previewUrl: "https://example.com/new" },
        { previewUrl: "https://example.com/new", preview_url: "https://example.com/old" },
    ]) {
        assert.equal(parseOutput("shopify-theme-push", {
            status: "success", changed: true, issues: [], theme,
        }), theme.previewUrl || theme.preview_url);
    }
    for (const payload of [{}, { theme: null }, { theme: { previewUrl: null } }, "invalid JSON"]) {
        assert.equal(parseOutput("shopify-theme-push", payload), "");
    }
});

test("duplicate keeps parsing theme.id with numeric CLI 4 and string CLI 5 IDs", () => {
    assert.equal(parseOutput("shopify-theme-create", { theme: { id: 123 } }), "123");
    assert.equal(parseOutput("shopify-theme-create", {
        status: "success", changed: true, originalTheme: { id: "123" }, theme: { id: "456" },
    }), "456");
    assert.equal(parseOutput("shopify-theme-create", { status: "cancelled", changed: false }), "");
});

test("live resolver handles CLI 4 arrays and CLI 5 envelopes and rejects invalid results", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shopify-cli-test-"));
    try {
        const mock = path.join(dir, "mock.cjs");
        // Mock only the CLI process boundary; run the unmodified resolver end to end.
        writeFileSync(mock, `
            const assert = require('node:assert/strict');
            require('node:child_process').spawnSync = (command, args) => {
                assert.equal(command, 'shopify');
                assert.deepEqual(args, ['theme', 'list', '--store', 'example.myshopify.com',
                    '--password', 'test-token', '--role', 'live', '--json', '--no-color']);
                return { status: Number(process.env.MOCK_STATUS || 0),
                    stdout: process.env.MOCK_JSON, stderr: 'mock CLI error' };
            };
            require('node:module').syncBuiltinESMExports();
        `);
        const resolve = (payload, status = 0) => spawnSync(process.execPath, [
            "--require", mock, path.join(root, ".github/scripts/shopify/shopify-theme-id-resolve.mjs"),
            "--store", "example.myshopify.com", "--theme-id", "live", "--token", "test-token",
        ], { encoding: "utf8", env: { ...process.env,
            MOCK_JSON: typeof payload === "string" ? payload : JSON.stringify(payload),
            MOCK_STATUS: String(status),
        } });
        for (const payload of [
            [{ id: 123, role: "main" }],
            [{ id: 123, role: "live" }],
            { themes: [{ id: "123", role: "live" }, { id: "456", role: "unpublished" }] },
            { themes: [{ id: "123", role: "main" }] },
        ]) {
            const result = resolve(payload);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout, "123");
        }
        for (const payload of [[], { themes: [] }, { themes: [
            { id: "123", role: "live" }, { id: "456", role: "live" },
        ] }, "invalid JSON"]) {
            assert.notEqual(resolve(payload).status, 0);
        }
        assert.notEqual(resolve({ themes: [{ id: "123", role: "live" }] }, 1).status, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("Theme Check report accepts both formats and preserves positions and failure policy", () => {
    const source = read(".github/workflows/shopify-theme-ci.yml").split("- name: Build Theme Check report")[1];
    const script = source.match(/node - <<'NODE'\n([\s\S]+?)\n\s+NODE\n/)[1];
    const dir = mkdtempSync(path.join(tmpdir(), "shopify-check-test-"));
    try {
        mkdirSync(path.join(dir, "_ci_reports"));
        const jsonPath = path.join(dir, "report.json");
        const outputPath = path.join(dir, "outputs");
        const offense = { check: "ExampleCheck", severity: "error", message: "Example problem" };
        const cases = [
            [[{ path: "snippets/example.liquid", offenses: [{ ...offense, start_row: 2, start_column: 3 }] }], "true", 0, true, 1],
            [{ valid: false, issues: [{ ...offense, filePath: "snippets/example.liquid", startRow: 2, startColumn: 3 }] }, "true", 1, true, 1],
            [{ valid: false, issues: [{ ...offense, filePath: "snippets/example.liquid", startRow: 2, startColumn: 3 }] }, "log", 1, false, 1],
            [[], "true", 0, false, 0],
            [{ valid: true, issues: [] }, "true", 0, false, 0],
            [{ valid: true, issues: [] }, "true", 1, true, 0],
        ];
        for (const [report, mode, exitCode, shouldFail, count] of cases) {
            writeFileSync(jsonPath, JSON.stringify(report));
            writeFileSync(outputPath, "");
            const result = spawnSync(process.execPath, ["-e", script], {
                cwd: dir, encoding: "utf8", env: { ...process.env,
                    JSON_PATH: jsonPath, STDERR_PATH: path.join(dir, "stderr"),
                    GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: "",
                    THEME_ROOT: dir, THEME_SRC: "src", THEME_CHECK_MODE: mode,
                    THEME_CHECK_FAIL_LEVEL: "error", THEME_CHECK_EXIT_CODE: String(exitCode),
                },
            });
            assert.equal(result.status, 0, result.stderr);
            const outputs = readFileSync(outputPath, "utf8");
            assert.ok(outputs.includes(`should_fail<<EOF\n${shouldFail}\nEOF`), outputs);
            assert.ok(outputs.includes(`all_count<<EOF\n${count}\nEOF`), outputs);
            if (count) {
                assert.match(readFileSync(path.join(dir, "_ci_reports/theme-check-comment.md"), "utf8"),
                    /snippets\/example\.liquid:2:3/);
            }
        }
        for (const invalid of [{ error: { message: "Failed" } }, { issues: [] }, null]) {
            writeFileSync(jsonPath, JSON.stringify(invalid));
            const result = spawnSync(process.execPath, ["-e", script], {
                cwd: dir, encoding: "utf8", env: { ...process.env, JSON_PATH: jsonPath },
            });
            assert.notEqual(result.status, 0);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("installer chooses explicit input, environment fallback, then latest", () => {
    const action = read(".github/actions/shopify-cli-install/action.yml");
    assert.match(action, /cli_version:\s*\n\s+description:.*\n\s+default: ""/);
    assert.match(action, /CLI_VERSION_INPUT: \$\{\{ inputs.cli_version \}\}/);
    const script = action.match(/- run: \|\r?\n([\s\S]+?)\s+shell: bash/)[1]
        .split(/\r?\n/).map((line) => line.trimStart()).join("\n");
    for (const [input, variable, expected] of [
        ["", "", "latest"], ["", "4.9.0", "4.9.0"],
        ["5.0.0", "4.9.0", "5.0.0"], ["latest", "4.9.0", "latest"],
    ]) {
        const result = spawnSync(bash, ["-c", `
            npm() { printf 'INSTALL:%s\\n' "$*"; }
            shopify() { printf 'SHOPIFY:%s\\n' "$*"; }
            ${script}
        `], { encoding: "utf8", env: { ...process.env,
            CLI_VERSION_INPUT: input, SHOPIFY_CLI_VERSION: variable,
        } });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        assert.ok(result.stdout.includes(`INSTALL:install -g @shopify/cli@${expected}\n`), result.stdout);
        assert.ok(result.stdout.includes("SHOPIFY:version\n"), result.stdout);
    }
});

test("every workflow install passes SHOPIFY_CLI_VERSION", () => {
    let count = 0;
    for (const file of readdirSync(path.join(root, ".github/workflows"))) {
        if (!file.endsWith(".yml")) continue;
        const source = read(`.github/workflows/${file}`);
        for (const match of source.matchAll(/uses: [^\r\n]*\/shopify-cli-install@[^\r\n]+\r?\n([^\r\n]+)\r?\n([^\r\n]+)(?:\r?\n([^\r\n]+))?/g)) {
            assert.match(match[1], /^\s+with:$/, file);
            assert.match(match.slice(2).join("\n"), /cli_version: \$\{\{ (?:inputs.cli_version \|\| )?vars.SHOPIFY_CLI_VERSION \}\}/, file);
            count++;
        }
        if (file === "shopify-app-deploy.yml") {
            assert.match(source, /cli_version:[\s\S]*?default: ""/);
        }
    }
    assert.equal(count, 7);
});
