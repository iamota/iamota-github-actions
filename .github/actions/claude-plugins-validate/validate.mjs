#!/usr/bin/env node
/**
 * Validate a Claude plugin marketplace repository (the layout claude.ai
 * organization sync reads) beyond what `claude plugin validate` checks:
 *
 *   - marketplace.json: plugin names, `./` relative sources that exist, and the
 *     entry name matching each plugin's own plugin.json
 *   - no top-level bin/ in any plugin (claude.ai rejects those plugins)
 *   - SKILL.md frontmatter: only the keys claude.ai accepts, a kebab-case
 *     `name` that matches its folder, and a description within the limit
 *   - agents: name + description present, no empty `tools` list (zero-tool
 *     subagents fail to launch), `model` as an alias or `inherit`
 *   - optional: a plugin whose files changed must bump its plugin.json version
 *     (Claude Code installs stay pinned to a version until it changes)
 *
 * Usage: node validate.mjs [repoRoot] [--base <git-ref>]
 * Zero dependencies. Exit 1 on any error; warnings never fail.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const baseRef = baseIdx >= 0 ? args[baseIdx + 1] : "";
const root = path.resolve(args.find((a, i) => !a.startsWith("--") && i !== baseIdx + 1) ?? ".");

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_PREFIX = /^(claude|anthropic|anthropics|cc-plugin)-/;
// claude.ai rejects any other top-level SKILL.md key when syncing or uploading.
const SKILL_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const SKILL_DESCRIPTION_MAX = 1024;
const AGENT_MODELS = new Set(["inherit", "sonnet", "opus", "haiku", "fable"]);

/**
 * Minimal frontmatter reader: top-level keys with plain, quoted, flow-list or
 * block-scalar values. Enough to check keys and string lengths; the YAML itself
 * is checked by `claude plugin validate`.
 */
function readFrontmatter(file) {
  const raw = readFileSync(file, "utf8");
  if (!/^---\r?\n/.test(raw)) return null;
  const end = raw.slice(4).search(/\r?\n---\s*(\r?\n|$)/);
  if (end < 0) return null;
  const data = {};
  let key = null;
  let block = false;
  for (const line of raw.slice(4, 4 + end).split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (kv) {
      key = kv[1];
      const v = (kv[2] ?? "").trim();
      block = v === "" || /^[>|][-+]?$/.test(v);
      data[key] = block ? "" : v.replace(/^(["'])(.*)\1$/, "$2");
    } else if (key && block && /^\s+\S/.test(line)) {
      data[key] += (data[key] ? " " : "") + line.trim();
    }
  }
  return data;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    err(rel(file), `invalid JSON (${e.message})`);
    return null;
  }
}

function listDir(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
}

function checkSkills(pluginDir) {
  for (const entry of listDir(path.join(pluginDir, "skills"))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(pluginDir, "skills", entry.name, "SKILL.md");
    if (!existsSync(file)) {
      err(rel(path.dirname(file)), "skill folder has no SKILL.md");
      continue;
    }
    const fm = readFrontmatter(file);
    if (!fm) {
      err(rel(file), "missing frontmatter (the first line must be ---)");
      continue;
    }
    for (const k of Object.keys(fm)) {
      if (!SKILL_KEYS.has(k)) err(rel(file), `frontmatter key "${k}" is not accepted by claude.ai; move it under metadata`);
    }
    if (!fm.name) err(rel(file), "name is required");
    else {
      if (fm.name !== entry.name) err(rel(file), `name "${fm.name}" must match its folder "${entry.name}"`);
      if (!KEBAB.test(fm.name) || fm.name.length > 64) err(rel(file), `name "${fm.name}" must be kebab-case, 64 characters or fewer`);
    }
    if (!fm.description) err(rel(file), "description is required");
    else if (fm.description.length > SKILL_DESCRIPTION_MAX) {
      err(rel(file), `description is ${fm.description.length} characters (max ${SKILL_DESCRIPTION_MAX})`);
    }
  }
}

function checkAgents(pluginDir) {
  const dir = path.join(pluginDir, "agents");
  for (const entry of listDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = path.join(dir, entry.name);
    const fm = readFrontmatter(file);
    if (!fm) {
      err(rel(file), "missing frontmatter (the first line must be ---)");
      continue;
    }
    if (!fm.name) err(rel(file), "name is required");
    else if (fm.name.includes(":")) err(rel(file), `name "${fm.name}" must not contain ":"`);
    if (!fm.description) err(rel(file), "description is required");
    if ("tools" in fm && /^\[\s*\]$|^$/.test(fm.tools)) {
      err(rel(file), "tools is empty, so the subagent would launch with zero tools; omit it to inherit");
    }
    if (fm.model && !AGENT_MODELS.has(fm.model)) {
      warn(rel(file), `model "${fm.model}" is a pinned ID; prefer an alias (sonnet/opus/haiku) or inherit`);
    }
  }
}

function git(...a) {
  return execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function checkVersionBump(plugins) {
  let changed;
  try {
    changed = git("diff", "--name-only", `${baseRef}...HEAD`).split("\n").filter(Boolean);
  } catch {
    warn("version-bump", `could not diff against "${baseRef}" (is fetch-depth 0?); skipped`);
    return;
  }
  for (const { name, dir } of plugins) {
    const prefix = rel(dir) + "/";
    if (!changed.some((f) => f.startsWith(prefix))) continue;
    const manifest = `${prefix}.claude-plugin/plugin.json`;
    let before = null;
    try {
      before = JSON.parse(git("show", `${baseRef}:${manifest}`)).version ?? null;
    } catch {
      continue; // new plugin
    }
    const after = JSON.parse(readFileSync(path.join(root, manifest), "utf8")).version ?? null;
    if (before === after) {
      err(manifest, `files in ${name} changed but version is still ${after ?? "unset"}; bump it so Claude Code installs pick up the change`);
    }
  }
}

const marketplaceFile = path.join(root, ".claude-plugin", "marketplace.json");
if (!existsSync(marketplaceFile)) {
  err(".claude-plugin/marketplace.json", "not found; organization sync reads the marketplace from this path");
} else {
  const market = readJson(marketplaceFile);
  const plugins = [];
  if (market) {
    if (!market.name) err(rel(marketplaceFile), "name is required");
    if (!market.owner?.name) err(rel(marketplaceFile), "owner.name is required");
    if (!Array.isArray(market.plugins) || market.plugins.length === 0) err(rel(marketplaceFile), "plugins must be a non-empty array");
    const seen = new Set();
    for (const p of market.plugins ?? []) {
      const where = `${rel(marketplaceFile)} → ${p.name ?? "(unnamed)"}`;
      if (!p.name || !KEBAB.test(p.name)) err(where, "plugin name must be kebab-case");
      else if (RESERVED_PREFIX.test(p.name)) err(where, "plugin name uses a reserved prefix");
      if (seen.has(p.name)) err(where, "duplicate plugin name");
      seen.add(p.name);
      if (typeof p.source !== "string") {
        warn(where, "non-path source; organization sync only packages github, url, git-subdir or ./ sources");
        continue;
      }
      if (!p.source.startsWith("./")) {
        err(where, `source "${p.source}" must be a relative path starting with ./`);
        continue;
      }
      const dir = path.join(root, p.source);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        err(where, `source ${p.source} does not exist`);
        continue;
      }
      if (existsSync(path.join(dir, "bin"))) err(where, "top-level bin/ directory; claude.ai rejects the plugin (use scripts/)");
      const manifestFile = path.join(dir, ".claude-plugin", "plugin.json");
      if (existsSync(manifestFile)) {
        const manifest = readJson(manifestFile);
        if (manifest && manifest.name !== p.name) err(rel(manifestFile), `name "${manifest.name}" differs from marketplace entry "${p.name}"`);
      }
      plugins.push({ name: p.name, dir });
      checkSkills(dir);
      checkAgents(dir);
    }
  }
  if (baseRef) checkVersionBump(plugins);
}

for (const w of warnings) console.log(`::warning::${w}`);
for (const e of errors) console.log(`::error::${e}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
