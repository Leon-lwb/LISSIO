#!/usr/bin/env node
/**
 * check-deps.mjs — 第三方依赖版本统一机械校验
 *
 * 规则 (docs/architecture/crate-layers.md「第三方依赖版本统一」节):
 *   1. 全部 workspace 成员(含根 package vofa-next)的依赖必须以 `X = { workspace = true }`
 *      继承根 [workspace.dependencies],禁止在成员 manifest 内联 `version` 或 `path`;
 *   2. 继承项不得重复书写 version(cargo 本身禁止,此处双保险);
 *   3. 一次性依赖也必须先登记到根 [workspace.dependencies],保证版本单一来源。
 *
 * 校验范围: src-tauri/Cargo.toml(根 package)+ crates/<层>/<crate>/Cargo.toml 全部成员。
 * 用法: pnpm check:deps
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(repoRoot, "src-tauri");
const errors = [];

// ---- 简易 TOML 行处理: 合并被 inline table 撑破的多行条目, 跳过注释/空行 ----
function logicalLines(text) {
  const out = [];
  let buf = null;
  let depth = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (buf === null) {
      if (/^\s*(#|$)/.test(raw)) continue;
      buf = raw;
    } else {
      buf += " " + raw.trim();
    }
    // 统计引号外的大括号差值, >0 表示 inline table 未闭合
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

/** 返回 { mode: 'registry' } | { mode: 'deps' } | { mode: 'subtable', dep } | null(忽略) */
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
 * 解析单个 manifest。
 * 返回 { registry: Map<name, {internal}>, depEntries: [{ dep, kind, inherited, inlineVersion, hasPath }] }
 */
function parseManifest(text) {
  const registry = new Map();
  const depEntries = [];
  let current = null;
  let subtableDep = null;

  for (const line of logicalLines(text)) {
    // [[bench]] / [[bin]] 等数组节: 不是依赖节, 重置上下文避免其键值被误记入前一节
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

    // 依赖子表写法: [dependencies.foo] 下的行为该依赖的属性
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

    // 点号简写: foo.workspace = true
    const dotted = line.match(/^([A-Za-z0-9_-]+)\.workspace\s*=\s*true\s*$/);
    if (dotted) {
      depEntries.push({ dep: dotted[1], kind: "dependencies", inherited: true, inlineVersion: false, hasPath: false });
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (kv) {
      const value = kv[2].trim();
      // `dep = "1.2"` 裸字符串是 `{ version = "1.2" }` 的 TOML 简写
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
      errors.push(`${label}: "${e.dep}" 已走 workspace 继承, 不得再内联 version`);
      continue;
    }
    if (e.inherited) continue;
    const what = e.inlineVersion ? "内联 version" : e.hasPath ? "内联 path" : "未声明来源";
    errors.push(
      `${label}: "${e.dep}" ${what} — 请登记根 [workspace.dependencies] 后以 "${e.dep} = { workspace = true }" 引用`,
    );
  }
}

// ---- 根 manifest (workspace + 根 package 二合一) ----
const rootLabel = "vofa-next (根)";
checkManifest(rootLabel, readFileSync(join(workspaceRoot, "Cargo.toml"), "utf8"));

// ---- 全部成员 crate ----
const cratesDir = join(workspaceRoot, "crates");
let memberCount = 0;
for (const layer of readdirSync(cratesDir, { withFileTypes: true })) {
  if (!layer.isDirectory()) continue;
  for (const crate of readdirSync(join(cratesDir, layer.name), { withFileTypes: true })) {
    if (!crate.isDirectory()) continue;
    const manifest = join(cratesDir, layer.name, crate.name, "Cargo.toml");
    checkManifest(`${layer.name}/${crate.name}`, readFileSync(manifest, "utf8"));
    memberCount++;
  }
}

if (errors.length > 0) {
  console.error(`✗ 依赖版本统一校验失败 (${errors.length} 处):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\n规则见 docs/architecture/crate-layers.md「第三方依赖版本统一」");
  process.exit(1);
}

console.log(`✓ 依赖版本统一校验通过 — ${memberCount} 个成员 + 根 package, 全部依赖走 [workspace.dependencies] 继承`);
