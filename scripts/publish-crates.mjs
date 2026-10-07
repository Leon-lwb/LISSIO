#!/usr/bin/env node
/**
 * publish-crates.mjs — 按依赖拓扑序把 workspace crates 发布到 crates.io
 *
 * 顺序: cargo metadata 依赖图 (含 dev-dependencies, 保证 graph-testkit 先于
 * 依赖它的测试宿主发布)。发布前经 crates.io API 预检包名/版本占用; 上传成功后
 * 轮询索引直到新版本可见, 再发布下游 (crates.io 索引传播需要数十秒)。
 *
 * 用法:
 *   pnpm publish:crates                       dry-run: 预检 + 逐包 `cargo publish --dry-run`, 不上传
 *   pnpm publish:crates -- --execute          实际发布 (需要 cargo login 凭据)
 *   pnpm publish:crates -- --from lissio-kind 从拓扑序某处继续 (中断恢复)
 *   pnpm publish:crates -- --only lissio-error,lissio-kind
 *   pnpm publish:crates -- --skip lissio-app
 *   pnpm publish:crates -- --allow-dirty      允许脏工作树 (默认拒绝)
 *
 * 认证: 使用 cargo 默认凭据 (~/.cargo/credentials) 或 CARGO_REGISTRY_TOKEN 环境变量。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repoRoot, 'src-tauri', 'Cargo.toml');
const REGISTRY_API = 'https://crates.io/api/v1';
// crates.io 要求 UA 里带可达的项目主页; 仓库已迁到 Codeberg。
const USER_AGENT = 'lissio-publish-script (https://codeberg.org/Horldsence/Lissio)';
const INDEX_POLL_INTERVAL_MS = 4_000;
const INDEX_POLL_TIMEOUT_MS = 180_000;
const INTER_PUBLISH_PAUSE_MS = 2_000;
// 桌面应用壳随发行版打包, 不走 crates.io; 如需占位发布用 --only lissio 覆盖。
const DEFAULT_SKIP = new Set(['lissio']);

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const allowDirty = args.includes('--allow-dirty');
const onlyList = listArg('--only');
const skipList = listArg('--skip');
const from = args.find((arg) => arg.startsWith('--from='))?.split('=')[1]
  ?? (args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined)
  ?? null;

function listArg(name) {
  const value = args.find((arg) => arg.startsWith(`${name}=`))?.split('=')[1]
    ?? (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

function fail(message) {
  console.error(`错误: ${message}`);
  process.exit(1);
}

function cargoJson(extraArgs) {
  return JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', ...extraArgs, '--manifest-path', manifestPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }));
}

async function registryGet(path) {
  const response = await fetch(`${REGISTRY_API}${path}`, { headers: { 'user-agent': USER_AGENT } });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after')) || 30;
    await sleep(retryAfter * 1_000);
    return registryGet(path);
  }
  return { status: response.status, body: response.ok ? await response.json() : null };
}

const sleep = (ms) => new Promise((resolve_) => setTimeout(resolve_, ms));

// --- 装载 workspace 成员与依赖边 ---

const metadata = cargoJson(['--no-deps']);
const members = new Set(metadata.workspace_members);
const packages = metadata.packages.filter((pkg) => members.has(pkg.id));
const memberByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
const workspaceVersion = metadata.packages.find((pkg) => pkg.name === 'lissio')?.version;
if (!workspaceVersion) fail('无法从 cargo metadata 解析 workspace 版本');

// 静态保障: [workspace.dependencies] 内部条目必须带显式 version (crates.io 上
// path 依赖会被剥离, 无 version 则下游发布时无法解析)。
for (const line of readFileSync(manifestPath, 'utf8').split('\n')) {
  if (/path\s*=\s*"crates\//.test(line) && !/version\s*=\s*"/.test(line) && /^\s*[^#[]/.test(line)) {
    fail(`[workspace.dependencies] 内部条目缺少 version: ${line.trim()}`);
  }
}

// 依赖边: normal/build 决定发布顺序; dev-dependencies 只作为顺序偏好 —
// 本仓库存在 dev-dep 环 (如 can ↔ data-model), cargo 允许, 但严格拓扑会死锁。
// 内部 dev-dep 尚未进入索引的 crate 用 --no-verify 发布 (跳过编译验证, 见下)。
const normalDepsOf = new Map(packages.map((pkg) => [pkg.name, []]));
const devDepsOf = new Map(packages.map((pkg) => [pkg.name, []]));
for (const pkg of packages) {
  for (const dependency of pkg.dependencies) {
    if (!memberByName.has(dependency.name) || dependency.name === pkg.name) continue;
    // cargo metadata: kind 为 null (normal) / "dev" / "build" (旧版本为数组, 兼容两种形态)。
    const kinds = Array.isArray(dependency.kind) ? dependency.kind : dependency.kind ? [dependency.kind] : [];
    (kinds.includes('dev') ? devDepsOf : normalDepsOf).get(pkg.name).push(dependency.name);
  }
}

// Kahn 拓扑排序 (normal/build 边, 被依赖者在前)。同级优先选择内部 dev-dep
// 都已排定的 crate, 尽量让下游发布时 dev-dep 可解析。
const pendingDeps = new Map([...normalDepsOf].map(([name, deps]) => [name, deps.length]));
const dependents = new Map(packages.map((pkg) => [pkg.name, []]));
for (const [name, deps] of normalDepsOf) {
  for (const dep of deps) dependents.get(dep).push(name);
}
const ordered = new Set();
const ready = packages.filter((pkg) => pendingDeps.get(pkg.name) === 0).map((pkg) => pkg.name);
const pickNext = () => {
  const satisfied = ready.filter((name) => devDepsOf.get(name).every((dep) => ordered.has(dep)));
  const pool = satisfied.length ? satisfied : ready;
  pool.sort();
  return pool[0];
};
const order = [];
while (ready.length) {
  const name = pickNext();
  ready.splice(ready.indexOf(name), 1);
  order.push(name);
  ordered.add(name);
  for (const dependent of dependents.get(name)) {
    const left = pendingDeps.get(dependent) - 1;
    pendingDeps.set(dependent, left);
    if (left === 0) ready.push(dependent);
  }
}
if (order.length !== packages.length) {
  const cyclic = packages.map((pkg) => pkg.name).filter((name) => !order.includes(name));
  fail(`依赖图存在环或不可解析: ${cyclic.join(', ')}`);
}

// --- 过滤出要发布的集合 ---

const skipped = new Set(DEFAULT_SKIP);
for (const pkg of packages) {
  // publish = false 在 metadata 中表现为 [] (受限注册表列表为非空数组, null 为不限制)。
  if (Array.isArray(pkg.publish)) {
    console.log(`跳过 ${pkg.name}: manifest 声明 publish = false`);
    skipped.add(pkg.name);
  }
}
for (const name of skipList) skipped.add(name);

let targets = order.filter((name) => !skipped.has(name));
// 被跳过 crate 的依赖者同样无法从 crates.io 解析, 级联剔除。
for (;;) {
  const blocked = targets.filter((name) => normalDepsOf.get(name).some((dep) => skipped.has(dep)));
  if (blocked.length === 0) break;
  for (const name of blocked) {
    console.log(`跳过 ${name}: 依赖未发布的 ${normalDepsOf.get(name).filter((dep) => skipped.has(dep)).join(', ')}`);
    skipped.add(name);
  }
  targets = targets.filter((name) => !skipped.has(name));
}
if (onlyList.length) {
  const only = new Set(onlyList);
  targets = targets.filter((name) => only.has(name));
}
if (from) {
  const position = targets.indexOf(from);
  if (position < 0) fail(`--from ${from} 不在待发布集合中 (先运行一次 dry-run 查看顺序)`);
  targets = targets.slice(position);
}

// --- 预检: 干净工作树 + crates.io 名称/版本占用 ---

if (!allowDirty) {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (status.stdout.trim()) {
    fail('工作树不干净; 先提交或使用 --allow-dirty');
  }
}

console.log(`\nworkspace v${workspaceVersion} — ${targets.length} 个待发布 crate (${execute ? 'EXECUTE 实际上传' : 'dry-run, 不上传'}):\n`);
targets.forEach((name, index) => console.log(`  ${String(index + 1).padStart(3)}. ${name}`));
console.log();

let published = 0;
for (const name of targets) {
  const version = memberByName.get(name).version;
  const existing = await registryGet(`/crates/${name}`);
  if (existing.status === 200) {
    const versionStatus = await registryGet(`/crates/${name}/${version}`);
    if (versionStatus.status === 200) {
      console.log(`= ${name}@${version} 已存在于 crates.io, 跳过`);
      continue;
    }
  } else if (existing.status !== 404) {
    fail(`crates.io 查询 ${name} 失败 (HTTP ${existing.status})`);
  }

  // dev-dep 引导: 版本化的内部 dev-dep 未进入索引时, 打包后的清单无法解析,
  // 编译验证必然失败 — 该 crate 跳过验证发布, 待其 dev-dep 发布后由下游正常验证。
  const missingDevDeps = execute
    ? (await Promise.all(devDepsOf.get(name).map(async (dep) => {
        const status = (await registryGet(`/crates/${dep}/${memberByName.get(dep).version}`)).status;
        return status === 200 ? null : dep;
      }))).filter(Boolean)
    : [];
  if (missingDevDeps.length) {
    console.log(`  警告: 内部 dev-dep 未发布 (${missingDevDeps.join(', ')}), 本次跳过编译验证 (--no-verify)`);
  }
  // dry-run 用 cargo package --list: `cargo publish --dry-run` 会从 crates.io
  // 索引解析依赖, 首次发布前必然失败; --list 校验清单/文件集且不触网解析。
  // 完整编译验证发生在 --execute 逐包发布时 (依赖随序进入索引)。
  const cargoArgs = execute
    ? ['publish', '--manifest-path', manifestPath, '-p', name]
    : ['package', '--no-verify', '--list', '--manifest-path', manifestPath, '-p', name];
  if (execute && missingDevDeps.length) cargoArgs.push('--no-verify');
  if (allowDirty) cargoArgs.push('--allow-dirty');
  console.log(`${execute ? '→' : '·'} ${name}@${version} ...`);
  const result = spawnSync('cargo', cargoArgs, { stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`cargo publish ${name} 失败 (exit ${result.status})`);
  }
  if (!execute) {
    published += 1;
    continue;
  }

  // 等待索引传播, 否则下游 crate 的发布解析不到该依赖。
  const deadline = Date.now() + INDEX_POLL_TIMEOUT_MS;
  for (;;) {
    const check = await registryGet(`/crates/${name}/${version}`);
    if (check.status === 200) break;
    if (Date.now() > deadline) fail(`等待 ${name}@${version} 进入 crates.io 索引超时`);
    await sleep(INDEX_POLL_INTERVAL_MS);
  }
  console.log(`  ${name}@${version} 已进入索引`);
  published += 1;
  await sleep(INTER_PUBLISH_PAUSE_MS);
}

console.log(`\n完成: ${published} 个 crate ${execute ? '已发布' : '通过 dry-run'}。`);
if (!execute) console.log('这是 dry-run; 加 --execute 实际发布。');
