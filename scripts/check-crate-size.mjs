#!/usr/bin/env node
/**
 * check-crate-size.mjs — Rust 生产文件 500 行上限。
 *
 * 规则来源: `AGENTS.md`「Rust production files are limited to 500 lines; split
 * implementation modules without changing the stable crate API.」
 *
 * 豁免口径 (与原先只存在于 `lint.yml` 里、跑不起来的 job 一致):
 *   - 路径中带 `tests` 目录的
 *   - `*_tests.rs`
 *   - 路径中带 `benches` 目录的
 * 即: 只约束生产源码, 测试与基准不计入。
 *
 * 为什么单独一个脚本而不是写在 workflow 里: 这条规则原先只用 `find | awk`
 * 内联在 `lint.yml`, 仓库迁到 Codeberg 后再也没有执行过, 于是 514 行的
 * `cmd/mod.rs` 长期违反而无人发现。规则进 `scripts/gates.mjs` 之后由
 * check-all / Forgejo / 本地共用同一条命令。
 *
 * 用法: pnpm check:rust-size
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot, CWD } from './gates.mjs';

/** 生产源码扫描根 (相对 src-tauri)。 */
const SCAN_ROOTS = ['crates', 'src'];
/** 单文件行数上限。 */
const LIMIT = 500;
const SKIP_DIRS = new Set(['target', 'node_modules']);

/** 测试与基准豁免: 目录名或文件名特征。 */
function isExempt(relPath) {
  const parts = relPath.split('/');
  if (parts.includes('tests') || parts.includes('benches')) return true;
  return parts.at(-1).endsWith('_tests.rs');
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.name.endsWith('.rs')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const tauriRoot = join(repoRoot, CWD['src-tauri']);
const offenders = [];
let scanned = 0;

for (const root of SCAN_ROOTS) {
  for (const file of walk(join(tauriRoot, root))) {
    // 用相对 src-tauri 的路径判断豁免, 保持与原 find 表达式同一口径
    const relToTauri = relative(tauriRoot, file).split(/[\\/]/).join('/');
    if (isExempt(relToTauri)) continue;
    // 与 `wc -l` 严格同口径: 只数换行符。不要为"结尾无换行"补 +1 —— 原规则
    // 就是一行的 `wc -l`, 它同样不补。补 +1 会让一个 500 换行、无结尾换行的
    // 文件在 `find|wc -l` 下通过、在这里却报错, 两边对不上。
    const content = readFileSync(file, 'utf8');
    let lines = 0;
    for (const char of content) if (char === '\n') lines += 1;
    scanned += 1;
    if (lines > LIMIT) offenders.push({ path: relToTauri, lines });
  }
}

if (offenders.length > 0) {
  console.error(`✗ Rust 生产文件超过 ${LIMIT} 行上限 (测试与基准豁免):\n`);
  for (const offender of offenders.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${offender.lines} 行  src-tauri/${offender.path}`);
  }
  console.error('\n拆分实现模块, 不要改动稳定的 crate 公开 API (见 AGENTS.md)。');
  process.exit(1);
}

if (scanned === 0) {
  // 扫描不到文件说明路径写错了或目录不存在, 不是"全部合规"。宁可响亮失败,
  // 也不要输出一个看起来通过的 0。
  console.error('✗ 扫描到 0 个 Rust 源文件 — 路径不对或目录缺失, 无法判定 500 行规则。');
  console.error(`  预期扫描根: ${SCAN_ROOTS.join(', ')} (相对 ${tauriRoot})`);
  process.exit(1);
}

console.log(`✓ Rust 生产文件均在 ${LIMIT} 行以内 (扫描 ${scanned} 个文件, 测试与基准豁免)`);
