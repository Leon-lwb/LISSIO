#!/usr/bin/env node
// Generates the frontend TypeScript contracts from the Rust wire types (ts-rs explicit export program).
//
// Authoritative source: src-tauri/crates/desktop/rpc-api/examples/export_contracts.rs
// Output directory: src/types/generated/ (one .ts file per Rust type)
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
  ?? path.join(root, 'src', 'types', 'generated');

// Regeneration must be clean: leftover old files would make check:contracts' drift detection miss deleted types
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  'cargo',
  ['run', '-p', 'lissio-rpc-api', '--example', 'export_contracts'],
  {
    cwd: path.join(root, 'src-tauri'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TS_RS_EXPORT_DIR: outDir,
      TS_RS_LARGE_INT: 'number',
    },
  },
);

if (result.status !== 0) {
  console.error(`contract generation failed (exit ${result.status ?? 'signal'})`);
  process.exit(result.status ?? 1);
}
