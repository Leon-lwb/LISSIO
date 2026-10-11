import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tauriRoot = path.join(root, 'src-tauri');
const metadata = JSON.parse(execFileSync('cargo', [
  'metadata', '--format-version', '1', '--no-deps', '--manifest-path', path.join(tauriRoot, 'Cargo.toml'),
], { encoding: 'utf8' }));
const members = new Set(metadata.workspace_members);
const packages = metadata.packages.filter((pkg) => members.has(pkg.id));
const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
const errors = [];
const domains = new Set(['shared', 'signal', 'vehicle', 'protocol', 'graph', 'transport', 'data', 'workspace', 'ai', 'application', 'integration', 'desktop']);
const allowedDomains = {
  shared: [], signal: ['shared'], vehicle: ['shared'], protocol: ['shared', 'vehicle'],
  graph: ['shared', 'signal', 'protocol'], transport: ['shared', 'vehicle', 'protocol'],
  data: ['shared', 'signal', 'vehicle', 'protocol', 'transport', 'graph'],
  workspace: ['shared', 'graph'], ai: ['shared'],
  application: ['shared', 'signal', 'vehicle', 'protocol', 'graph', 'transport', 'data', 'workspace'],
  integration: ['shared', 'signal', 'vehicle', 'protocol', 'graph', 'application', 'ai'],
  desktop: [...domains],
};
const adapterDependencies = new Set(['tauri', 'keyring', 'genai', 'rmcp', 'serialport', 'nusb', 'wgpu']);
// Lib/bin target names carry the responsibility naming; the `lissio-` prefix is
// reserved for the crates.io package name (registry namespace) and must never
// appear on a target name.
const bannedTargetNames = /^(?:core|runtime|types|common)$|^(?:lissio|vofa)-/;
// Tests live in files, not inline in production modules and not in directories
// created to hold them: unit tests that need private access go in a flat
// `<module>_tests.rs` file beside `<module>.rs`, and a `tests/`/`benches/`
// directory is reserved for grouped suites and public-API integration tests.
// See docs/architecture/crates.md.
const inlineTestModule = /^(?:pub\s+)?mod\s+\w+\s*\{/;
const PLACEHOLDER_RESPONSIBILITY = 'Focused crate responsibility';

for (const pkg of packages) {
  const manifest = path.resolve(pkg.manifest_path);
  const isRoot = manifest === path.join(tauriRoot, 'Cargo.toml');
  const architecture = pkg.metadata?.lissio;
  if (isRoot) continue;
  const relative = path.relative(path.join(tauriRoot, 'crates'), path.dirname(manifest)).split(path.sep);
  if (relative.length !== 2) errors.push(`${pkg.name}: expected crates/<domain>/<crate>`);
  if (!architecture || !domains.has(architecture.domain) || !Number.isInteger(architecture.layer) || !architecture.responsibility?.trim()) {
    errors.push(`${pkg.name}: incomplete [package.metadata.lissio]`);
    continue;
  }
  if (architecture.responsibility.trim() === PLACEHOLDER_RESPONSIBILITY) {
    errors.push(`${pkg.name}: responsibility is still the placeholder — state the crate's actual abstraction`);
  }
  const crateDir = relative[1];
  if (relative[0] !== architecture.domain) errors.push(`${pkg.name}: directory domain and metadata domain differ`);
  const libTarget = pkg.targets.find((target) => target.kind.includes('lib'));
  if (libTarget?.name !== crateDir.replace(/-/g, '_')) errors.push(`${pkg.name}: lib target must match directory name (${crateDir.replace(/-/g, '_')})`);
  const expectedPackageName = `lissio-${crateDir.replace(/_/g, '-')}`;
  if (pkg.name !== expectedPackageName) errors.push(`${pkg.name}: package name must be ${expectedPackageName}`);
  if (libTarget && bannedTargetNames.test(libTarget.name)) errors.push(`${pkg.name}: forbidden ambiguous or prefixed crate name`);
  for (const dependency of pkg.dependencies) {
    const target = byName.get(dependency.name);
    if (target && target.id !== pkg.id) {
      const targetArchitecture = target.metadata?.lissio;
      if (!targetArchitecture) continue;
      // Test-only dependencies may cross production boundaries; they do not
      // become part of the shipped dependency graph.
      if (dependency.kind !== 'dev') {
        if (targetArchitecture.layer > architecture.layer) errors.push(`${pkg.name}: L${architecture.layer} cannot depend on ${target.name} L${targetArchitecture.layer}`);
        if (targetArchitecture.domain !== architecture.domain && !allowedDomains[architecture.domain].includes(targetArchitecture.domain)) {
          errors.push(`${pkg.name}: ${architecture.domain} cannot depend on ${target.name} (${targetArchitecture.domain})`);
        }
      }
      if (target.name === 'lissio-graph-testkit' && dependency.kind !== 'dev') errors.push(`${pkg.name}: graph-testkit must be a dev-dependency`);
    }
    if (architecture.layer <= 3 && adapterDependencies.has(dependency.name)) errors.push(`${pkg.name}: L0-L3 cannot depend on adapter ${dependency.name}`);
    if (dependency.name.startsWith('tauri') && architecture.domain !== 'desktop') errors.push(`${pkg.name}: Tauri is restricted to the desktop domain`);
  }
}

// Test layout: no inline `#[cfg(test)] mod x { ... }` may survive in production
// source, and no directory may exist only to hold a module's tests. Test-only
// files (a `tests`/`benches` directory, a `tests.rs` module file, or a
// `*_tests.rs` name) are exempt from the inline scan, matching
// scripts/check-crate-size.mjs.
const TEST_FILE = /^(?:tests\.rs|.*_tests\.rs)$/;
const SKIP_DIR_NAMES = new Set(['node_modules']);

/** Cargo marks its build directory with `CACHEDIR.TAG`; a module directory may
 * legitimately be named `target`, so the marker decides instead of the name. */
function isBuildDirectory(dir) {
  return existsSync(path.join(dir, 'CACHEDIR.TAG'));
}

function inTestSuite(relative) {
  const parts = relative.split('/');
  return parts.includes('tests') || parts.includes('benches');
}

function isTestPath(relative) {
  return inTestSuite(relative) || TEST_FILE.test(relative.split('/').at(-1));
}

function walkRust(dir, files = [], dirs = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files, dirs };
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (isBuildDirectory(child)) continue;
      dirs.push(child);
      walkRust(child, files, dirs);
    } else if (entry.name.endsWith('.rs')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return { files, dirs };
}

/** True when the `#[cfg(test)]` at `index` directly declares a brace-delimited
 * test module, skipping comments and (possibly multi-line) attributes. */
function declaresInlineTestModule(lines, index) {
  let depth = 0;
  for (let cursor = index + 1; cursor < Math.min(lines.length, index + 40); cursor += 1) {
    const text = lines[cursor].trim();
    const opens = (lines[cursor].match(/[({[]/g) ?? []).length;
    const closes = (lines[cursor].match(/[)}\]]/g) ?? []).length;
    if (depth > 0) {
      depth += opens - closes;
      continue;
    }
    if (text === '' || text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')) continue;
    if (text.startsWith('#')) {
      depth += opens - closes;
      continue;
    }
    return inlineTestModule.test(text);
  }
  return false;
}

let scannedSources = 0;
let scannedDirectories = 0;
for (const scanRoot of ['crates', 'src']) {
  const { files, dirs } = walkRust(path.join(tauriRoot, scanRoot));
  for (const dir of dirs) {
    const relativeDir = path.relative(tauriRoot, dir).split(path.sep).join('/');
    if (inTestSuite(relativeDir)) continue;
    let rustFiles;
    try {
      rustFiles = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.rs'))
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    if (rustFiles.length === 0) continue;
    scannedDirectories += 1;
    if (rustFiles.every((name) => TEST_FILE.test(name))) {
      errors.push(`${relativeDir}: test-only directory — keep module tests in a flat <module>_tests.rs file beside <module>.rs`);
    }
  }
  for (const file of files) {
    const relative = path.relative(tauriRoot, file).split(path.sep).join('/');
    if (isTestPath(relative)) continue;
    scannedSources += 1;
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim() !== '#[cfg(test)]') continue;
      if (declaresInlineTestModule(lines, index)) {
        errors.push(`${relative}:${index + 1}: inline #[cfg(test)] module — move tests into a flat <module>_tests.rs file beside <module>.rs`);
      }
    }
  }
}
if (scannedSources === 0) errors.push('scanned 0 Rust source files — cannot evaluate the test layout rule');
if (scannedDirectories === 0) errors.push('scanned 0 Rust source directories — cannot evaluate the test-only directory rule');

if (errors.length) {
  console.error(`Architecture check failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Architecture check passed: ${packages.length - 1} domain-grouped crates + lissio composition root, ${scannedSources} production Rust files and ${scannedDirectories} module directories with flat, non-inline tests.`);
