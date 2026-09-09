#!/usr/bin/env node
/**
 * set-version.mjs — 一键修改 Rust / 前端版本号
 *
 * 更新位置:
 *   1. package.json                  → "version" (完整 semver)
 *   2. src-tauri/tauri.conf.json     → "version" (MSI 不支持 prerelease,写剥离后的 base 版本)
 *   3. src-tauri/Cargo.toml          → [package] 与 [workspace.package] 的 version (同 2,写 base 版本)
 *      (所有 crates 以 version.workspace = true 继承,自动跟随)
 *   4. src-tauri/Cargo.lock          → 通过 cargo metadata 刷新 workspace 成员版本记录
 *
 * 用法:
 *   pnpm set-version 0.2.0            实际修改
 *   pnpm set-version 0.2.0 --dry-run  只打印将做的改动,不写文件
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(repoRoot, "src-tauri");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((a) => !a.startsWith("-"));

if (!version || args.includes("--help") || args.includes("-h")) {
  console.log("用法: pnpm set-version <semver> [--dry-run]");
  console.log("示例: pnpm set-version 0.2.0");
  process.exit(version ? 0 : 1);
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!SEMVER.test(version)) {
  console.error(`错误: "${version}" 不是合法的 semver (例如 0.2.0 或 1.0.0-beta.1)`);
  process.exit(1);
}

const changes = [];

// MSI 等打包器不接受 prerelease 标识符: tauri.conf.json / Cargo.toml 只写 base 版本,
// package.json 保留完整 semver (如 0.1.3-beta.1)
const bundleVersion = version.split("-")[0];

function updateJson(relPath, target) {
  const abs = join(repoRoot, relPath);
  const text = readFileSync(abs, "utf8");
  const match = text.match(/^(\s*)"version":\s*"([^"]+)"/m);
  if (!match) {
    console.error(`错误: ${relPath} 中找不到 "version" 字段`);
    process.exit(1);
  }
  const old = match[2];
  if (old === target) return;
  changes.push({ relPath, old, target });
  if (!dryRun) {
    writeFileSync(abs, text.replace(/^(\s*)"version":\s*"[^"]+"/m, `$1"version": "${target}"`));
  }
}

function updateCargoToml(target) {
  const relPath = "src-tauri/Cargo.toml";
  const abs = join(repoRoot, relPath);
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
    return line;
  });
  if (touched === 0) return;
  changes.push({ relPath, old: old ?? "?", target });
  if (!dryRun) writeFileSync(abs, out.join("\n"));
}

updateJson("package.json", version);
updateJson("src-tauri/tauri.conf.json", bundleVersion);
updateCargoToml(bundleVersion);

if (changes.length === 0) {
  console.log(`所有文件已是 v${version} (bundle: ${bundleVersion}),无需修改。`);
  process.exit(0);
}

for (const c of changes) {
  console.log(`${dryRun ? "[dry-run] " : ""}${c.relPath}: ${c.old} -> ${c.target}`);
}

if (dryRun) {
  console.log("dry-run 模式,未写入任何文件。");
  process.exit(0);
}

// 刷新 Cargo.lock 中 workspace 成员的版本记录,避免 --locked 构建失败
try {
  execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", join(workspaceRoot, "Cargo.toml")], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log("src-tauri/Cargo.lock: workspace 成员版本已刷新");
} catch {
  console.warn("警告: cargo metadata 执行失败,Cargo.lock 未刷新;请手动运行一次 cargo check。");
}

console.log(`\n已切换到 v${version}。请自行检查 git diff 并提交。`);
