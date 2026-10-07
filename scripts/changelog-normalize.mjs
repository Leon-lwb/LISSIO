#!/usr/bin/env node
/**
 * changelog-normalize.mjs — 把 covector 生成的 CHANGELOG 条目恢复成仓库声明的格式。
 *
 * 背景: `covector version` 会把新条目插在 `# Changelog` 之后,把 `<!-- lissio-doc -->`
 * 元数据块和 Keep a Changelog 说明挤到文件中部,标题也不带日期。本脚本把它拉回来:
 *
 *   1. 元数据块 + 前言段落搬回 H1 正下方;
 *   2. 最新条目补上 ` - YYYY-MM-DD`;
 *   3. 去掉条目里 `[`sha`](...)` / `([#12](...) by [@u](...))` 这类机器前缀。
 *
 * 幂等: 已经是目标格式时不写任何文件。它由 `.changes/config.json` 的 postversion
 * 钩子调用,也可以单独运行来修正手工编辑造成的结构漂移。
 *
 * 用法:
 *   node scripts/changelog-normalize.mjs [--version <semver>] [--date YYYY-MM-DD] [--dry-run]
 *
 * --version 省略时读 package.json(版本真源)。postversion 钩子在版本写入之后执行,
 * 所以默认行为即正确。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = join(repoRoot, 'CHANGELOG.md');

const args = process.argv.slice(2);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const dryRun = args.includes('--dry-run');
const metaRe = /<!--\s*lissio-doc\b[\s\S]*?-->/;

const version =
  valueOf('--version') ??
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
const date = valueOf('--date') ?? new Date().toLocaleDateString('sv-SE');

const original = readFileSync(changelogPath, 'utf8');

// ── 拆出 H1 ────────────────────────────────────────────────────────────────
const h1 = original.match(/^#\s+.*$/m);
if (!h1) {
  console.error('CHANGELOG.md: 找不到 H1 标题');
  process.exit(1);
}
const heading = h1[0];
let body = original.slice(h1.index + heading.length);

// ── 定位并摘出前置元数据 + 前言 ─────────────────────────────────────────────
const meta = body.match(metaRe);
let frontMatter = '';
if (meta) {
  const afterMeta = body.slice(meta.index + meta[0].length);
  const nextSection = afterMeta.search(/^## \[/m);
  const preamble = (nextSection === -1 ? afterMeta : afterMeta.slice(0, nextSection)).trim();
  frontMatter = preamble ? `${meta[0]}\n\n${preamble}` : meta[0];
  body = body.slice(0, meta.index) + (nextSection === -1 ? '' : afterMeta.slice(nextSection));
}

// ── 归一化条目 ─────────────────────────────────────────────────────────────
body = body.replace(/^\s+/, '');
const split = body.slice(1).search(/^## \[/m);
const firstEnd = split === -1 ? body.length : split + 1;
const before = body;
let first = body.slice(0, firstEnd);
let history = body.slice(firstEnd);

// 机器前缀在所有条目里都是 covector 的产物(手写历史不含此形态), 因此全局剥离;
// 日期只加在最新一条上, 绝不改写历史条目的发布日期。
const stripMachinePrefix = (section) =>
  section
    .replace(/^(\s*-\s+)\[`[^`]*`\]\([^)]*\)\s*/gm, '$1')
    .replace(
      /^(\s*-\s+)\(\[#\d+\]\([^)]*\)(?:\s+by\s+\[@[^\]]+\]\([^)]*\))?\)\s*/gm,
      '$1',
    );

first = stripMachinePrefix(first).replace(
  /^(## \[[^\]]+\])(?!\s*-\s*\d{4}-\d{2}-\d{2})/m,
  `$1 - ${date}`,
);
history = stripMachinePrefix(history);

const next = `${heading}\n\n${frontMatter}\n\n${first.trimEnd()}\n\n${history.trimStart()}`
  .replace(/\n{3,}/g, '\n\n')
  .replace(/\n+$/, '\n');

if (next === original) {
  console.log(`CHANGELOG.md: 已是目标格式 (v${version}, ${date}),未修改。`);
  process.exit(0);
}

const changed = [];
if (frontMatter) changed.push('  front matter hoisted to the top');
if (before !== `${first.trimEnd()}\n\n${history.trimStart()}`) changed.push('  entries reformatted');
if (dryRun) {
  console.log(`[dry-run] CHANGELOG.md 将更新 (v${version}, ${date}):`);
  console.log(changed.join('\n') || '  (whitespace only)');
  process.exit(0);
}
writeFileSync(changelogPath, next);
console.log(`CHANGELOG.md: 已归一化为 v${version} (${date})`);
