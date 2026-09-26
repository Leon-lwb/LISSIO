#!/usr/bin/env node
//! check:model-catalog — 模型目录一致性守卫 (前端可见面)。
//!
//! 后端 `kind::widgets::ensure_valid` 已在启动时校验注册 ID/变体唯一、
//! 端口与 lowering 对应; 本脚本补充校验前端消费面与导出 fixture:
//!   1. golden fixtures 可解析、NodeDocument kind 合法、模型 id/变体唯一;
//!   2. 目录契约版本在 Rust 源与前端 store 常量之间一致;
//!   3. 测试目录 fixture 的 widget kind 集合与 UI registry (rendererKey 域)
//!      完全一致 — 新增后端变体/kind 时任何一侧遗漏都会在此暴露。

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const fail = (message) => { console.error(`✗ ${message}`); failed = true; };
const ok = (message) => console.log(`✓ ${message}`);

// ---- 1. golden fixtures ----

const fixtureDir = join(root, 'src', 'test', 'fixtures');
const fixtures = readdirSync(fixtureDir).filter((name) => name.endsWith('.json'));
if (fixtures.length === 0) fail('src/test/fixtures 下没有导出 fixture');
const VALID_KINDS = new Set(['device', 'protocol', 'pointSelector', 'widget']);
const seenDocIds = new Map();
for (const name of fixtures) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));
  } catch (error) {
    fail(`${name} 不是合法 JSON: ${error.message}`);
    continue;
  }
  if (name.startsWith('node_document_')) {
    if (!VALID_KINDS.has(parsed.kind)) fail(`${name}: 未知文档 kind ${parsed.kind}`);
    if (typeof parsed.id !== 'string' || parsed.id === '') fail(`${name}: 文档 id 无效`);
    if (seenDocIds.has(parsed.id) && seenDocIds.get(parsed.id) !== name) {
      fail(`${name}: 文档 id ${parsed.id} 与 ${seenDocIds.get(parsed.id)} 重复`);
    }
    seenDocIds.set(parsed.id, name);
    if (parsed.config?.node) {
      const ids = new Set();
      const visit = (node) => {
        if (ids.has(node.id)) fail(`${name}: 设备树节点 id 重复 ${node.id}`);
        ids.add(node.id);
        for (const child of node.children ?? []) visit(child);
      };
      visit(parsed.config.node);
    }
  }
}
ok(`golden fixtures 解析通过 (${fixtures.length} 个文件)`);

// ---- 2. 目录契约版本一致性 (Rust ↔ 前端 store 常量) ----

const modelDescriptorRs = readFileSync(
  join(root, 'src-tauri', 'crates', 'shared', 'data-model', 'src', 'model_descriptor.rs'), 'utf8');
const rustVersion = /MODEL_CATALOG_CONTRACT_VERSION(?:[^;=]*?)?=[ \t]*(\d+)/.exec(modelDescriptorRs)?.[1];
const storeTs = readFileSync(join(root, 'src', 'store', 'modelCatalogStore.ts'), 'utf8');
const tsVersion = /MODEL_CATALOG_CONTRACT_VERSION\s*=\s*(\d+)/.exec(storeTs)?.[1];
if (!rustVersion || !tsVersion) {
  fail(`契约版本解析失败 (rust=${rustVersion}, ts=${tsVersion})`);
} else if (rustVersion !== tsVersion) {
  fail(`目录契约版本不一致: rust=${rustVersion}, ts=${tsVersion}`);
} else {
  ok(`目录契约版本一致 (v${rustVersion})`);
}

// ---- 3. 测试目录 fixture ↔ UI registry kind 集合 ----

const registryTs = readFileSync(join(root, 'src', 'components', 'widgets', 'registry.ts'), 'utf8');
const registryKinds = [...registryTs.matchAll(/^(?:\s){2}([A-Za-z0-9]+): \w+Def,$/gm)].map((m) => m[1]);
if (registryKinds.length === 0) fail('未能从 widgets/registry.ts 解析出控件 kind 表');

const catalogTs = readFileSync(join(root, 'src', 'test', 'modelCatalog.ts'), 'utf8');
const listStart = catalogTs.indexOf('WIDGET_TEST_KINDS = [');
const listEnd = catalogTs.indexOf('] as const', listStart);
const kindsFromList = listStart >= 0 && listEnd > listStart
  ? [...catalogTs.slice(listStart, listEnd).matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1])
  : [];
if (kindsFromList.length === 0) {
  fail('未能从 test/modelCatalog.ts 解析出 WIDGET_TEST_KINDS');
} else {
  const registry = new Set(registryKinds);
  const fixture = new Set(kindsFromList);
  const missingInFixture = registryKinds.filter((k) => !fixture.has(k));
  const extraInFixture = kindsFromList.filter((k) => !registry.has(k));
  if (missingInFixture.length) fail(`测试目录缺少 UI registry 已有的 kind: ${missingInFixture.join(', ')}`);
  if (extraInFixture.length) fail(`测试目录有 UI registry 未实现的 kind: ${extraInFixture.join(', ')}`);
  if (!missingInFixture.length && !extraInFixture.length) {
    ok(`widget kind 覆盖一致 (${registryKinds.length} 类)`);
  }
}

if (failed) {
  console.error('\ncheck:model-catalog 失败');
  process.exit(1);
}
console.log('\ncheck:model-catalog 通过');
