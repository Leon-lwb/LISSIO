#!/usr/bin/env node
/**
 * check-release-sync.mjs — 发布同步门禁: 版本号与 CHANGELOG 必须彼此一致。
 *
 * 为什么需要它: 发布链路上有五个各自独立的版本落点, 任何一处漏改都会造成"文件名说谎"的
 * 产物 —— MSI 不接受 prerelease, 所以 `tauri.conf.json` 与 Cargo 侧只能写去掉后缀的 base
 * 版本, 而 `package.json` 保留完整 semver; `Cargo.lock` 不同步则 `--locked` 构建直接失败;
 * CHANGELOG 落后一个版本, 用户看到的就是错的发布说明。
 *
 * 校验内容:
 *   1. package.json / tauri.conf.json / Cargo.toml([package] 与 [workspace.package] 与内部
 *      [workspace.dependencies]) / Cargo.lock 的版本互相一致;
 *   2. CHANGELOG.md 的元数据块位于条目之上, 最新条目的版本与日期正确, 版本严格递减且不重复;
 *   3. docs/community/CHANGELOG.zh-CN.md 与英文条目的版本集合一致(中英同步)。
 *
 * 它是 pr 层门禁, 因此发布前的 release.yml preflight 会自动覆盖它。
 *
 * 用法:
 *   pnpm check:release-sync
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (message) => errors.push(message);

const read = (path) => readFileSync(path, 'utf8');
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** semver 比较; 返回负数 / 0 / 正数。release 高于同号 prerelease。 */
function compareVersions(a, b) {
  const parse = (value) => {
    const match = value.match(VERSION_RE);
    if (!match) return null;
    return {
      nums: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre: match[4] ? match[4].split('.') : null,
    };
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] - right.nums[i];
  }
  if (!left.pre && !right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  const length = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) return Number(l) - Number(r);
    if (lNum) return -1;
    if (rNum) return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

// ── 1. 版本真源 ────────────────────────────────────────────────────────────
const pkgPath = join(repoRoot, 'package.json');
if (!existsSync(pkgPath)) {
  console.error('✗ package.json 缺失');
  process.exit(1);
}
const version = JSON.parse(read(pkgPath)).version;
if (typeof version !== 'string' || !VERSION_RE.test(version)) {
  console.error(`✗ package.json 的 version "${version}" 不是合法 semver`);
  process.exit(1);
}
const base = version.split('-')[0];

// ── 2. tauri.conf.json ─────────────────────────────────────────────────────
const tauriPath = join(repoRoot, 'src-tauri', 'tauri.conf.json');
if (!existsSync(tauriPath)) {
  fail('src-tauri/tauri.conf.json 缺失');
} else {
  const tauriVersion = JSON.parse(read(tauriPath)).version;
  if (tauriVersion !== base) {
    fail(
      `src-tauri/tauri.conf.json 是 ${tauriVersion}, 应为 base 版本 ${base}(MSI 不接受 prerelease)`,
    );
  }
}

// ── 3. Cargo.toml ─────────────────────────────────────────────────────────
const cargoPath = join(repoRoot, 'src-tauri', 'Cargo.toml');
if (!existsSync(cargoPath)) {
  fail('src-tauri/Cargo.toml 缺失');
} else {
  let section = '';
  const seen = { package: false, 'workspace.package': false };
  for (const line of read(cargoPath).split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) section = header[1].trim();
    if ((section === 'package' || section === 'workspace.package') && /^version\s*=\s*"/.test(line)) {
      seen[section] = true;
      const found = line.match(/^version\s*=\s*"([^"]+)"/)[1];
      if (found !== base) {
        fail(`src-tauri/Cargo.toml [${section}] 是 ${found}, 应为 ${base}(63 个成员通过继承拿到它)`);
      }
    }
    if (
      section === 'workspace.dependencies' &&
      /path\s*=\s*"crates\//.test(line) &&
      /version\s*=\s*"/.test(line)
    ) {
      const found = line.match(/version\s*=\s*"([^"]+)"/)[1];
      if (found !== base) {
        fail(`src-tauri/Cargo.toml [workspace.dependencies] 内部依赖写成 ${found}, 应为 ${base}`);
      }
    }
  }
  if (!seen.package) fail('src-tauri/Cargo.toml [package] 没有 version');
  if (!seen['workspace.package']) fail('src-tauri/Cargo.toml [workspace.package] 没有 version');
}

// ── 4. Cargo.lock ─────────────────────────────────────────────────────────
const lockPath = join(repoRoot, 'src-tauri', 'Cargo.lock');
if (!existsSync(lockPath)) {
  fail('src-tauri/Cargo.lock 缺失; set-version 会通过 cargo metadata 刷新它');
} else {
  let name = null;
  let found = null;
  let checked = 0;
  const flush = () => {
    if (name && /^lissio(-|$)/.test(name)) {
      checked += 1;
      if (found !== base) {
        fail(`src-tauri/Cargo.lock 里 ${name} 是 ${found}, 应为 ${base}; 请重新运行 pnpm set-version`);
      }
    }
    name = null;
    found = null;
  };
  for (const line of read(lockPath).split('\n')) {
    if (line.trim() === '[[package]]') {
      flush();
      continue;
    }
    const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
    if (nameMatch) name = nameMatch[1];
    const versionMatch = line.match(/^version\s*=\s*"([^"]+)"/);
    if (versionMatch) found = versionMatch[1];
  }
  flush();
  if (checked === 0) fail('src-tauri/Cargo.lock 里没有任何 lissio 包记录');
}

// ── 5. CHANGELOG.md ───────────────────────────────────────────────────────
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const zhPath = join(repoRoot, 'docs', 'community', 'CHANGELOG.zh-CN.md');

/** 解析一份 CHANGELOG: 元数据位置 + 条目版本顺序 + 每个条目的标题行。 */
function parseChangelog(path, label) {
  if (!existsSync(path)) {
    fail(`${label} 缺失`);
    return null;
  }
  const text = read(path);
  const metaAt = text.search(/<!--\s*lissio-doc\b/);
  if (metaAt === -1) fail(`${label} 缺少 <!-- lissio-doc --> 元数据块`);

  const entries = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^## \[([^\]]+)\]/);
    if (match) entries.push({ version: match[1], line });
  }
  if (entries.length === 0) fail(`${label} 没有任何 "## [x.y.z]" 条目`);

  const firstAt = text.search(/^## \[/m);
  if (metaAt !== -1 && firstAt !== -1 && metaAt > firstAt) {
    fail(
      `${label}: lissio-doc 元数据块位于首个条目之下 — 运行 pnpm exec node scripts/changelog-normalize.mjs`,
    );
  }
  return entries;
}

const enEntries = parseChangelog(changelogPath, 'CHANGELOG.md');
if (enEntries) {
  const [latest] = enEntries;
  if (latest.version !== version) {
    fail(`CHANGELOG.md 最新条目是 ${latest.version}, 而 package.json 是 ${version} — 发布说明没跟上版本号`);
  }
  if (!/^## \[[^\]]+\]\s+-\s+\d{4}-\d{2}-\d{2}/.test(latest.line)) {
    fail(`CHANGELOG.md 最新条目缺少发布日期: ${latest.line.trim()}`);
  }
  const versions = enEntries.map((entry) => entry.version);
  const duplicates = versions.filter((value, index) => versions.indexOf(value) !== index);
  if (duplicates.length > 0) {
    fail(`CHANGELOG.md 出现重复条目: ${[...new Set(duplicates)].join(', ')}`);
  }
  for (let i = 1; i < versions.length; i += 1) {
    if (compareVersions(versions[i - 1], versions[i]) <= 0) {
      fail(`CHANGELOG.md 条目不是严格递减: ${versions[i - 1]} 之后是 ${versions[i]}`);
    }
  }
}

// ── 6. 中文备份与英文条目对齐 ───────────────────────────────────────────────
const zhEntries = parseChangelog(zhPath, 'docs/community/CHANGELOG.zh-CN.md');
if (enEntries && zhEntries) {
  const zhVersions = new Set(zhEntries.map((entry) => entry.version));
  const missing = enEntries
    .map((entry) => entry.version)
    .filter((value) => !zhVersions.has(value));
  if (missing.length > 0) {
    fail(
      `docs/community/CHANGELOG.zh-CN.md 缺少这些版本的条目: ${missing.join(', ')} — ` +
        '英文 CHANGELOG 由 release:prepare 生成后, 中文备份需要同步',
    );
  }
  if (zhEntries[0].version !== enEntries[0].version) {
    fail(
      `docs/community/CHANGELOG.zh-CN.md 最新条目是 ${zhEntries[0].version}, 英文是 ${enEntries[0].version}`,
    );
  }
}

// ── 结果 ───────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('发布同步门禁失败:');
  for (const message of errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

console.log(
  `✓ 发布同步门禁通过 — v${version} (base ${base}) 在 package.json / tauri.conf.json / ` +
    'Cargo.toml / Cargo.lock 一致, CHANGELOG.md 与中文备份同版本',
);
