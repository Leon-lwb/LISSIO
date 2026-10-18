#!/usr/bin/env node
/**
 * repo-root.mjs — the repository-root convention shared by the copyable gates.
 *
 * Why this file exists: the monorepo split left each gate in exactly one
 * repository, but the layout it inspects no longer starts at the repository root
 * the script happens to live in. A gate that reads `crates/` has to read
 * `crates/` when it runs inside `server/`, and `server/crates/` when the same
 * file runs from the umbrella checkout. Rather than hard-code one of the two,
 * every copyable gate resolves two roots through this module:
 *
 *   repository root   the repository that owns the script (its `scripts/..`),
 *                     overridable with `--root=<path>` / `--root <path>`.
 *   sub-repository    for the umbrella checkout, the submodule that owns the
 *                     files a gate inspects (`server/` for Rust, `client/` for
 *                     the frontend). Inside `server/` or `client/` themselves
 *                     there is no nested sub-repository and the repository root
 *                     is used unchanged.
 *
 * The default is therefore already correct for a copy: drop
 * `scripts/check-crate-size.mjs` into `server/scripts/` and run it with no
 * arguments. Running the umbrella's copy with no arguments keeps the pre-split
 * behaviour — it reaches into `server/` and `client/` instead of the umbrella
 * root.
 *
 * A gate that is deliberately cross-repository does not use this module: it
 * reads both sides with explicit `server/…` and `client/…` paths, because it has
 * no single owning repository to default to.
 *
 * Usage (inside a gate):
 *   import { rustWorkspaceRoot, frontendRoot } from './repo-root.mjs';
 *   const rust = rustWorkspaceRoot();      // <repo> or <repo>/server
 *   const web = frontendRoot();            // <repo> or <repo>/client
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository that contains this file: `<repo>/scripts/repo-root.mjs` → `<repo>`. */
export const scriptRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The repository root a gate should work on.
 *
 * `--root=<path>` (or `--root <path>`) wins; otherwise the repository the script
 * lives in. A path is resolved against the current working directory, so both
 * `--root=../server` from the umbrella and `--root=/abs/path` work.
 */
export function repositoryRoot(argv = process.argv.slice(2)) {
  const inline = argv.find((arg) => arg.startsWith('--root='));
  if (inline !== undefined) {
    const value = inline.slice('--root='.length);
    if (value === '') throw new Error('--root needs a path, for example --root=server');
    return resolve(process.cwd(), value);
  }
  const index = argv.indexOf('--root');
  if (index !== -1) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new Error('--root needs a path, for example --root server');
    }
    return resolve(process.cwd(), value);
  }
  return scriptRepositoryRoot;
}

/** Display path: repository-relative when it is inside the repository, absolute otherwise. */
export function displayPath(from, target) {
  const relative = target.startsWith(from) ? target.slice(from.length).replace(/^[/\\]/, '') : null;
  return relative === null || relative === '' ? target : relative;
}

/**
 * The Rust workspace root (`<repo>`): inside the umbrella the Rust workspace is
 * the `server/` submodule, while a copy that runs in `server/` or in one of its
 * nested submodules is already there.
 */
export function rustWorkspaceRoot(root = repositoryRoot()) {
  return existsSync(join(root, 'server', 'Cargo.toml')) ? join(root, 'server') : root;
}

/** The frontend root (`<repo>`): inside the umbrella the frontend is the `client/` submodule. */
export function frontendRoot(root = repositoryRoot()) {
  return existsSync(join(root, 'client', 'package.json')) ? join(root, 'client') : root;
}

/**
 * The Rust member directories that hold crates, relative to the Rust workspace
 * root. The umbrella's `server/` workspace spans four checkouts: its own
 * `crates/`, the nested `core/`, `physical/`, and `data/` submodules, plus the
 * `src/` roots that existed before the split.
 */
export function rustSourceRoots(workspace) {
  const roots = [];
  for (const candidate of ['crates', 'src']) {
    if (existsSync(join(workspace, candidate))) roots.push(candidate);
  }
  for (const submodule of ['core', 'physical', 'data']) {
    for (const candidate of ['crates', 'src']) {
      if (existsSync(join(workspace, submodule, candidate))) {
        roots.push(`${submodule}/${candidate}`);
      }
    }
  }
  return roots;
}

/**
 * Every Cargo workspace in a Rust repository, as manifest directories.
 *
 * The repository's own workspace comes first (`server/`, or the repository root
 * in a copy). A nested submodule is added only when it declares a `[workspace]`
 * table of its own: `core/` and `data/` do, so their members are excluded from
 * the server workspace and can only be read from their own metadata;
 * `physical/` does not, because its crates are member globs of the server
 * workspace.
 */
export function rustWorkspaceRoots(root = repositoryRoot()) {
  const primary = rustWorkspaceRoot(root);
  const workspaces = [primary];
  for (const submodule of ['core', 'physical', 'data']) {
    const manifest = join(primary, submodule, 'Cargo.toml');
    if (!existsSync(manifest)) continue;
    if (!/^\s*\[workspace\]/m.test(readFileSync(manifest, 'utf8'))) continue;
    workspaces.push(join(primary, submodule));
  }
  return workspaces;
}

/** Absolute path of a path that may be given relative to a repository root. */
export function underRoot(root, path) {
  return isAbsolute(path) ? path : join(root, path);
}
