/**
 * architecture.mjs — crate / domain / layer / responsibility / dependency inventory.
 *
 * Why it exists: `docs/architecture/crates.md` tells a reader which crate owns a
 * type and which layers a change may reach. This prints the same inventory from
 * `cargo metadata`, so the documented table can be compared against the real
 * workspace instead of being trusted.
 *
 * It is informational: there is no exit-code path, and `check:architecture`
 * (`scripts/check-crate-architecture.mjs`) is the gate that enforces the rules.
 *
 * Repository-root convention (`scripts/repo-root.mjs`): the Rust workspace of the
 * repository the script runs in — `server/` inside the umbrella, the repository
 * itself inside a copy — and `--root=<path>` selects another checkout.
 *
 * Usage:
 *   pnpm architecture [--format=table|json|dot] [--root=<path>]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { repositoryRoot, rustWorkspaceRoot } from './repo-root.mjs';

const root = repositoryRoot();
const manifest = path.join(rustWorkspaceRoot(root), 'Cargo.toml');
const metadata = JSON.parse(execFileSync('cargo', [
  'metadata', '--format-version', '1', '--no-deps', '--manifest-path', manifest,
], { encoding: 'utf8' }));
const workspace = new Set(metadata.workspace_members);
const packages = metadata.packages.filter((pkg) => workspace.has(pkg.id));
const names = new Set(packages.map((pkg) => pkg.name));

/** Workspace-internal dependency names: production (normal + build) or dev-only. */
function workspaceDeps(pkg, { dev }) {
  return [...new Set(pkg.dependencies
    .filter((dependency) => names.has(dependency.name))
    .filter((dependency) => (dev ? dependency.kind === 'dev' : dependency.kind !== 'dev'))
    .map((dependency) => dependency.name))].sort();
}

const rows = packages.map((pkg) => {
  const architecture = pkg.metadata?.lissio ?? {};
  // Production columns describe the *shipped* graph: a test-only dependency is
  // not an architectural edge. Listing it inverted the documented direction
  // (`data-model --> can` as a dev-dependency) and made the report disagree with
  // `check:architecture`, which has always skipped `kind === 'dev'`. It is kept
  // separately in `devDependencies` so it stays visible without masquerading as
  // a shipped edge.
  return {
    crate: pkg.name,
    lib: pkg.targets.find((target) => target.kind.includes('lib'))?.name ?? '-',
    domain: architecture.domain ?? '-',
    layer: Number.isInteger(architecture.layer) ? `L${architecture.layer}` : '-',
    responsibility: architecture.responsibility ?? '-',
    dependencies: workspaceDeps(pkg, { dev: false }),
    devDependencies: workspaceDeps(pkg, { dev: true }),
    reverseDependencies: [],
  };
}).sort((left, right) => left.domain.localeCompare(right.domain) || left.crate.localeCompare(right.crate));
const byName = new Map(rows.map((row) => [row.crate, row]));
for (const row of rows) {
  for (const dependency of row.dependencies) byName.get(dependency)?.reverseDependencies.push(row.crate);
}
// One roster, one entry per dependent: a crate that both names a dependency and
// reaches it through a target-specific table used to appear twice.
for (const row of rows) row.reverseDependencies = [...new Set(row.reverseDependencies)].sort();

const format = process.argv.find((arg) => arg.startsWith('--format='))?.split('=')[1] ?? 'table';
if (format === 'json') {
  console.log(JSON.stringify(rows, null, 2));
} else if (format === 'dot') {
  console.log('digraph lissio {');
  for (const row of rows) console.log(`  "${row.crate}" [label="${row.crate}\\n${row.domain}/${row.layer}"];`);
  for (const row of rows) for (const dependency of row.dependencies) console.log(`  "${row.crate}" -> "${dependency}";`);
  console.log('}');
} else {
  console.table(rows.map((row) => ({
    crate: row.crate,
    lib: row.lib,
    domain: row.domain,
    layer: row.layer,
    responsibility: row.responsibility,
    dependencies: row.dependencies.join(', '),
    dev: row.devDependencies.join(', '),
    reverse: row.reverseDependencies.join(', '),
  })));
}
