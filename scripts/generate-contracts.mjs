#!/usr/bin/env node
// 由 Rust wire 类型生成前端 TypeScript 合同 (ts-rs 显式导出程序)。
//
// 权威来源: src-tauri/crates/desktop/rpc-api/examples/export_contracts.rs
// 输出目录: src/types/generated/ (每个 Rust 类型一个 .ts 文件)
//
// 环境变量:
//   LISSIO_CONTRACTS_OUT  覆盖输出目录 (check:contracts 用临时目录做无副作用比较)
//
// 用法: pnpm generate:contracts

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = process.env.LISSIO_CONTRACTS_OUT
  ?? path.join(root, 'src', 'types', 'generated');

// 重新生成必须是干净的: 残留旧文件会让 check:contracts 的漂移检测漏报已删除的类型
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  'cargo',
  ['run', '-p', 'lissio-rpc-api', '--example', 'export_contracts'],
  {
    cwd: path.join(root, 'src-tauri'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TS_RS_EXPORT_DIR: outDir,
      TS_RS_LARGE_INT: 'number',
    },
  },
);

if (result.status !== 0) {
  console.error(`contract generation failed (exit ${result.status ?? 'signal'})`);
  process.exit(result.status ?? 1);
}
