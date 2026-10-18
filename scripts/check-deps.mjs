#!/usr/bin/env node
/**
 * check-deps.mjs — mechanical check that third-party dependency versions are unified
 *
 * Rules (server/docs/architecture/crates.md, "Unified third-party dependency versions" section):
 *   1. every workspace member's dependencies (including the root package lissio) must inherit
 *      from the root [workspace.dependencies] via `X = { workspace = true }`; inlining
 *      `version` or `path` in a member manifest is forbidden;
 *   2. inherited entries must not repeat version (cargo forbids it anyway; this is a second safeguard);
 *   3. one-off dependencies must also be registered in the root [workspace.dependencies] first,
 *      keeping the version a single source of truth.
 *
 * Scope: the workspace root manifest (root package) + every member
 * `<crate root>/<domain>/<crate>/Cargo.toml`, where the crate roots are `crates/` plus the
 * nested `core/`, `physical/`, and `data/` submodule roots of the umbrella's `server/`
 * workspace.
 *
 * Repository-root convention (`scripts/repo-root.mjs`): the Rust workspace of the repository
 * the script runs in — `server/` inside the umbrella, the repository itself inside a copy —
 * and `--root=<path>` selects another checkout.
 *
 * Usage: pnpm check:deps [--root=<path>]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { repositoryRoot, rustSourceRoots, rustWorkspaceRoot } from "./repo-root.mjs";

const repoRoot = repositoryRoot();
/** The Rust workspace: `<repo>/server` inside the umbrella, `<repo>` in a copy. */
const workspaceRoot = rustWorkspaceRoot(repoRoot);
/** Every directory that holds `<domain>/<crate>` member crates. */
const CRATE_ROOTS = rustSourceRoots(workspaceRoot);
const errors = [];

// ---- Minimal TOML line handling: join multi-line entries split by inline tables, skip comments/blank lines ----
function logicalLines(text) {
  const out = [];
  let buf = null;
  let depth;
  for (const raw of text.split(/\r?\n/)) {
    if (buf === null) {
      if (/^\s*(#|$)/.test(raw)) continue;
      buf = raw;
    } else {
      buf += " " + raw.trim();
    }
    // Count the brace delta outside quotes; >0 means an inline table is still open
    let inStr = false;
    let d = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === "{") d++;
      if (c === "}") d--;
    }
    depth = d;
    if (depth <= 0) {
      out.push(buf);
      buf = null;
    }
  }
  if (buf !== null) out.push(buf);
  return out;
}

const DEP_KINDS = new Set(["dependencies", "dev-dependencies", "build-dependencies"]);

/** Returns { mode: 'registry' } | { mode: 'deps' } | { mode: 'subtable', dep } | null (ignored) */
function classifySection(name) {
  if (name === "workspace.dependencies") return { mode: "registry" };
  if (DEP_KINDS.has(name)) return { mode: "deps" };
  let m = name.match(/^target\.(?:'([^']*)'|"([^"]*)")\.(dependencies|dev-dependencies|build-dependencies)$/);
  if (m) return { mode: "deps" };
  m = name.match(/^(dependencies|dev-dependencies|build-dependencies)\.([A-Za-z0-9_-]+)$/);
  if (m) return { mode: "subtable", dep: m[2] };
  return null;
}

/**
 * Parse a single manifest.
 * Returns { registry: Map<name, {internal}>, depEntries: [{ dep, kind, inherited, inlineVersion, hasPath }] }
 */
function parseManifest(text) {
  const registry = new Map();
  const depEntries = [];
  let current = null;
  let subtableDep = null;

  for (const line of logicalLines(text)) {
    // Array sections like [[bench]] / [[bin]]: not dependency sections, so reset the context
    // to keep their keys out of the previous section
    if (/^\s*\[\[/.test(line)) {
      current = null;
      subtableDep = null;
      continue;
    }
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      const cls = classifySection(header[1].trim());
      if (cls?.mode === "registry") {
        current = "registry";
      } else if (cls?.mode === "deps") {
        current = "deps";
        subtableDep = null;
      } else if (cls?.mode === "subtable") {
        current = "deps";
        subtableDep = cls.dep;
      } else {
        current = null;
        subtableDep = null;
      }
      continue;
    }
    if (current === null) continue;

    if (current === "registry") {
      const m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
      if (m) registry.set(m[1], { internal: /\bpath\s*=\s*"/.test(m[2]) });
      continue;
    }

    // Dependency subtable form: lines under [dependencies.foo] are attributes of that dependency
    if (subtableDep !== null) {
      let entry = depEntries.find((e) => e.dep === subtableDep);
      if (!entry) {
        entry = { dep: subtableDep, kind: "dependencies", inherited: false, inlineVersion: false, hasPath: false };
        depEntries.push(entry);
      }
      if (/^workspace\s*=\s*true\s*$/.test(line)) entry.inherited = true;
      if (/^version\s*=\s*"/.test(line)) entry.inlineVersion = true;
      if (/^path\s*=\s*"/.test(line)) entry.hasPath = true;
      continue;
    }

    // Dotted shorthand: foo.workspace = true
    const dotted = line.match(/^([A-Za-z0-9_-]+)\.workspace\s*=\s*true\s*$/);
    if (dotted) {
      depEntries.push({ dep: dotted[1], kind: "dependencies", inherited: true, inlineVersion: false, hasPath: false });
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (kv) {
      const value = kv[2].trim();
      // A bare string `dep = "1.2"` is TOML shorthand for `{ version = "1.2" }`
      const bareVersion = /^".*"$/
        .test(value) || /^'.*'$/.test(value);
      depEntries.push({
        dep: kv[1],
        kind: "dependencies",
        inherited: /\bworkspace\s*=\s*true\b/.test(value),
        inlineVersion: bareVersion || /\bversion\s*=\s*"/.test(value),
        hasPath: /\bpath\s*=\s*"/.test(value),
      });
    }
  }
  return { registry, depEntries };
}

function checkManifest(label, text) {
  const { depEntries } = parseManifest(text);
  for (const e of depEntries) {
    if (e.inherited && e.inlineVersion) {
      errors.push(`${label}: "${e.dep}" already inherits from the workspace, so it must not inline version`);
      continue;
    }
    if (e.inherited) continue;
    const what = e.inlineVersion ? "inlined version" : e.hasPath ? "inlined path" : "no declared source";
    errors.push(
      `${label}: "${e.dep}" has ${what} — register it in the root [workspace.dependencies] and reference it as "${e.dep} = { workspace = true }"`,
    );
  }
}

// ---- Root manifest (workspace + root package combined) ----
const rootLabel = "lissio (root)";
checkManifest(rootLabel, readFileSync(join(workspaceRoot, "Cargo.toml"), "utf8"));

// ---- All member crates ----
let memberCount = 0;
for (const scanRoot of CRATE_ROOTS) {
  const cratesDir = join(workspaceRoot, scanRoot);
  for (const layer of readdirSync(cratesDir, { withFileTypes: true })) {
    if (!layer.isDirectory()) continue;
    for (const crate of readdirSync(join(cratesDir, layer.name), { withFileTypes: true })) {
      if (!crate.isDirectory()) continue;
      const manifest = join(cratesDir, layer.name, crate.name, "Cargo.toml");
      if (!existsSync(manifest)) continue;
      checkManifest(`${scanRoot}/${layer.name}/${crate.name}`, readFileSync(manifest, "utf8"));
      memberCount++;
    }
  }
}

// ---- Zero-floor guard ----
// Iterating a fixed depth and skipping directories without a manifest means a
// layout change or a renamed crates directory can collapse the scan set to
// zero; the summary would still print "0 members" and exit 0, which looks like
// a pass. `scripts/check-crate-size.mjs` refuses the same vacuous success.
if (memberCount === 0) {
  errors.push(
    `scanned 0 member crates under ${CRATE_ROOTS.join(", ")}/<domain>/<crate> — wrong path or a ` +
      "layout change, so the dependency rule could not be evaluated",
  );
}

if (errors.length > 0) {
  console.error(`✗ Dependency version unification check failed (${errors.length} issues):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\nSee the \"Unified third-party dependency versions\" section of server/docs/architecture/crates.md");
  process.exit(1);
}

console.log(`✓ Dependency version unification passed — ${memberCount} members + root package, all dependencies inherit from [workspace.dependencies]`);
