#!/usr/bin/env node
/**
 * check-crate-size.mjs — 500-line limit for Rust production files.
 *
 * Rule source: `AGENTS.md` "Rust production files are limited to 500 lines; split
 * implementation modules without changing the stable crate API."
 *
 * Exemption scope (matching the job that only lived in `lint.yml` and never ran):
 *   - paths containing a `tests` directory
 *   - `*_tests.rs`
 *   - paths containing a `benches` directory
 * That is, only production source is constrained; tests and benchmarks do not count.
 *
 * Why a standalone script instead of an inline workflow step: this rule used to be a
 * `find | awk` one-liner in `lint.yml`, and after the repository moved to Codeberg it
 * never ran again, so a 514-line `cmd/mod.rs` stayed in violation unnoticed. Now that
 * the rule lives in `scripts/gates.mjs`, check-all / Forgejo / local runs share one
 * command.
 *
 * Usage: pnpm check:rust-size
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot, CWD } from './gates.mjs';

/** Production source scan roots (relative to src-tauri). */
const SCAN_ROOTS = ['crates', 'src'];
/** Per-file line limit. */
const LIMIT = 500;
const SKIP_DIRS = new Set(['target', 'node_modules']);

/** Test/benchmark exemptions: directory-name or file-name markers. */
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
    // Decide exemptions from the path relative to src-tauri, matching the original find expression
    const relToTauri = relative(tauriRoot, file).split(/[\\/]/).join('/');
    if (isExempt(relToTauri)) continue;
    // Exactly matches `wc -l`: count newline characters only. Do not add +1 for a missing
    // trailing newline — the original rule was a one-line `wc -l` and does not add it either.
    // Adding +1 would let a file with 500 newlines and no trailing newline pass under
    // `find|wc -l` but fail here, putting the two out of step.
    const content = readFileSync(file, 'utf8');
    let lines = 0;
    for (const char of content) if (char === '\n') lines += 1;
    scanned += 1;
    if (lines > LIMIT) offenders.push({ path: relToTauri, lines });
  }
}

if (offenders.length > 0) {
  console.error(`✗ Rust production file exceeds the ${LIMIT}-line limit (tests and benchmarks exempt):\n`);
  for (const offender of offenders.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${offender.lines} lines  src-tauri/${offender.path}`);
  }
  console.error('\nSplit the implementation into modules without changing the stable crate public API (see AGENTS.md).');
  process.exit(1);
}

if (scanned === 0) {
  // Scanning no files means a wrong path or a missing directory, not "everything is
  // compliant". Fail loudly rather than print a 0 that looks like a pass.
  console.error('✗ Scanned 0 Rust source files — wrong path or missing directory, cannot evaluate the 500-line rule.');
  console.error(`  Expected scan roots: ${SCAN_ROOTS.join(', ')} (relative to ${tauriRoot})`);
  process.exit(1);
}

console.log(`✓ Rust production files are all within ${LIMIT} lines (scanned ${scanned} files, tests and benchmarks exempt)`);
