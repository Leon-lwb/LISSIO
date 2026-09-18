import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = path.join(root, 'src-tauri', 'Cargo.toml');
const metadata = JSON.parse(execFileSync('cargo', [
  'metadata', '--format-version', '1', '--no-deps', '--manifest-path', manifest,
], { encoding: 'utf8' }));
const workspace = new Set(metadata.workspace_members);
const packages = metadata.packages.filter((pkg) => workspace.has(pkg.id));
const names = new Set(packages.map((pkg) => pkg.name));
const rows = packages.map((pkg) => {
  const architecture = pkg.metadata?.lissio ?? {};
  const dependencies = pkg.dependencies
    .filter((dependency) => names.has(dependency.name))
    .map((dependency) => dependency.name)
    .sort();
  return {
    crate: pkg.name,
    lib: pkg.targets.find((target) => target.kind.includes('lib'))?.name ?? '-',
    domain: architecture.domain ?? '-',
    layer: Number.isInteger(architecture.layer) ? `L${architecture.layer}` : '-',
    responsibility: architecture.responsibility ?? '-',
    dependencies,
    reverseDependencies: [],
  };
}).sort((left, right) => left.domain.localeCompare(right.domain) || left.crate.localeCompare(right.crate));
const byName = new Map(rows.map((row) => [row.crate, row]));
for (const row of rows) {
  for (const dependency of row.dependencies) byName.get(dependency)?.reverseDependencies.push(row.crate);
}

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
    reverse: row.reverseDependencies.sort().join(', '),
  })));
}
