import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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
const bannedNames = /^(?:core|runtime|types|common)$|^(?:lissio|vofa)-/;

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
  if (relative[0] !== architecture.domain) errors.push(`${pkg.name}: directory domain and metadata domain differ`);
  if (relative[1] !== pkg.name) errors.push(`${pkg.name}: directory must match package name`);
  if (bannedNames.test(pkg.name)) errors.push(`${pkg.name}: forbidden ambiguous or prefixed crate name`);
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
      if (target.name === 'graph-testkit' && dependency.kind !== 'dev') errors.push(`${pkg.name}: graph-testkit must be a dev-dependency`);
    }
    if (architecture.layer <= 3 && adapterDependencies.has(dependency.name)) errors.push(`${pkg.name}: L0-L3 cannot depend on adapter ${dependency.name}`);
    if (dependency.name.startsWith('tauri') && architecture.domain !== 'desktop') errors.push(`${pkg.name}: Tauri is restricted to the desktop domain`);
  }
}

if (errors.length) {
  console.error(`Architecture check failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Architecture check passed: ${packages.length - 1} domain-grouped crates + lissio composition root.`);
