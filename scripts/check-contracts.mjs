#!/usr/bin/env node
// 合同漂移检查 —— Rust wire 类型与已提交的 src/types/generated 必须一致。
//
// 做法: 把导出程序跑进临时目录, 与工作区文件逐字节比较; 不修改工作区。
// 失败说明: Rust 侧改了 wire 类型但没重新 pnpm generate:contracts。
//
// 用法: pnpm check:contracts

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
// import.meta.dirname 是平台原生路径; new URL(...).pathname 在 Windows 上会得到
// "/C:/..." 形式的路径, existsSync 判为不存在, 使本检查在 Windows 上必然失败
const root = join(import.meta.dirname, '..');
const committedDir = join(root, 'src', 'types', 'generated');

if (!existsSync(committedDir)) {
  console.error('缺少 src/types/generated —— 先运行 pnpm generate:contracts');
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), 'lissio-contracts-'));
const result = spawnSync(
  'cargo',
  ['run', '-p', 'lissio-rpc-api', '--example', 'export_contracts'],
  {
    cwd: join(root, 'src-tauri'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TS_RS_EXPORT_DIR: tempDir,
      TS_RS_LARGE_INT: 'number',
    },
  },
);

if (result.status !== 0) {
  rmSync(tempDir, { recursive: true, force: true });
  console.error(`contract export failed (exit ${result.status ?? 'signal'})`);
  process.exit(result.status ?? 1);
}

/// 比较前统一换行符 — 工作区文件的行尾由 git 检出决定 (core.autocrlf 下 Windows 为 CRLF),
/// 而 ts-rs 恒写 LF。行尾不属于 wire 合同内容, 归一后再比; Linux/macOS 检出本来即 LF,
/// 归一为无操作, 因此该比较保持跨平台一致。
function normalizeEol(content) {
  return content.replace(/\r\n/g, '\n');
}

/** 递归收集相对路径 → 内容。 */
function snapshot(dir) {
  const files = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const absolute = join(entry.parentPath ?? dir, entry.name);
    files.set(relative(dir, absolute), normalizeEol(readFileSync(absolute, 'utf8')));
  }
  return files;
}

const committed = snapshot(committedDir);
const generated = snapshot(tempDir);
const problems = [];

for (const [rel, content] of committed) {
  if (!generated.has(rel)) {
    problems.push(`多余文件 (Rust 侧已删除该类型): ${rel}`);
  } else if (generated.get(rel) !== content) {
    problems.push(`内容漂移: ${rel}`);
  }
}
for (const rel of generated.keys()) {
  if (!committed.has(rel)) {
    problems.push(`缺失文件 (Rust 侧新增了类型): ${rel}`);
  }
}

rmSync(tempDir, { recursive: true, force: true });

if (problems.length > 0) {
  console.error('check:contracts 失败 —— 生成结果与提交文件不一致:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('运行 pnpm generate:contracts 后提交更新的 generated 目录。');
  process.exit(1);
}
console.log(`check:contracts 通过 (${committed.size} 个合同文件)`);
