#!/usr/bin/env node
/**
 * changelog-normalize.mjs — restore covector-generated CHANGELOG entries to the format the repository declares.
 *
 * Background: `covector version` inserts new entries after `# Changelog`, pushing the
 * `<!-- lissio-doc -->` metadata block and the Keep a Changelog preamble into the middle of
 * the file, and headings carry no date. This script pulls it back:
 *
 *   1. move the metadata block + preamble paragraph back directly below the H1;
 *   2. add ` - YYYY-MM-DD` to the newest entry;
 *   3. strip machine prefixes such as `[`sha`](...)` / `([#12](...) by [@u](...))` from entries.
 *
 * Idempotent: it writes no file when the format already matches. It is invoked by the
 * `.changes/config.json` postversion hook, and can also run standalone to fix structural
 * drift caused by hand edits.
 *
 * Usage:
 *   node scripts/changelog-normalize.mjs [--version <semver>] [--date YYYY-MM-DD] [--dry-run]
 *
 * When --version is omitted it reads package.json (the version source of truth). The
 * postversion hook runs after the version is written, so the default behavior is correct.
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

// ── Split out the H1 ────────────────────────────────────────────────────────────────
const h1 = original.match(/^#\s+.*$/m);
if (!h1) {
  console.error('CHANGELOG.md: H1 heading not found');
  process.exit(1);
}
const heading = h1[0];
let body = original.slice(h1.index + heading.length);

// ── Locate and extract the front matter + preamble ─────────────────────────────────────────────
const meta = body.match(metaRe);
let frontMatter = '';
if (meta) {
  const afterMeta = body.slice(meta.index + meta[0].length);
  const nextSection = afterMeta.search(/^## \[/m);
  const preamble = (nextSection === -1 ? afterMeta : afterMeta.slice(0, nextSection)).trim();
  frontMatter = preamble ? `${meta[0]}\n\n${preamble}` : meta[0];
  body = body.slice(0, meta.index) + (nextSection === -1 ? '' : afterMeta.slice(nextSection));
}

// ── Normalize entries ─────────────────────────────────────────────────────────────
body = body.replace(/^\s+/, '');
const split = body.slice(1).search(/^## \[/m);
const firstEnd = split === -1 ? body.length : split + 1;
const before = body;
let first = body.slice(0, firstEnd);
let history = body.slice(firstEnd);

// Machine prefixes in every entry are covector artifacts (hand-written history has no such
// form), so strip them globally; the date is added only to the newest entry and never
// rewrites the release date of a historical entry.
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
  console.log(`CHANGELOG.md: already in the target format (v${version}, ${date}), unchanged.`);
  process.exit(0);
}

const changed = [];
if (frontMatter) changed.push('  front matter hoisted to the top');
if (before !== `${first.trimEnd()}\n\n${history.trimStart()}`) changed.push('  entries reformatted');
if (dryRun) {
  console.log(`[dry-run] CHANGELOG.md would be updated (v${version}, ${date}):`);
  console.log(changed.join('\n') || '  (whitespace only)');
  process.exit(0);
}
writeFileSync(changelogPath, next);
console.log(`CHANGELOG.md: normalized to v${version} (${date})`);
