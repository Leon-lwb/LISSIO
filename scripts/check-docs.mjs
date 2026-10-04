#!/usr/bin/env node
/**
 * check-docs.mjs — 开源 / 知识产权 / 文档集门禁
 *
 * 规则 (docs/governance/open-source-and-ip.md、documentation-standards.md、document-review.md):
 *   1. LICENSE 必须是未改动的 GPL-2.0 官方文本 (逐字节 sha256), 许可声明只能写在 NOTICE;
 *   2. 许可证字段全仓唯一: package.json 与每个 workspace 成员 crate 都是 GPL-2.0-only
 *      (SPDX 无 "OR 商业许可" 表达, 商业轨由 CLA 授予的再许可权承担, 见 CLA.md);
 *   3. deny.toml 的 [licenses] allow 只能取脚本内 KNOWN_COMPATIBLE 白名单, 且必须含
 *      GPL-2.0-only — 放行新许可证等于修改常量, 天然落进人工评审;
 *   4. 根目录治理文件齐备, NOTICE 含版权行 / 双许可声明 / 第三方归属 / 源码获取四要素;
 *   5. docs 目录下全部 .md 登记在 docs/README.md 索引里, 无游离文档;
 *   6. 治理文档与评审记录带合法元数据块, 评审记录命名与字段完整;
 *   7. 受检 .md 的相对链接全部可达, 全文无过程痕迹标记 (Stage N / Task #N / Phase N 等)。
 *
 * 用法:
 *   pnpm check:docs                    # 常规门禁
 *   pnpm check:docs -- --stale-days 180  # 额外要求治理文档在 N 天内评审过
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriRoot = join(repoRoot, 'src-tauri');
const errors = [];

/** GPL-2.0 官方文本指纹 — LICENSE 只能整份复制, 任何改动都需重新评审 */
const GPL_2_SHA256 = '8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643';
const PROJECT_LICENSE = 'GPL-2.0-only';

/**
 * 与 GPL-2.0-only 兼容、且不引入额外分发义务的 SPDX 标识。
 * 出现列表外的标识必须先在本文档与 third-party-licenses.md 中记录理由。
 */
const KNOWN_COMPATIBLE = new Set([
  '0BSD', 'Apache-2.0', 'Apache-2.0 WITH LLVM-exception', 'BSD-2-Clause', 'BSD-3-Clause',
  'CC0-1.0', 'CDLA-Permissive-2.0', 'ISC', 'MIT', 'MIT-0', 'MPL-2.0', 'Unicode-3.0',
  'Unlicense', 'Zlib', 'GPL-2.0-only',
]);

const ROOT_FILES = [
  'LICENSE', 'NOTICE', 'CONTRIBUTING.md', 'CLA.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md',
  'GOVERNANCE.md', 'MAINTAINERS.md', 'ROADMAP.md',
];
const INDEX_FILES = ['README.md', 'README.zh-CN.md', 'AGENTS.md', 'CHANGELOG.md'];
const CHECKLIST_SECTIONS = ['事实一致性', '许可证与知识产权', '结构与格式', '可维护性', '门禁与记录'];
const TRACE_MARKERS = /\b(?:Stage \d+|Task #\d+|Phase \d+|迭代\s*\d+|TODO:?\s*待后续阶段)/i;

let staleDays = 0;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--stale-days') staleDays = Number(argv[i + 1] ?? 0);
}

function fail(message) { errors.push(message); }

function readText(path) { return readFileSync(path, 'utf8'); }

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'output', 'test-results']);

function walk(dir, filter, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

function daysBetween(from, to) {
  return Math.round((to.getTime() - Date.parse(from)) / 86_400_000);
}

// ── 1. LICENSE 原文完整性 ─────────────────────────────────────
const licensePath = join(repoRoot, 'LICENSE');
if (!existsSync(licensePath)) {
  fail('LICENSE 缺失 — 双许可项目的开源轨必须保留 GPL-2.0 全文');
} else {
  const digest = createHash('sha256').update(readFileSync(licensePath)).digest('hex');
  if (digest !== GPL_2_SHA256) {
    fail(`LICENSE 不是 GPL-2.0 官方原文 (sha256 ${digest.slice(0, 12)}…) — 许可原文不可修改, 改用 NOTICE 承载项目声明`);
  }
}

// ── 2. 许可证字段唯一 ─────────────────────────────────────────
const pkg = JSON.parse(readText(join(repoRoot, 'package.json')));
if (pkg.license !== PROJECT_LICENSE) fail(`package.json license 应为 ${PROJECT_LICENSE}, 实际 ${pkg.license}`);

let members = [];
try {
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(tauriRoot, 'Cargo.toml'),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  members = metadata.packages.filter((p) => new Set(metadata.workspace_members).has(p.id));
} catch {
  fail('cargo metadata 失败 — 无法校验 workspace 成员许可证字段 (CI 需安装 Rust 工具链)');
}
for (const member of members) {
  if (member.license !== PROJECT_LICENSE) {
    fail(`${member.name}: license 应为 ${PROJECT_LICENSE}, 实际 ${member.license ?? '<缺失>'}`);
  }
}

// ── 3. deny.toml 许可证白名单 ─────────────────────────────────
const denyPath = join(tauriRoot, 'deny.toml');
if (!existsSync(denyPath)) {
  fail('src-tauri/deny.toml 缺失 — 第三方许可证放行策略无单一来源');
} else {
  const deny = readText(denyPath);
  const lines = deny.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\[licenses\]\s*$/.test(line));
  const section = start < 0 ? '' : lines.slice(start + 1, lines.findIndex((line, i) => i > start && /^\[/.test(line)) < 0 ? undefined : lines.findIndex((line, i) => i > start && /^\[/.test(line))).join('\n');
  const allowed = [...section.matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]);
  if (!allowed.includes(PROJECT_LICENSE)) fail(`deny.toml [licenses] allow 未放行 ${PROJECT_LICENSE} (本仓自身即为该许可)`);
  for (const id of allowed) {
    if (!KNOWN_COMPATIBLE.has(id)) fail(`deny.toml [licenses] allow 含未经评审的许可证 "${id}" — 先在 third-party-licenses.md 记录理由再改 KNOWN_COMPATIBLE`);
  }
}

// ── 4. 根目录治理文件与 NOTICE 四要素 ──────────────────────────
for (const name of ROOT_FILES) {
  if (!existsSync(join(repoRoot, name))) fail(`缺少 ${name} — 见 docs/governance/open-source-and-ip.md「治理文件」`);
}
const noticePath = join(repoRoot, 'NOTICE');
if (existsSync(noticePath)) {
  const notice = readText(noticePath);
  const required = [
    ['版权行', /Copyright \(C\)/],
    ['开源轨许可标识', /GPL[- ]?2\.0[- ]only/],
    ['双许可声明', /双许可|dual licen/i],
    ['商业许可状态', /商业许可/],
    ['第三方归属指引', /第三方/],
    ['源码获取方式', /源码|源代码|source code/i],
  ];
  for (const [label, pattern] of required) {
    if (!pattern.test(notice)) fail(`NOTICE 缺少「${label}」段落`);
  }
}

// ── 5-7. 文档索引、元数据、评审记录 ─────────────────────────────
const docsDir = join(repoRoot, 'docs');
const docsFiles = existsSync(docsDir) ? walk(docsDir, (name) => name.endsWith('.md')) : [];
const indexPath = join(docsDir, 'README.md');
const indexText = existsSync(indexPath) ? readText(indexPath) : '';
if (!existsSync(indexPath)) {
  fail('docs/README.md 缺失 — 文档集必须有索引, 新增文档要在此登记');
}
const reviewDir = join(docsDir, 'reviews');
const recordsDir = join(reviewDir, 'records');
const reviewIndex = existsSync(join(reviewDir, 'README.md')) ? readText(join(reviewDir, 'README.md')) : '';
const inRecords = (file) => file.startsWith(`${recordsDir}/`);
for (const file of docsFiles) {
  if (file === indexPath) continue;
  // 评审记录由 docs/reviews/README.md 的索引表登记, 其余文档由 docs/README.md 登记
  const base = inRecords(file) ? recordsDir : docsDir;
  const haystack = inRecords(file) ? reviewIndex : indexText;
  const target = relative(base, file).split(/[\\/]/).join('/');
  if (!haystack.includes(target)) {
    fail(`${relative(repoRoot, file)} 未登记在 ${inRecords(file) ? 'docs/reviews/README.md' : 'docs/README.md'} 索引 — 新增文档必须入索引`);
  }
}

/** 解析 <!-- lissio-doc key: value ... --> 元数据块 */
function parseMeta(text, key) {
  const block = text.match(new RegExp(`<!--\\s*lissio-${key}\\b([\\s\\S]*?)-->`));
  if (!block) return null;
  const meta = new Map();
  for (const line of block[1].split(/\r?\n/)) {
    const pair = line.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/);
    if (pair) meta.set(pair[1], pair[2]);
  }
  return meta;
}

const DOC_META_KEYS = ['status', 'owner', 'last-reviewed', 'applies-to'];
const STATUSES = new Set(['maintained', 'draft', 'deprecated']);
const now = new Date();

function checkDocMeta(file) {
  const rel = relative(repoRoot, file).split(/[\\/]/).join('/');
  const meta = parseMeta(readText(file), 'doc');
  if (!meta) { fail(`${rel} 缺少 <!-- lissio-doc --> 元数据块`); return; }
  for (const key of DOC_META_KEYS) {
    if (!meta.get(key)?.trim()) fail(`${rel}: 元数据缺少 ${key}`);
  }
  const status = meta.get('status');
  if (status && !STATUSES.has(status)) fail(`${rel}: status "${status}" 非法 (${[...STATUSES].join(' / ')})`);
  const reviewed = meta.get('last-reviewed');
  if (reviewed && !/^\d{4}-\d{2}-\d{2}$/.test(reviewed)) {
    fail(`${rel}: last-reviewed 必须是 YYYY-MM-DD, 实际 "${reviewed}"`);
  } else if (reviewed && Number.isNaN(Date.parse(reviewed))) {
    fail(`${rel}: last-reviewed "${reviewed}" 不是合法日期`);
  } else if (reviewed && staleDays > 0 && daysBetween(reviewed, now) > staleDays) {
    fail(`${rel}: 已 ${daysBetween(reviewed, now)} 天未评审 (阈值 ${staleDays} 天) — 见 docs/reviews/checklist.md`);
  }
}

const reviewFiles = docsFiles.filter((f) => f.startsWith(`${recordsDir}/`));
const metaScoped = docsFiles.filter((f) => /docs[\\/](governance|reviews)[\\/]/.test(f) && !reviewFiles.includes(f));
for (const file of metaScoped) checkDocMeta(file);

const REVIEW_KEYS = ['date', 'scope', 'reviewer', 'verdict'];
const VERDICTS = new Set(['通过', '有条件通过', '不通过']);
if (!existsSync(recordsDir) || readdirSync(recordsDir).filter((n) => n.endsWith('.md')).length === 0) {
  fail('docs/reviews/records/ 为空 — 每次文档审查都要留记录 (格式见 docs/reviews/README.md)');
}
for (const file of reviewFiles) {
  const rel = relative(repoRoot, file).split(/[\\/]/).join('/');
  if (!/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(rel.split('/').pop() ?? '')) {
    fail(`${rel} 命名不符 — 评审记录用 YYYY-MM-DD-<范围>.md`);
  }
  const meta = parseMeta(readText(file), 'review');
  if (!meta) { fail(`${rel} 缺少 <!-- lissio-review --> 元数据块`); continue; }
  for (const key of REVIEW_KEYS) {
    if (!meta.get(key)?.trim()) fail(`${rel}: 元数据缺少 ${key}`);
  }
  const verdict = meta.get('verdict');
  if (verdict && !VERDICTS.has(verdict)) fail(`${rel}: verdict "${verdict}" 非法 (${[...VERDICTS].join(' / ')})`);
}

const checklistPath = join(docsDir, 'reviews', 'checklist.md');
if (!existsSync(checklistPath)) {
  fail('docs/reviews/checklist.md 缺失 — 人工评审清单是文档审查的必需产物');
} else {
  const checklist = readText(checklistPath);
  for (const section of CHECKLIST_SECTIONS) {
    if (!checklist.includes(section)) fail(`docs/reviews/checklist.md 缺少「${section}」分节`);
  }
}

// ── 8. 受检文档的相对链接与过程痕迹 ────────────────────────────
const linkScope = [
  ...docsFiles,
  ...ROOT_FILES.map((name) => join(repoRoot, name)),
  ...INDEX_FILES.map((name) => join(repoRoot, name)),
].filter((file) => file.endsWith('.md') && existsSync(file));
const seen = new Set();
for (const file of linkScope) {
  if (seen.has(file)) continue;
  seen.add(file);
  const text = readText(file);
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1];
    if (/^(?:[a-z]+:|#)/i.test(href)) continue;
    const target = resolve(dirname(file), href.split('#')[0]);
    if (!existsSync(target)) {
      fail(`${relative(repoRoot, file)}: 相对链接失效 → ${href}`);
    }
  }
  const trace = text.match(TRACE_MARKERS);
  if (trace) fail(`${relative(repoRoot, file)}: 含过程痕迹标记 "${trace[0]}" — 文档描述现状, 不写重构历史`);
}

if (errors.length > 0) {
  console.error(`✗ 文档与许可证门禁失败 (${errors.length} 处):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\n规则见 docs/governance/open-source-and-ip.md 与 docs/reviews/checklist.md');
  process.exit(1);
}

console.log(`✓ 文档与许可证门禁通过 — ${members.length} 个 workspace 包许可证一致, ${docsFiles.length} 篇文档已登记并可链接, ${reviewFiles.length} 份评审记录合规`);
