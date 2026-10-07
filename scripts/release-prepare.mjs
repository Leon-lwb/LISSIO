#!/usr/bin/env node
/**
 * release-prepare.mjs — 本地准备一次发布: 变更文件 → 版本号 + CHANGELOG + 版本文件同步。
 *
 * 为什么留在本地而不进 CI: 打包本身就需要一台原生 macOS 主机(见 RELEASING.md),
 * 版本准备与打包必须落在同一台机器上; 该步骤因此不需要 token, 也不新增 workflow。
 * CI 侧由 `check:changes` / `check:release-sync` 两道门禁守住登记格式与同步关系。
 *
 * 步骤:
 *   1. `covector version`            —— 消费 .changes/*.md, 算出版本, 写 package.json,
 *                                       生成 CHANGELOG 条目, 并触发 postversion 钩子
 *                                       (钩子把 CHANGELOG 归一化回 Keep a Changelog)
 *   2. `set-version.mjs <version>`   —— 把版本扩散到 tauri.conf.json(去掉 prerelease 的
 *                                       base 版本)、[workspace.package]、内部
 *                                       [workspace.dependencies]、Cargo.lock。
 *                                       版本文件的唯一写入者仍然是它。
 *
 * 用法:
 *   pnpm release:prepare                    实际执行
 *   pnpm release:prepare -- --dry-run       只打印 covector 的版本决策, 不写文件
 *   pnpm release:prepare -- --allow-dirty   允许脏工作树
 *   pnpm release:prepare -- --no-set-version 只跑 covector(调试用)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const allowDirty = args.includes('--allow-dirty');
const skipSetVersion = args.includes('--no-set-version');

if (args.includes('--help') || args.includes('-h')) {
  console.log('用法: pnpm release:prepare [--dry-run] [--allow-dirty] [--no-set-version]');
  process.exit(0);
}

const bin = join(repoRoot, 'node_modules', '.bin', 'covector');
if (!existsSync(bin)) {
  console.error('缺少 devDependency covector: 先运行 pnpm install。');
  process.exit(1);
}

const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: repoRoot, stdio: 'inherit' });

const changesDir = join(repoRoot, '.changes');
if (!existsSync(join(changesDir, 'config.json'))) {
  console.error('.changes/config.json 缺失: 无法确定版本策略。');
  process.exit(1);
}

const pending = readdirSync(changesDir).filter(
  (name) => name.endsWith('.md') && !/^readme\.md$/i.test(name),
);
if (pending.length === 0) {
  console.error('没有待处理的变更文件: 先在 .changes/ 下添加一个 .md(见 .changes/README.md)。');
  process.exit(1);
}

if (!dryRun && !allowDirty) {
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (dirty) {
    console.error('工作树不干净, 拒绝在未提交的状态上决定版本号:');
    for (const line of dirty.split('\n')) console.error(`  ${line}`);
    console.error('先提交或 stash; 确实要在脏树上继续时加 --allow-dirty。');
    process.exit(1);
  }
}

console.log(`待处理变更文件: ${pending.length} 个 (${pending.join(', ')})`);

if (dryRun) {
  run(bin, ['version', '--dry-run']);
  console.log('\n[dry-run] 未修改任何文件。');
  process.exit(0);
}

run(bin, ['version']);

const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
console.log(`\n版本已确定为 ${version}`);

if (!skipSetVersion) {
  run(process.execPath, [join(repoRoot, 'scripts', 'set-version.mjs'), version]);
}

console.log(
  [
    '',
    '--- 下一步 ---',
    '1. 检查 git diff: CHANGELOG.md / package.json / src-tauri/{Cargo.toml,tauri.conf.json,Cargo.lock}',
    `2. 同步 docs/community/CHANGELOG.zh-CN.md 的 v${version} 条目(check:release-sync 会校验)`,
    `3. git commit -m "chore(release): v${version}"`,
    `4. pnpm auto-build --version ${version}`,
    `5. pnpm publish:release --version ${version} --dry-run`,
    `6. pnpm publish:release --version ${version}`,
    `7. pnpm release:verify --version ${version}`,
  ].join('\n'),
);
