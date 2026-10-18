#!/usr/bin/env node
/**
 * set-version.mjs — update the Rust / frontend version numbers in one step
 *
 * Updated locations:
 *   1. package.json                     → "version" (full semver)
 *   2. client/package.json              → "version" (full semver, same as 1)
 *   3. client/src-tauri/tauri.conf.json → "version" (MSI does not accept prerelease, so write the stripped base version)
 *   4. one root manifest per Cargo workspace — server/Cargo.toml (virtual: [workspace.package]),
 *      server/core/Cargo.toml, server/data/Cargo.toml, client/src-tauri/Cargo.toml — the version in
 *      [package] and [workspace.package] (as in 3, write the base version)
 *      (all crates inherit via version.workspace = true and follow automatically;
 *       [workspace.dependencies] internal entries are rewritten in sync, since crates.io publishing requires an explicit version)
 *   5. each workspace's Cargo.lock     → refresh the recorded workspace member versions via cargo metadata
 *
 * Usage:
 *   pnpm set-version 0.2.0            apply the change
 *   pnpm set-version 0.2.0 --dry-run  only print the changes, write no files
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((a) => !a.startsWith("-"));

if (!version || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: pnpm set-version <semver> [--dry-run]");
  console.log("Example: pnpm set-version 0.2.0");
  process.exit(version ? 0 : 1);
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!SEMVER.test(version)) {
  console.error(`error: "${version}" is not valid semver (for example 0.2.0 or 1.0.0-beta.1)`);
  process.exit(1);
}

const changes = [];

// Packers such as MSI do not accept prerelease identifiers: tauri.conf.json / Cargo.toml get only the base version,
// while package.json keeps the full semver (e.g. 0.1.3-beta.1)
const bundleVersion = version.split("-")[0];

function updateJson(relPath, target) {
  const abs = join(repoRoot, relPath);
  if (!existsSync(abs)) {
    console.error(`error: ${relPath} is missing; the release version cannot be propagated to it`);
    process.exit(1);
  }
  const text = readFileSync(abs, "utf8");
  const match = text.match(/^(\s*)"version":\s*"([^"]+)"/m);
  if (!match) {
    console.error(`error: no "version" field found in ${relPath}`);
    process.exit(1);
  }
  const old = match[2];
  if (old === target) return;
  changes.push({ relPath, old, target });
  if (!dryRun) {
    writeFileSync(abs, text.replace(/^(\s*)"version":\s*"[^"]+"/m, `$1"version": "${target}"`));
  }
}

function updateCargoToml(relPath, target) {
  const abs = join(repoRoot, relPath);
  if (!existsSync(abs)) {
    console.error(`error: ${relPath} is missing; run \`git submodule update --init --recursive\` first`);
    process.exit(1);
  }
  const lines = readFileSync(abs, "utf8").split("\n");
  let section = "";
  let old = null;
  let touched = 0;
  const out = lines.map((line) => {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) section = header[1].trim();
    if (
      (section === "package" || section === "workspace.package") &&
      /^version\s*=\s*"/.test(line)
    ) {
      const current = line.match(/^version\s*=\s*"([^"]+)"/)[1];
      if (old === null) old = current;
      if (current === target) return line;
      touched += 1;
      return line.replace(/^version\s*=\s*"[^"]+"/, `version = "${target}"`);
    }
    // Workspace-internal dependency entries carry an explicit `version` (required
    // for crates.io publishing); keep them locked to the workspace version.
    if (
      section === "workspace.dependencies" &&
      /path\s*=\s*"[^"]*crates\//.test(line) &&
      /version\s*=\s*"/.test(line)
    ) {
      const current = line.match(/version\s*=\s*"([^"]+)"/)[1];
      if (old === null) old = current;
      if (current === target) return line;
      touched += 1;
      return line.replace(/version\s*=\s*"[^"]+"/, `version = "${target}"`);
    }
    return line;
  });
  if (touched === 0) return;
  changes.push({ relPath, old: old ?? "?", target });
  if (!dryRun) writeFileSync(abs, out.join("\n"));
}

/** One root manifest per Cargo workspace; each keeps its own lockfile in step. */
const RUST_MANIFESTS = [
  "server/Cargo.toml",
  "server/core/Cargo.toml",
  "server/data/Cargo.toml",
  "client/src-tauri/Cargo.toml",
];

updateJson("package.json", version);
updateJson("client/package.json", version);
updateJson("client/src-tauri/tauri.conf.json", bundleVersion);
for (const manifest of RUST_MANIFESTS) updateCargoToml(manifest, bundleVersion);

if (changes.length === 0) {
  console.log(`All files are already at v${version} (bundle: ${bundleVersion}); nothing to change.`);
  process.exit(0);
}

for (const c of changes) {
  console.log(`${dryRun ? "[dry-run] " : ""}${c.relPath}: ${c.old} -> ${c.target}`);
}

if (dryRun) {
  console.log("dry-run mode; no files were written.");
  process.exit(0);
}

// Refresh the workspace member versions recorded in each Cargo.lock, so --locked builds do not fail
for (const manifest of RUST_MANIFESTS) {
  try {
    execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", join(repoRoot, manifest)], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    console.log(`${manifest.replace(/Cargo\.toml$/, "Cargo.lock")}: workspace member versions refreshed`);
  } catch {
    console.warn(`warning: cargo metadata failed for ${manifest}; its Cargo.lock was not refreshed.`);
  }
}

console.log(`\nSwitched to v${version}. Review the git diff and commit it yourself.`);
