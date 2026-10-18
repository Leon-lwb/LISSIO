#!/usr/bin/env node
// Generates the frontend TypeScript contracts from the Rust wire types (ts-rs explicit export programs).
//
// Authoritative sources (one export program per exit that defines the types):
//   - server/crates/desktop/rpc-api/examples/export_contracts.rs      (RPC + domain contracts)
//   - server/crates/desktop/backend-server/examples/export_frames.rs  (Web exit frames + protocol constants)
// Output directory: client/src/types/generated/ (one .ts file per Rust type, plus the generated constants module)
//
// Both programs write into the same directory on purpose: the generated directory is one
// projection of the frontend wire contract, and rpc-api (L4) must not dev-depend backend-server (L5).
//
// Environment variables:
//   LISSIO_CONTRACTS_OUT  overrides the output directory (check:contracts uses a temp directory for a side-effect-free comparison)
//
// Usage: pnpm generate:contracts

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = process.env.LISSIO_CONTRACTS_OUT
  ?? path.join(root, 'client', 'src', 'types', 'generated');

const EXPORTERS = [
  { package: 'lissio-rpc-api', example: 'export_contracts' },
  { package: 'lissio-backend-server', example: 'export_frames' },
];

// Regeneration must be clean: leftover old files would make check:contracts' drift detection miss deleted types
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

for (const { package: pkg, example } of EXPORTERS) {
  const result = spawnSync('cargo', ['run', '-p', pkg, '--example', example], {
    cwd: path.join(root, 'server'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TS_RS_EXPORT_DIR: outDir,
      TS_RS_LARGE_INT: 'number',
    },
  });
  if (result.status !== 0) {
    console.error(`contract generation failed (${example}, exit ${result.status ?? 'signal'})`);
    process.exit(result.status ?? 1);
  }
}
