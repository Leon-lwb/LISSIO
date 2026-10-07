#!/usr/bin/env node
/**
 * verify-release.mjs — 发布后校验: 确认 release、资产、以及更新器清单真的可用。
 *
 * 为什么需要它: 自动更新曾经整整一年不可用, 因为清单地址指向一个 404 的仓库,
 * 而没有任何检查真正去 GET 过那个 URL。静态字符串测试只能证明"地址没改错",
 * 证明不了"地址能取到东西"。本脚本发出真实请求。
 *
 * 用法:
 *   pnpm release:verify --version 0.8.0
 *   pnpm release:verify --version 0.8.0-beta.1
 *   pnpm release:verify --version 0.8.0 --json
 *
 * 退出码 1 表示有问题; 输出中每一项都会说明具体原因与复现 URL。
 */

const REPO = 'Horldsence/Lissio';
const API_ROOT = `https://codeberg.org/api/v1/repos/${REPO}`;
const DOWNLOAD_ROOT = `https://codeberg.org/${REPO}/releases/download`;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const versionIndex = args.indexOf('--version');
const version = versionIndex >= 0 ? args[versionIndex + 1] : null;

if (args.includes('--help') || args.includes('-h') || !version) {
  console.log(
    [
      '用法: pnpm release:verify --version <vX.Y.Z> [--json]',
      '',
      `  --version <v>  要校验的已发布版本, 例如 0.8.0 或 0.8.0-beta.1`,
      '  --json         以 JSON 输出结果',
      '',
      '校验内容: release 是否存在、必需资产是否齐全、更新器清单是否可取且',
      '其中每个平台 URL 都返回 200。',
    ].join('\n'),
  );
  process.exit(version ? 0 : 1);
}

const tagOverride = args.indexOf('--tag') >= 0 ? args[args.indexOf('--tag') + 1] : null;
/** 版本 → 候选 tag。历史上存在无前缀 tag (如 `0.7.2-beta`), 新发布统一用 `vX.Y.Z`。 */
const candidateTags = tagOverride ? [tagOverride] : [`v${version}`, version];
const isPrerelease = version.includes('-');
const channelTag = isPrerelease ? 'beta' : 'stable';
const channelAsset = isPrerelease ? 'beta-latest.json' : 'latest.json';

const results = [];
const record = (ok, label, detail) => results.push({ ok, label, detail });

async function head(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return response.status;
  } catch (error) {
    return `ERR ${error.message}`;
  }
}

async function getJson(url) {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return { error: `${response.status} ${response.statusText}` };
    return { body: await response.json() };
  } catch (error) {
    return { error: error.message };
  }
}

// ── 1. release 是否存在 (兼容历史上的无前缀 tag) ─────────────
let tag = candidateTags[0];
let release = { error: 'not attempted' };
for (const candidate of candidateTags) {
  const found = await getJson(`${API_ROOT}/releases/tags/${encodeURIComponent(candidate)}`);
  if (!found.error) {
    tag = candidate;
    release = found;
    break;
  }
  release = found;
}
if (release.error) {
  record(
    false,
    `release ${candidateTags[0]} 存在`,
    `GET ${API_ROOT}/releases/tags/${candidateTags[0]} → ${release.error}`,
  );
} else {
  record(true, `release ${tag} 存在`, `${release.body.assets?.length ?? 0} 个资产`);
}

// ── 2. 必需资产是否齐全 ──────────────────────────────────────
const assetNames = new Set((release.body?.assets ?? []).map((asset) => asset.name));
if (!release.error) {
  if (!assetNames.has('SHA256SUMS')) {
    record(false, 'SHA256SUMS 已上传', `缺少校验和文件; 复现: ${DOWNLOAD_ROOT}/${tag}/SHA256SUMS`);
  } else {
    record(true, 'SHA256SUMS 已上传', `${DOWNLOAD_ROOT}/${tag}/SHA256SUMS`);
  }

  // 至少要有一种安装包, 否则这个 release 对用户没有意义。
  const installers = [...assetNames].filter((name) =>
    /\.(dmg|msi|exe|deb|AppImage)$/.test(name),
  );
  record(
    installers.length > 0,
    '至少一个安装包',
    installers.length > 0 ? installers.join(', ') : '没有找到任何安装包资产',
  );

  // 签名产物是自动更新的前提。
  const sigs = [...assetNames].filter((name) => name.endsWith('.sig'));
  record(
    sigs.length > 0,
    '存在 updater 签名 (.sig)',
    sigs.length > 0
      ? `${sigs.length} 个: ${sigs.join(', ')}`
      : '没有 .sig: 自动更新无法工作 (需 TAURI_SIGNING_PRIVATE_KEY, 且 bundle.createUpdaterArtifacts 必须为 true)',
  );
}

// ── 3. 滚动通道清单可取 ──────────────────────────────────────
const manifestUrl = `${DOWNLOAD_ROOT}/${channelTag}/${channelAsset}`;
const manifest = await getJson(manifestUrl);
let manifestBody = null;
if (manifest.error) {
  record(false, `通道清单可取 (${channelTag})`, `GET ${manifestUrl} → ${manifest.error}`);
} else {
  manifestBody = manifest.body;
  record(true, `通道清单可取 (${channelTag})`, manifestUrl);
}

// ── 4. 清单内容与每个平台 URL ────────────────────────────────
if (manifestBody) {
  const manifestVersion = manifestBody.version;
  record(
    manifestVersion === version,
    '清单版本与预期一致',
    `清单 ${manifestVersion} vs 预期 ${version}`,
  );

  const platforms = Object.entries(manifestBody.platforms ?? {});
  if (platforms.length === 0) {
    record(false, '清单含平台条目', 'platforms 为空: 客户端拿不到任何更新');
  }
  for (const [platform, entry] of platforms) {
    if (!entry?.url || !entry?.signature) {
      record(false, `平台 ${platform} 字段完整`, '缺少 url 或 signature');
      continue;
    }
    const status = await head(entry.url);
    record(status === 200, `平台 ${platform} 的 URL 可下载`, `${status} ${entry.url}`);
  }
}

// ── 输出 ─────────────────────────────────────────────────────
const failed = results.filter((result) => !result.ok);

if (asJson) {
  console.log(JSON.stringify({ version, tag, channelTag, results, ok: failed.length === 0 }, null, 2));
} else {
  console.log(`校验已发布版本 v${version} (通道 ${channelTag})`);
  console.log('');
  for (const result of results) {
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.label}`);
    if (result.detail) console.log(`      ${result.detail}`);
  }
  console.log('');
  if (failed.length === 0) {
    console.log(`✓ v${version} 校验通过 — 下载与自动更新链路可用`);
  } else {
    console.log(`✗ v${version} 有 ${failed.length} 项未通过`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
