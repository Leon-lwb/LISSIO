#!/usr/bin/env node
/**
 * check-changes.mjs — `.changes` 变更文件与配置的合法性门禁。
 *
 * 为什么需要它: covector 对变更文件的失效方式是**静默丢弃**。写错包名的条目不会报错,
 * 只会让这条改动无声地消失在下一次发版说明里; 写错 bump 类型或 tag 同理。本门禁把这些
 * 失败从"发布当天才发现"提前到 PR 阶段, 并且只读取文件, 不依赖 diff 基准。
 *
 * 校验内容:
 *   - config.json: 顶层键合法(与 covector 的 .strict() 模式一致)、包路径与 manifest 存在、
 *     manager 已定义且具备写入版本的能力;
 *   - .changes/*.md: frontmatter 可解析、包名已声明、bump 类型合法、tag 已声明、摘要非空、
 *     同一文件不重复声明同一个包;
 *   - pre.json: 结构合法、tag 非空、changes 数组里的文件确实存在。
 *
 * 用法:
 *   pnpm check:changes
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const changesDir = join(repoRoot, '.changes');
const rel = (path) => relative(repoRoot, path).split(/[\\/]/).join('/');

const errors = [];
const fail = (message) => errors.push(message);

// covector 的 configFileSchema 是 .strict(): 未知顶层键直接抛错。这里保持同一份清单,
// 让配置拼写错误在 PR 阶段而不是发版当天被拦住。
const CONFIG_KEYS = new Set([
  'changeFolder',
  'gitSiteUrl',
  'timeout',
  'additionalBumpTypes',
  'defaultChangeTag',
  'pkgManagers',
  'packages',
  'changeTags',
]);
const BASE_BUMPS = ['major', 'minor', 'patch', 'noop'];
const README_RE = /^readme\.md$/i;
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

/** covector 的 manager → manifest 推断规则(`@covector/files` readPkgFile)。 */
function manifestName(manager, packageFileName) {
  if (packageFileName) return packageFileName;
  if (/rust/.test(manager)) return 'Cargo.toml';
  if (/dart|flutter/.test(manager)) return 'pubspec.yaml';
  return 'package.json';
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${rel(path)}: 不是合法 JSON — ${error.message}`);
    return null;
  }
}

// ── .changes 与 config.json ────────────────────────────────────────────────
if (!existsSync(changesDir) || !statSync(changesDir).isDirectory()) {
  fail('.changes/ 目录缺失; 版本策略与变更文件都放在这里');
}

const configPath = join(changesDir, 'config.json');
const config = existsSync(configPath) ? readJson(configPath) : null;
if (!config) {
  if (!existsSync(configPath)) fail('.changes/config.json 缺失');
  console.error(errors.map((message) => `✗ ${message}`).join('\n'));
  process.exit(1);
}

for (const key of Object.keys(config)) {
  if (!CONFIG_KEYS.has(key)) {
    fail(`.changes/config.json: 未知顶层键 "${key}" — covector 的配置是严格模式, 该键会让所有命令失败`);
  }
}

const packages = config.packages;
const pkgManagers = config.pkgManagers ?? {};
const changeTags = config.changeTags ?? {};
const additionalBumps = config.additionalBumpTypes ?? [];

if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
  fail('.changes/config.json: packages 必须是对象');
} else if (Object.keys(packages).length === 0) {
  fail('.changes/config.json: packages 不能为空');
}

for (const [name, entry] of Object.entries(packages ?? {})) {
  if (!entry || typeof entry !== 'object') {
    fail(`.changes/config.json: 包 "${name}" 必须是对象`);
    continue;
  }
  const dir = resolve(repoRoot, entry.path ?? '');
  if (typeof entry.path !== 'string' || !entry.path) {
    fail(`.changes/config.json: 包 "${name}" 缺少 path`);
  } else if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`.changes/config.json: 包 "${name}" 的 path 不存在 — ${entry.path}`);
  } else {
    const manifest = join(dir, manifestName(entry.manager ?? '', entry.packageFileName));
    if (!existsSync(manifest)) {
      fail(`.changes/config.json: 包 "${name}" 找不到 manifest — ${rel(manifest)}`);
    }
  }

  const manager = pkgManagers[entry.manager];
  if (typeof entry.manager !== 'string' || !entry.manager) {
    fail(`.changes/config.json: 包 "${name}" 缺少 manager; 没有 manager 就不会写入版本号`);
  } else if (!manager) {
    fail(
      `.changes/config.json: 包 "${name}" 的 manager "${entry.manager}" 未在 pkgManagers 中定义 — ` +
        '版本写入会静默跳过',
    );
  } else if (manager.version !== true && entry.version === undefined) {
    fail(
      `.changes/config.json: 包 "${name}" 未启用版本写入 — pkgManagers.${entry.manager}.version ` +
        '既不是 true, 包上也没有自定义 version 命令',
    );
  }
}

for (const [tag, heading] of Object.entries(changeTags)) {
  if (!KEBAB_RE.test(tag)) fail(`.changes/config.json: changeTags 的键 "${tag}" 不是 kebab-case`);
  if (typeof heading !== 'string' || !heading) {
    fail(`.changes/config.json: changeTags["${tag}"] 必须是章节标题字符串`);
  }
}
if (config.defaultChangeTag !== undefined && !(config.defaultChangeTag in changeTags)) {
  fail(
    `.changes/config.json: defaultChangeTag "${config.defaultChangeTag}" 不在 changeTags 中`,
  );
}

// ── 变更文件 ───────────────────────────────────────────────────────────────
const ALLOWED_BUMPS = new Set([...BASE_BUMPS, ...additionalBumps]);
const changeFiles = existsSync(changesDir)
  ? readdirSync(changesDir)
      .filter((name) => name.endsWith('.md') && !README_RE.test(name))
      .sort()
  : [];

const RELEASE_LINE = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9@/._-]+))\s*:\s*([a-z]+)\s*(?::\s*([a-z][a-z0-9-]*))?\s*$/;

for (const name of changeFiles) {
  const path = join(changesDir, name);
  const label = rel(path);
  const text = readFileSync(path, 'utf8');

  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!front) {
    fail(`${label}: 缺少 --- 包裹的 frontmatter`);
    continue;
  }
  const body = text.slice(front[0].length).trim();
  if (!body) fail(`${label}: frontmatter 之后没有摘要正文`);

  const seen = new Set();
  let releases = 0;
  for (const rawLine of front[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(RELEASE_LINE);
    if (!match) {
      fail(`${label}: 无法解析 frontmatter 行 "${line}"(期望 "<包名>": <bump>[:<tag>])`);
      continue;
    }
    const pkg = match[1] ?? match[2] ?? match[3];
    const bump = match[4];
    const tag = match[5];

    if (seen.has(pkg)) fail(`${label}: 同一个包 "${pkg}" 被声明了两次`);
    seen.add(pkg);
    releases += 1;

    if (!packages || !(pkg in packages)) {
      fail(
        `${label}: 包 "${pkg}" 不在 config.json 的 packages 中 — covector 会静默丢弃这条改动`,
      );
    }
    if (!ALLOWED_BUMPS.has(bump)) {
      fail(`${label}: bump 类型 "${bump}" 非法(允许 ${[...ALLOWED_BUMPS].join(' / ')})`);
    }
    if (tag && !(tag in changeTags)) {
      fail(`${label}: tag "${tag}" 未在 config.json 的 changeTags 中声明`);
    }
  }
  if (releases === 0) fail(`${label}: frontmatter 里没有声明任何包`);
}

// ── 预发布模式 ─────────────────────────────────────────────────────────────
const prePath = join(changesDir, 'pre.json');
if (existsSync(prePath)) {
  const pre = readJson(prePath);
  if (pre) {
    if (typeof pre.tag !== 'string' || !pre.tag) {
      fail('.changes/pre.json: tag 必须是非空字符串(例如 "beta")');
    } else if (!/^[a-z][a-z0-9.-]*$/.test(pre.tag)) {
      fail(`.changes/pre.json: tag "${pre.tag}" 只能是小写字母、数字、点和连字符`);
    }
    if (!Array.isArray(pre.changes)) {
      fail('.changes/pre.json: changes 必须是数组');
    } else {
      for (const entry of pre.changes) {
        if (typeof entry !== 'string') {
          fail(`.changes/pre.json: changes 的元素必须是路径字符串, 收到 ${JSON.stringify(entry)}`);
        } else if (!existsSync(resolve(repoRoot, entry))) {
          fail(`.changes/pre.json: changes 指向的文件不存在 — ${entry}`);
        }
      }
    }
  }
}

// ── 结果 ───────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('变更文件门禁失败:');
  for (const message of errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

const pre = existsSync(prePath) ? ', 预发布模式开启' : '';
console.log(
  `✓ 变更文件门禁通过 — ${changeFiles.length} 个变更文件, ` +
    `${Object.keys(packages ?? {}).length} 个包, ${Object.keys(changeTags).length} 个 changelog 章节${pre}`,
);
