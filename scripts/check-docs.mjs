#!/usr/bin/env node
/**
 * check-docs.mjs — licensing, governance, indexing, translation, and link gate.
 *
 * Policy sources:
 * - docs/governance/open-source-and-ip.md
 * - docs/governance/documentation-standards.md
 * - docs/governance/document-review.md
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriRoot = join(repoRoot, 'src-tauri');
const docsDir = join(repoRoot, 'docs');
const communityDir = join(docsDir, 'community');
const recordsDir = join(docsDir, 'reviews', 'records');
const errors = [];

const APACHE_2_SHA256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';
const PROJECT_LICENSE = 'Apache-2.0';
const KNOWN_COMPATIBLE = new Set([
  '0BSD', 'Apache-2.0', 'Apache-2.0 WITH LLVM-exception', 'BSD-2-Clause', 'BSD-3-Clause',
  'CC0-1.0', 'CDLA-Permissive-2.0', 'ISC', 'MIT', 'MIT-0', 'MPL-2.0', 'Unicode-3.0',
  'Unlicense', 'Zlib',
]);

const ROOT_FILES = [
  'LICENSE', 'NOTICE', 'AUTHORS.md', 'SUPPORT.md', 'MAINTAINERS.md', 'RELEASING.md',
  'CONTRIBUTING.md', 'CLA.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', 'GOVERNANCE.md',
  'ROADMAP.md', 'CHANGELOG.md', 'README.md', 'AGENTS.md',
];
const REQUIRED_LINKS = [
  'AUTHORS.md', 'SUPPORT.md', 'MAINTAINERS.md', 'RELEASING.md', 'CITATION.cff',
  '.forgejo/CODEOWNERS',
];
const DOC_META_KEYS = ['status', 'owner', 'last-reviewed', 'applies-to', 'language', 'authoritative'];
const REVIEW_KEYS = ['date', 'scope', 'reviewer', 'verdict'];
const STATUSES = new Set(['maintained', 'draft', 'deprecated']);
const REVIEW_VERDICTS = new Set(['passed', 'passed-with-conditions', 'failed', '通过', '有条件通过', '不通过']);
const TRACE_MARKERS = /\b(?:Stage \d+|Task #\d+|Phase \d+|iteration\s+\d+|迭代\s*\d+|TODO:?\s*待后续阶段)/i;

let staleDays = 0;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--stale-days') staleDays = Number(argv[i + 1] ?? 0);
}

const fail = (message) => errors.push(message);
const readText = (path) => readFileSync(path, 'utf8');
const rel = (path) => relative(repoRoot, path).split(/[\\/]/).join('/');
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'output', 'test-results', '.pnpm-store']);

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(entry.name, full)) out.push(full);
  }
  return out.sort();
}

function parseMeta(text, key) {
  const block = text.match(new RegExp(`<!--\\s*lissio-${key}\\b([\\s\\S]*?)-->`));
  if (!block) return null;
  const meta = new Map();
  for (const line of block[1].split(/\r?\n/)) {
    const pair = line.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/);
    if (pair) meta.set(pair[1], pair[2].trim());
  }
  return meta;
}

function daysBetween(from, to) {
  return Math.round((to.getTime() - Date.parse(from)) / 86_400_000);
}

// 1. Canonical Apache-2.0 license text.
const licensePath = join(repoRoot, 'LICENSE');
if (!existsSync(licensePath)) {
  fail('LICENSE is missing');
} else {
  const digest = createHash('sha256').update(readFileSync(licensePath)).digest('hex');
  if (digest !== APACHE_2_SHA256) {
    fail(`LICENSE is not the canonical Apache-2.0 text (sha256 ${digest.slice(0, 12)}…)`);
  }
}

// 2. SPDX metadata is uniform across JavaScript and Rust packages.
const pkg = JSON.parse(readText(join(repoRoot, 'package.json')));
if (pkg.license !== PROJECT_LICENSE) fail(`package.json license must be ${PROJECT_LICENSE}, found ${pkg.license}`);

let members = [];
try {
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(tauriRoot, 'Cargo.toml'),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  members = metadata.packages.filter((item) => new Set(metadata.workspace_members).has(item.id));
  for (const member of members) {
    if (member.license !== PROJECT_LICENSE) {
      fail(`${member.name}: license must be ${PROJECT_LICENSE}, found ${member.license ?? '<missing>'}`);
    }
  }
} catch {
  fail('cargo metadata failed; workspace license fields could not be verified');
}

// 3. Dependency allow-list remains deliberately narrow.
const denyText = readText(join(tauriRoot, 'deny.toml'));
const allowBlock = denyText.match(/\[licenses\][\s\S]*?allow\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
const allowed = [...allowBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
if (!allowed.includes(PROJECT_LICENSE)) fail(`src-tauri/deny.toml must allow ${PROJECT_LICENSE}`);
for (const id of allowed) {
  if (!KNOWN_COMPATIBLE.has(id)) fail(`src-tauri/deny.toml allows unreviewed license "${id}"`);
}
if (allowed.includes('GPL-2.0-only') || allowed.includes('AGPL-3.0-only') || allowed.includes('SSPL-1.0')) {
  fail('src-tauri/deny.toml must not allow strong copyleft for the Apache-2.0 codebase');
}

// 4. Required root policy and community files.
for (const name of ROOT_FILES) {
  if (!existsSync(join(repoRoot, name))) fail(`missing required root file: ${name}`);
}
for (const name of REQUIRED_LINKS) {
  if (!existsSync(join(repoRoot, name))) fail(`missing community metadata file: ${name}`);
}

const noticePath = join(repoRoot, 'NOTICE');
if (!existsSync(noticePath)) {
  fail('NOTICE is missing');
} else {
  const notice = readText(noticePath);
  for (const [label, pattern] of [
    ['Apache-2.0 notice', /Apache License, Version 2\.0/i],
    ['historical-release scope', /historical|earlier binary releases/i],
    ['third-party attribution', /third-party/i],
    ['canonical source URL', /https:\/\/codeberg\.org\/Horldsence\/Lissio/],
  ]) {
    if (!pattern.test(notice)) fail(`NOTICE is missing ${label}`);
  }
}

const codeowners = join(repoRoot, '.forgejo', 'CODEOWNERS');
if (existsSync(codeowners) && !/@Horldsence/.test(readText(codeowners))) {
  fail('.forgejo/CODEOWNERS must assign ownership to @Horldsence');
}

const citation = join(repoRoot, 'CITATION.cff');
if (existsSync(citation)) {
  const text = readText(citation);
  for (const value of ['Lissio', 'Apache-2.0', 'Horldsence', 'https://codeberg.org/Horldsence/Lissio']) {
    if (!text.includes(value)) fail(`CITATION.cff is missing ${value}`);
  }
} else {
  fail('CITATION.cff is missing');
}

// 5. Document scope and language authority.
const markdown = [
  ...walk(repoRoot, (name, full) => name.endsWith('.md') && !rel(full).includes('/') && !rel(full).startsWith('docs/community/')),
  ...walk(docsDir, (name, full) => name.endsWith('.md') && !rel(full).startsWith('docs/community/')),
  ...walk(join(repoRoot, '.github'), (name) => name.endsWith('.md')),
  ...walk(join(repoRoot, 'packaging'), (name) => name.endsWith('.md')),
  ...walk(join(repoRoot, 'src', 'i18n'), (name) => name.endsWith('.md')),
  ...walk(join(repoRoot, 'src-tauri', 'crates'), (name) => name.endsWith('.md')),
].filter((file, index, all) => all.indexOf(file) === index);

const historical = (file) => {
  const path = rel(file);
  return path.startsWith('docs/reviews/records/') || path.startsWith('docs/releaselog/');
};
const canonicalDocs = markdown.filter((file) => !historical(file));
const docsFiles = walk(docsDir, (name) => name.endsWith('.md'));
const reviewFiles = walk(recordsDir, (name) => name.endsWith('.md'));
const translationFiles = walk(communityDir, (name) => name.endsWith('.md'));

function checkMeta(file, expectedLanguage, authoritative) {
  const path = rel(file);
  const text = readText(file);
  const meta = parseMeta(text, 'doc');
  if (!meta) {
    fail(`${path} is missing <!-- lissio-doc --> metadata`);
    return meta;
  }
  for (const key of DOC_META_KEYS) {
    if (!meta.get(key)) fail(`${path}: metadata is missing ${key}`);
  }
  const status = meta.get('status');
  if (status && !STATUSES.has(status)) fail(`${path}: invalid status "${status}"`);
  const reviewed = meta.get('last-reviewed');
  if (reviewed && !/^\d{4}-\d{2}-\d{2}$/.test(reviewed)) {
    fail(`${path}: last-reviewed must use YYYY-MM-DD`);
  } else if (reviewed && Number.isNaN(Date.parse(reviewed))) {
    fail(`${path}: invalid last-reviewed date`);
  } else if (reviewed && staleDays > 0 && daysBetween(reviewed, new Date()) > staleDays) {
    fail(`${path}: review is older than ${staleDays} days`);
  }
  if (meta.get('language') !== expectedLanguage) fail(`${path}: language must be ${expectedLanguage}`);
  if (meta.get('authoritative') !== String(authoritative)) fail(`${path}: authoritative must be ${authoritative}`);
  return meta;
}

for (const file of canonicalDocs) {
  const runtimeTranslation = rel(file).startsWith('src-tauri/crates/desktop/control-api/src/capabilities/docs/zh/');
  if (runtimeTranslation) {
    const meta = checkMeta(file, 'zh-CN', false);
    const expectedSource = rel(file).replace('/docs/zh/', '/docs/en/');
    if (meta?.get('translation-of') !== expectedSource) {
      fail(`${rel(file)}: translation-of must be ${expectedSource}`);
    }
  } else {
    checkMeta(file, 'en', true);
  }
}
for (const file of translationFiles) {
  const meta = checkMeta(file, 'zh-CN', false);
  const source = meta?.get('translation-of');
  if (!source) {
    fail(`${rel(file)}: metadata is missing translation-of`);
  } else if (!existsSync(resolve(communityDir, source)) && !existsSync(resolve(repoRoot, source))) {
    fail(`${rel(file)}: translation-of target does not exist → ${source}`);
  }
  if (!readText(file).includes('English') || !/authoritative|controls/i.test(readText(file))) {
    fail(`${rel(file)} must state that English is authoritative`);
  }
}

// 6. Review records remain historical and use their own metadata contract.
if (reviewFiles.length === 0) fail('docs/reviews/records/ must not be empty');
for (const file of reviewFiles) {
  const path = rel(file);
  if (!/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(path.split('/').pop() ?? '')) {
    fail(`${path}: review records must use YYYY-MM-DD-<scope>.md`);
  }
  const meta = parseMeta(readText(file), 'review');
  if (!meta) {
    fail(`${path} is missing <!-- lissio-review --> metadata`);
    continue;
  }
  for (const key of REVIEW_KEYS) if (!meta.get(key)) fail(`${path}: review metadata is missing ${key}`);
  const verdict = meta.get('verdict');
  if (verdict && !REVIEW_VERDICTS.has(verdict)) fail(`${path}: invalid verdict "${verdict}"`);
}

// 7. Canonical documents and translations must be indexed.
const docsIndex = existsSync(join(docsDir, 'README.md')) ? readText(join(docsDir, 'README.md')) : '';
for (const file of docsFiles.filter((item) => !rel(item).startsWith('docs/community/') && !historical(item))) {
  const target = relative(docsDir, file).split(/[\\/]/).join('/');
  if (!docsIndex.includes(target)) fail(`${rel(file)} is not indexed in docs/README.md`);
}
const translationIndexFile = join(communityDir, 'INDEX.zh-CN.md');
const translationIndex = existsSync(translationIndexFile) ? readText(translationIndexFile) : '';
if (!translationIndex) fail('docs/community/INDEX.zh-CN.md is missing');
for (const file of translationFiles.filter((item) => rel(item) !== 'docs/community/INDEX.zh-CN.md')) {
  const target = relative(communityDir, file).split(/[\\/]/).join('/');
  if (!translationIndex.includes(target)) fail(`${rel(file)} is not indexed in docs/community/INDEX.zh-CN.md`);
}

// 8. Relative links and forbidden process traces.
const linkScope = [...canonicalDocs, ...reviewFiles, ...translationFiles];
for (const file of linkScope) {
  const text = readText(file);
  let base = dirname(file);
  if (translationFiles.includes(file)) {
    const source = parseMeta(text, 'doc')?.get('translation-of');
    if (source) base = dirname(resolve(repoRoot, source));
  }
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1];
    if (/^(?:[a-z]+:|#)/i.test(href)) continue;
    const source = translationFiles.includes(file)
      ? parseMeta(text, 'doc')?.get('translation-of')
      : null;
    const candidates = [
      resolve(dirname(file), href.split('#')[0]),
      resolve(base, href.split('#')[0]),
      href.startsWith('/') ? resolve(repoRoot, href.slice(1)) : resolve(base, href.split('#')[0]),
    ];
    if (source) candidates.push(resolve(dirname(resolve(repoRoot, source)), href.split('#')[0]));
    if (!candidates.some((target) => existsSync(target))) fail(`${rel(file)}: broken relative link → ${href}`);
  }
  const trace = text.match(TRACE_MARKERS);
  if (trace && !historical(file)) fail(`${rel(file)} contains process marker "${trace[0]}"`);
}

// 9. Current policy text must not claim a dual/commercial license.
const currentTextFiles = [...canonicalDocs].filter((file) => !rel(file).startsWith('docs/reviews/records/'));
for (const file of currentTextFiles) {
  const text = readText(file);
  if (/Dual-licensed:|commercial track has not been published|GPL-2\.0-only is the only available/i.test(text)) {
    fail(`${rel(file)} contains obsolete GPL dual-license language`);
  }
}

if (errors.length > 0) {
  console.error(`Documentation and license gate failed (${errors.length} issues):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error('\nSee docs/governance/open-source-and-ip.md and docs/reviews/checklist.md');
  process.exit(1);
}

console.log(`Documentation and license gate passed — ${members.length} workspace packages use ${PROJECT_LICENSE}, ${canonicalDocs.length} authoritative documents are indexed, and ${translationFiles.length} Chinese backups are mapped.`);
