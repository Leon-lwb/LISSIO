#!/usr/bin/env node
// Web 出口契约对齐校验 —— 防止「前端加了命令 / 后端加了 IPC, 但 Web 出口漏接」。
//
// 数据源 (全部是仓库内的权威清单, 不复制第二份):
//   1. src-tauri/src/lib.rs               Tauri 壳注册的桌面专有 IPC 命令
//   2. rpc-api/src/catalog.rs             SUPPORTED / PENDING / DESKTOP_ONLY / CHANNEL
//   3. rpc-api/src/lib.rs                 dispatch 的 match 分支
//   4. src/**/*.{ts,tsx}                  前端实际调用 (transport.call / invoke) 的命令名
//
// 校验内容:
//   A. 四个清单两两不相交；DESKTOP_ONLY = 壳 IPC 命令集合
//   B. SUPPORTED 中每条命令都有对应的 dispatch 分支
//   C. 前端调用的每个命令名都在公共命令面内 (拼写漂移)
//   D. 前端已在用的命令不得落在未接入集合里而不被察觉
//      (未接入只告警, 不阻断 —— 它们由 /api/v1/capabilities 暴露给前端降级)
//   E. 出口封装: 除 src/lib/rpc/ 外不得直接使用 Tauri IPC —— 否则前端又绑回宿主,
//      Web 出口静默失效

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const errors = [];
const warnings = [];

/** 读取文本, 缺失即报错并返回空串。 */
function read(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    errors.push(`缺少文件: ${relative}`);
    return '';
  }
  return fs.readFileSync(absolute, 'utf8');
}

/** generate_handler![...] 里注册的全部 IPC 命令名 (保序去重)。 */
function ipcCommands() {
  const source = read('src-tauri/src/lib.rs');
  const start = source.indexOf('generate_handler![');
  if (start < 0) {
    errors.push('src-tauri/src/lib.rs 中找不到 generate_handler! 注册表');
    return [];
  }
  const end = source.indexOf('])', start);
  const block = source.slice(start, end);
  const names = [...block.matchAll(/^\s{12}([a-z_0-9]+),\s*$/gm)].map((m) => m[1]);
  return [...new Set(names)];
}

/** catalog.rs 中的命令清单常量。 */
function catalog() {
  const source = read('src-tauri/crates/desktop/rpc-api/src/catalog.rs');
  const lists = {};
  for (const name of ['SUPPORTED', 'PENDING', 'DESKTOP_ONLY', 'CHANNEL']) {
    const match = source.match(
      new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`),
    );
    if (!match) {
      errors.push(`catalog.rs 中找不到 ${name}`);
      lists[name] = [];
      continue;
    }
    lists[name] = [...match[1].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
  }
  return lists;
}

/** dispatch 的 match 分支命令名。 */
function dispatchedCommands() {
  const source = read('src-tauri/crates/desktop/rpc-api/src/lib.rs');
  const start = source.indexOf('pub async fn dispatch');
  const block = source.slice(start);
  return new Set([...block.matchAll(/^\s{8}"([a-z_0-9]+)"\s*=>/gm)].map((m) => m[1]));
}

/** 去掉注释 — 文档里引用 `invoke('cmd')` 不是真的调用。
 *  前置字符判据避免把字符串里的 `http://` 当成行注释。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** 前端源码文件 — 排除测试; `includeBridges` 为真时连出口实现 (lib/rpc、lib/platform)
 *  一起返回, 供需要区分"哪个出口允许 import 什么"的检查使用。 */
function frontendFiles({ includeBridges = false } = {}) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(absolute);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/__tests__|[\\/]test[\\/]|\.test\.|\.spec\./.test(absolute)) continue;
      if (!includeBridges && absolute.includes(path.join('lib', 'rpc'))) continue;
      files.push(absolute);
    }
  };
  walk(path.join(root, 'src'));
  return files;
}

/** 该文件是否属于某个出口实现目录 (lib/rpc = IPC, lib/platform = 插件 shim)。 */
function inBridge(absolute, name) {
  return absolute.includes(path.join('lib', name));
}

/** 前端静态命令名 — 出口无关的 `transport.call` 与历史 `invoke` 两种写法。 */
function frontendInvocations() {
  const patterns = [
    /\binvoke(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'/g,
    /\btransport\.call(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'/g,
  ];
  const found = new Set();
  for (const absolute of frontendFiles()) {
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) found.add(match[1]);
    }
  }
  return found;
}

/** 出口封装 (IPC) — src/lib/rpc/ 之外不得 import @tauri-apps/api/{core,event} 或
 *  直接调用 invoke()/listen()。 */
function transportLeaks() {
  const leaks = [];
  for (const absolute of frontendFiles()) {
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    const relative = path.relative(root, absolute);
    if (/from '@tauri-apps\/api\/(core|event)'/.test(source)) {
      leaks.push(`出口泄漏 (应经 src/lib/rpc/): ${relative} 直接 import @tauri-apps/api/(core|event)`);
    }
    for (const match of source.matchAll(/(?<![.\w])(invoke|listen)(?:<[^>]*>)?\(/g)) {
      leaks.push(`出口泄漏 (应经 src/lib/rpc/): ${relative} 直接调用 ${match[1]}()`);
    }
  }
  return leaks;
}

/** 出口封装 (插件) — src/lib/platform/ 之外不得 import 任何 @tauri-apps/* 模块
 *  (静态或动态)。src/lib/rpc/ 只豁免它本职的 api/{core,event}; 插件调用点一律
 *  必须收进 platform shim, 否则浏览器端会静默失效。 */
function pluginLeaks() {
  const leaks = [];
  // 匹配 `from '@tauri-apps/x'` / `import '@tauri-apps/x'` / `import('@tauri-apps/x')`
  const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)'(@tauri-apps\/[^']+)'/g;
  for (const absolute of frontendFiles({ includeBridges: true })) {
    if (inBridge(absolute, 'platform')) continue;
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    const relative = path.relative(root, absolute);
    for (const match of source.matchAll(importPattern)) {
      const module = match[1];
      if (inBridge(absolute, 'rpc') && /^@tauri-apps\/api\/(core|event)$/.test(module)) continue;
      leaks.push(`出口泄漏 (应经 src/lib/platform/): ${relative} 直接 import ${module}`);
    }
  }
  return leaks;
}

const ipc = new Set(ipcCommands());
const lists = catalog();
const dispatched = dispatchedCommands();
const frontend = frontendInvocations();
const leaks = [...transportLeaks(), ...pluginLeaks()];

// A. 清单互斥，且 Tauri 根包只注册桌面壳命令
const seen = new Map();
for (const [name, list] of Object.entries(lists)) {
  for (const cmd of list) {
    if (seen.has(cmd)) {
      errors.push(`${cmd} 同时出现在 ${seen.get(cmd)} 与 ${name}`);
    } else {
      seen.set(cmd, name);
    }
  }
}
for (const cmd of ipc) {
  if (!lists.DESKTOP_ONLY.includes(cmd)) errors.push(`Tauri 壳注册了非桌面命令: ${cmd}`);
}
for (const cmd of lists.DESKTOP_ONLY) {
  if (!ipc.has(cmd)) errors.push(`DESKTOP_ONLY 未在 Tauri 壳注册: ${cmd}`);
}

// B. SUPPORTED 必须有 dispatch 分支
for (const cmd of lists.SUPPORTED) {
  if (!dispatched.has(cmd)) {
    errors.push(`SUPPORTED 声明了 ${cmd}, 但 dispatch 中没有对应分支`);
  }
}
for (const cmd of dispatched) {
  if (!lists.SUPPORTED.includes(cmd)) {
    errors.push(`dispatch 实现了 ${cmd}, 但未登记进 SUPPORTED`);
  }
}

// C. 前端调用的命令名必须在后端或桌面壳公共命令面内
for (const cmd of frontend) {
  if (!seen.has(cmd)) {
    errors.push(`前端调用了未注册的公共命令: ${cmd}`);
  }
}

// D. 前端已使用但 Web 出口未接入 —— 提示性信息
const notOnWeb = [...frontend].filter(
  (cmd) => lists.PENDING.includes(cmd) || lists.DESKTOP_ONLY.includes(cmd),
);
if (notOnWeb.length) {
  warnings.push(
    `以下命令前端已在用, 但 Web 出口尚未接入 (浏览器端需降级): ${notOnWeb.sort().join(', ')}`,
  );
}

// E. 出口封装 —— 前端只能经 src/lib/rpc/ (IPC) 与 src/lib/platform/ (插件) 触达 Tauri
for (const leak of leaks) {
  errors.push(leak);
}

const summary = [
  `桌面壳 IPC ${ipc.size} 条`,
  `SUPPORTED ${lists.SUPPORTED.length}`,
  `PENDING ${lists.PENDING.length}`,
  `DESKTOP_ONLY ${lists.DESKTOP_ONLY.length}`,
  `CHANNEL ${lists.CHANNEL.length}`,
  `前端调用 ${frontend.size}`,
  `出口泄漏 ${leaks.length}`,
].join(' / ');

if (warnings.length) {
  console.warn(warnings.map((message) => `⚠ ${message}`).join('\n'));
}
if (errors.length) {
  console.error(`Web 出口契约校验失败 (${errors.length}):\n${errors.map((e) => `- ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ Web 出口契约校验通过 — ${summary}`);
