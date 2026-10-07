#!/usr/bin/env node
/**
 * publish-release.mjs — 把本地构建产物发布到 Codeberg, 并更新更新器清单。
 *
 * 为什么是脚本而不是 workflow 内的 curl:
 *   桌面安装包无法在单个 Linux runner 上跨平台构建, 因此打包留在本地
 *   (`pnpm auto-build`)。发布步骤与打包跑在同一台机器上, 复用同一份逻辑,
 *   workflow 只需要调用本脚本, 不必把发布细节再抄一遍 YAML。
 *
 * 用法:
 *   pnpm publish:release --version 0.8.0                 # 正式版 → stable 通道
 *   pnpm publish:release --version 0.8.0-beta.1          # 预发布 → beta 通道
 *   pnpm publish:release --version 0.8.0 --dry-run       # 只打印将做的事
 *   pnpm publish:release --version 0.8.0 --assets output/build/artifacts-macos-arm64
 *
 * 需要环境变量 RELEASE_TOKEN: Codeberg token, 需仓库写权限。
 * 不要把 token 写进仓库; CI 从 secrets 注入。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API_ROOT = 'https://codeberg.org/api/v1/repos/Horldsence/Lissio';
/** 资产下载基址。Codeberg 不实现 GitHub 的 releases/latest/download 伪路径。 */
const DOWNLOAD_ROOT = 'https://codeberg.org/Horldsence/Lissio/releases/download';
const repoRoot = join(import.meta.dirname, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag('--help') || flag('-h')) {
  console.log(
    [
      '用法: pnpm publish:release --version <vX.Y.Z> [选项]',
      '',
      '  --version <v>    必填。要发布的版本, 例如 0.8.0 或 0.8.0-beta.1',
      '  --assets <dir>   产物目录, 可重复。默认自动查找 output/build/artifacts-*/',
      '  --draft          建为草稿 (不公开, 且不更新更新器通道)',
      '  --dry-run        只打印将要执行的操作',
      '  --skip-checksums 不生成 SHA256SUMS',
      '',
      '环境变量: RELEASE_TOKEN (Codeberg token, 需仓库写权限)',
    ].join('\n'),
  );
  process.exit(0);
}

const version = valueOf('--version');
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('错误: 需要 --version <semver>, 例如 --version 0.8.0 或 0.8.0-beta.1');
  process.exit(1);
}

const dryRun = flag('--dry-run');
const isDraft = flag('--draft');
const token = process.env.RELEASE_TOKEN;
if (!token && !dryRun) {
  console.error('错误: 未设置 RELEASE_TOKEN (Codeberg token, 需仓库写权限)。');
  console.error('      可先用 --dry-run 预览将要执行的操作。');
  process.exit(1);
}

// 预发布判定: 版本号带连字符即视为预发布, 与 Tauri 的通道语义一致。
const isPrerelease = version.includes('-');
const TAG = `v${version}`;
/** 滚动通道 tag 与清单文件名; 客户端读取的是固定 URL, 不随版本变化。 */
const CHANNEL_TAG = isPrerelease ? 'beta' : 'stable';
const CHANNEL_ASSET = isPrerelease ? 'beta-latest.json' : 'latest.json';

// ── 收集产物 ─────────────────────────────────────────────────
const explicitDirs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--assets' && args[i + 1]) explicitDirs.push(args[i + 1]);
}

function defaultAssetDirs() {
  const base = join(repoRoot, 'output', 'build');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => name.startsWith('artifacts-'))
    .map((name) => join(base, name))
    .filter((dir) => statSync(dir).isDirectory());
}

const assetDirs = explicitDirs.length > 0 ? explicitDirs : defaultAssetDirs();
if (assetDirs.length === 0) {
  console.error('错误: 没有找到产物目录。先运行 `pnpm auto-build`, 或用 --assets 指定目录。');
  process.exit(1);
}

/** 文件名 → 绝对路径; 同名文件来自多个 target 目录时保留第一个。 */
const assets = new Map();
for (const dir of assetDirs) {
  if (!existsSync(dir)) {
    console.error(`错误: 产物目录不存在: ${dir}`);
    process.exit(1);
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    if (!assets.has(entry)) assets.set(entry, full);
  }
}

if (assets.size === 0) {
  console.error(`错误: 产物目录里没有文件: ${assetDirs.join(', ')}`);
  process.exit(1);
}

// ── 生成校验和 ───────────────────────────────────────────────
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

if (!flag('--skip-checksums')) {
  const lines = [...assets.entries()]
    .map(([name, path]) => [name, path])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, path]) => `${sha256(path)}  ${name}`);
  const sumsPath = join(assetDirs[0], 'SHA256SUMS');
  writeFileSync(sumsPath, `${lines.join('\n')}\n`);
  assets.set('SHA256SUMS', sumsPath);
  console.log(`生成 SHA256SUMS (${lines.length} 项)`);
}

// ── 生成更新器清单 ───────────────────────────────────────────
function updaterPlatformKey(name) {
  if (name.endsWith('.app.tar.gz')) {
    if (name.includes('aarch64')) return 'darwin-aarch64';
    if (name.includes('x64')) return 'darwin-x86_64';
    return 'darwin-aarch64';
  }
  if (name.endsWith('.AppImage')) return 'linux-x86_64';
  if (name.endsWith('.nsis.zip')) return 'windows-x86_64';
  if (name.endsWith('-setup.exe')) return 'windows-x86_64';
  return null;
}

const platforms = {};
const skipped = [];
for (const [name] of assets) {
  const key = updaterPlatformKey(name);
  if (!key || platforms[key]) continue;
  const sigName = `${name}.sig`;
  if (!assets.has(sigName)) {
    skipped.push(`${name} (缺 .sig 签名)`);
    continue;
  }
  const signature = readFileSync(assets.get(sigName), 'utf8').trim();
  // 指向不可变的版本 tag, 而不是滚动通道 tag: 安装包随版本固化 (校验和与来源
  // 可追溯), 只有清单本身滚动。若指向通道 tag, 这些 URL 会 404, 因为安装包
  // 只上传到 vX.Y.Z。
  platforms[key] = { signature, url: `${DOWNLOAD_ROOT}/${TAG}/${name}` };
}

let manifestPath = null;
if (Object.keys(platforms).length > 0) {
  manifestPath = join(assetDirs[0], CHANNEL_ASSET);
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version,
        notes: `v${version}`,
        pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        platforms,
      },
      null,
      2,
    )}\n`,
  );
  assets.set(CHANNEL_ASSET, manifestPath);
} else {
  // 没有签名就不发布清单: 客户端会因为缺少签名而拒绝, 反而制造"更新失败"的假象。
  console.warn('警告: 没有可用的签名产物, 跳过更新器清单 (自动更新保持不可用)。');
}
if (skipped.length > 0) {
  console.warn(`警告: 以下产物缺少 .sig 签名, 未进入更新器清单:\n  ${skipped.join('\n  ')}`);
}

// ── 汇总 ─────────────────────────────────────────────────────
console.log('');
console.log(`版本:      ${version}${isPrerelease ? ' (预发布)' : ''}`);
console.log(`tag:       ${TAG}`);
console.log(`通道:      ${CHANNEL_TAG} → ${CHANNEL_ASSET}${manifestPath ? '' : ' (本次跳过)'}`);
console.log(`产物目录:  ${assetDirs.join(', ')}`);
console.log(`待上传:    ${assets.size} 个文件`);
for (const [name] of assets) console.log(`  ${name}`);
if (dryRun) {
  console.log('');
  console.log('--dry-run: 未上传任何内容。');
  process.exit(0);
}

// ── Forgejo API ──────────────────────────────────────────────
async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} → ${response.status} ${text.slice(0, 300)}`);
  }
  return body;
}

/** 找到 tag 对应的 release, 没有则创建; 已存在则复用, 保证重跑幂等。 */
async function ensureRelease(tag, { prerelease, draft, body }) {
  try {
    const existing = await api(`/releases/tags/${encodeURIComponent(tag)}`);
    console.log(`release ${tag} 已存在 (id=${existing.id}), 复用`);
    return existing;
  } catch (error) {
    if (!/→ 404/.test(String(error.message))) throw error;
  }
  const created = await api('/releases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: tag, body, prerelease, draft }),
  });
  console.log(`创建 release ${tag} (id=${created.id})`);
  return created;
}

async function uploadAsset(releaseId, tag, name, path) {
  // 同名资产必须先删除, 否则重复发布会 409。
  const release = await api(`/releases/tags/${encodeURIComponent(tag)}`);
  const existing = (release.assets ?? []).find((asset) => asset.name === name);
  if (existing) {
    await api(`/releases/assets/${existing.id}`, { method: 'DELETE' });
    console.log(`  替换同名资产 ${name}`);
  }
  const form = new FormData();
  form.append('attachment', new Blob([readFileSync(path)]), name);
  await api(`/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: form,
  });
  console.log(`  上传 ${name}`);
}

const releaseBody = [
  `## v${version}`,
  '',
  'See CHANGELOG.md for the full history.',
  '',
  'Verify the download with `SHA256SUMS`.',
].join('\n');

const release = await ensureRelease(TAG, {
  prerelease: isPrerelease,
  draft: isDraft,
  body: releaseBody,
});

for (const [name, path] of assets) {
  if (name === CHANNEL_ASSET) continue; // 清单属于滚动 tag, 单独处理
  await uploadAsset(release.id, TAG, name, path);
}

// 滚动通道最后更新: 清单指向的资产必须已经存在, 否则客户端会拿到 404 链接。
if (manifestPath) {
  if (isDraft) {
    console.log('草稿 release: 不更新滚动通道 (避免草稿提前通知已安装客户端)。');
  } else {
    const rolling = await ensureRelease(CHANNEL_TAG, {
      prerelease: true,
      draft: false,
      body: '滚动更新通道清单, 由 CI/发布脚本维护。请勿删除。',
    });
    await uploadAsset(rolling.id, CHANNEL_TAG, CHANNEL_ASSET, manifestPath);
    console.log('');
    console.log(`通道已更新: ${DOWNLOAD_ROOT}/${CHANNEL_TAG}/${CHANNEL_ASSET}`);
  }
}

console.log('');
console.log(`发布完成: ${API_ROOT.replace('/api/v1/repos', '')}/releases/tag/${TAG}`);
