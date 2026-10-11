#!/usr/bin/env node
/**
 * Validate a Claude plugin marketplace repository (the layout claude.ai
 * organization sync reads) beyond what `claude plugin validate` checks.
 *
 * File rules come from @iamota/claude-plugin-schema (published from
 * iamota-ai-plugins), the same package kb-web's editors and checks use, so CI
 * and the editor never disagree: SKILL.md / agent frontmatter, plugin.json,
 * marketplace.json, hooks.json and .mcp.json, each issue with a line.
 *
 * This script adds the checks that span files, which the package doesn't do:
 *
 *   - marketplace.json: `./` sources that exist, and each entry's name matching
 *     its plugin's own plugin.json
 *   - no top-level bin/ in any plugin (claude.ai rejects those plugins)
 *   - every skills/<name>/ folder has a SKILL.md
 *   - optional: a plugin whose files changed must bump its plugin.json version
 *     (Claude Code installs stay pinned to a version until it changes);
 *     compiled Python (__pycache__/, *.pyc) doesn't count as a change
 *
 * Usage: node validate.mjs [repoRoot] [--base <git-ref>]
 *
 * The package is loaded from CLAUDE_PLUGIN_SCHEMA_DIR (the action installs it
 * there) or, failing that, from the repo root's node_modules (in
 * iamota-ai-plugins: `npm ci && npm run build -w @iamota/claude-plugin-schema`).
 * Exit 1 on any error; warnings never fail.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const baseRef = baseIdx >= 0 ? args[baseIdx + 1] : "";
const root = path.resolve(args.find((a, i) => !a.startsWith("--") && (baseIdx < 0 || i !== baseIdx + 1)) ?? ".");

async function loadSchema() {
  const bases = [process.env.CLAUDE_PLUGIN_SCHEMA_DIR, root].filter(Boolean);
  for (const base of bases) {
    try {
      const resolved = createRequire(path.join(path.resolve(base), "package.json")).resolve("@iamota/claude-plugin-schema");
      return await import(pathToFileURL(resolved).href);
    } catch {
      // try the next location
    }
  }
  console.log(
    `::error::@iamota/claude-plugin-schema not found (looked in ${bases.join(", ")}). ` +
      "In CI the action installs it (needs `packages: read`); locally set CLAUDE_PLUGIN_SCHEMA_DIR or build it in iamota-ai-plugins.",
  );
  process.exit(1);
}

const { validatePluginFile, isCompiledPython } = await loadSchema();

const errors = [];
const warnings = [];
const report = (file, line, msg, severity = "error") => (severity === "error" ? errors : warnings).push({ file, line, msg });
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

function git(...a) {
  return execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

function listDir(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
}

/** Every file in the repo: tracked plus untracked-but-not-ignored. */
function repoFiles() {
  try {
    return git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  } catch {
    console.log(`::error::${root} is not a git checkout; the validator reads the file list from git`);
    process.exit(1);
  }
}

// 1. Every file, through the shared schema.
for (const file of repoFiles()) {
  const abs = path.join(root, file);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue; // deleted in the worktree
  // Compiled Python is binary: the schema only needs the path to flag it.
  const content = isCompiledPython(file) ? "" : readFileSync(abs, "utf8");
  for (const issue of validatePluginFile(file, content)) report(file, issue.line, issue.message, issue.severity);
}

// 2. Checks that span files.
const marketplaceFile = path.join(root, ".claude-plugin", "marketplace.json");
const plugins = [];
if (!existsSync(marketplaceFile)) {
  report(".claude-plugin/marketplace.json", undefined, "not found; organization sync reads the marketplace from this path");
} else {
  let market = null;
  try {
    market = JSON.parse(readFileSync(marketplaceFile, "utf8"));
  } catch {
    // the schema pass already reported the invalid JSON
  }
  for (const p of Array.isArray(market?.plugins) ? market.plugins : []) {
    const where = `${rel(marketplaceFile)} → ${p?.name ?? "(unnamed)"}`;
    if (typeof p?.source !== "string" || !p.source.startsWith("./")) continue; // the schema covers the shape
    const dir = path.join(root, p.source);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      report(where, undefined, `source ${p.source} does not exist`);
      continue;
    }
    if (existsSync(path.join(dir, "bin"))) report(where, undefined, "top-level bin/ directory; claude.ai rejects the plugin (use scripts/)");
    const manifestFile = path.join(dir, ".claude-plugin", "plugin.json");
    if (existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
        if (manifest.name !== p.name) report(rel(manifestFile), undefined, `name "${manifest.name}" differs from marketplace entry "${p.name}"`);
      } catch {
        // reported by the schema pass
      }
    }
    for (const entry of listDir(path.join(dir, "skills"))) {
      if (entry.isDirectory() && !existsSync(path.join(dir, "skills", entry.name, "SKILL.md"))) {
        report(rel(path.join(dir, "skills", entry.name)), undefined, "skill folder has no SKILL.md");
      }
    }
    plugins.push({ name: p.name, prefix: `${rel(dir)}/` });
  }
}

// 3. A changed plugin must bump its version.
function checkVersionBump() {
  let changed;
  try {
    changed = git("diff", "--name-only", `${baseRef}...HEAD`).split("\n").filter((f) => f && !isCompiledPython(f));
  } catch {
    report("version-bump", undefined, `could not diff against "${baseRef}" (is fetch-depth 0?); skipped`, "warning");
    return;
  }
  for (const { name, prefix } of plugins) {
    if (!changed.some((f) => f.startsWith(prefix))) continue;
    const manifest = `${prefix}.claude-plugin/plugin.json`;
    let before;
    let after;
    try {
      before = JSON.parse(git("show", `${baseRef}:${manifest}`)).version ?? null;
    } catch {
      continue; // new plugin
    }
    try {
      after = JSON.parse(readFileSync(path.join(root, manifest), "utf8")).version ?? null;
    } catch {
      continue; // reported by the schema pass
    }
    if (before === after) {
      report(manifest, undefined, `files in ${name} changed but version is still ${after ?? "unset"}; bump it so Claude Code installs pick up the change`);
    }
  }
}
if (baseRef) checkVersionBump();

function annotate(kind, { file, line, msg }) {
  const onFile = !file.includes(" → ") && file !== "version-bump";
  const props = onFile ? ` file=${file}${line ? `,line=${line}` : ""}` : "";
  console.log(`::${kind}${props}::${file}${line ? `:${line}` : ""}: ${msg}`);
}
for (const w of warnings) annotate("warning", w);
for (const e of errors) annotate("error", e);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
