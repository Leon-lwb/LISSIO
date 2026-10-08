#!/usr/bin/env node
// Web exit contract alignment check — prevents "the frontend added a command / the backend
// added an IPC, but the Web exit missed it".
//
// Data sources (all authoritative inventories inside the repository, no second copy):
//   1. src-tauri/src/lib.rs               desktop-only IPC commands registered by the Tauri shell
//   2. rpc-api/src/catalog.rs             SUPPORTED / PENDING / DESKTOP_ONLY / CHANNEL
//   3. rpc-api/src/lib.rs                 dispatch match arms
//   4. src/**/*.{ts,tsx}                  command names the frontend actually calls (transport.call / invoke)
//
// What it checks:
//   A. the four lists are pairwise disjoint; DESKTOP_ONLY = the shell IPC command set
//   B. every SUPPORTED command has a corresponding dispatch arm
//   C. every command name the frontend calls is on the public command surface (spelling drift)
//   D. commands the frontend already uses must not sit unnoticed in the not-yet-exposed set
//      (not-yet-exposed only warns, it does not block — they are exposed to the frontend for
//      degradation via /api/v1/capabilities)
//   E. exit encapsulation: Tauri IPC must not be used directly outside src/lib/rpc/ — otherwise
//      the frontend is bound back to the host and the Web exit silently fails

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const errors = [];
const warnings = [];

/** Read text; a missing file is an error and returns an empty string. */
function read(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    errors.push(`missing file: ${relative}`);
    return '';
  }
  return fs.readFileSync(absolute, 'utf8');
}

/** All IPC command names registered in generate_handler![...] (order-preserving dedup). */
function ipcCommands() {
  const source = read('src-tauri/src/lib.rs');
  const start = source.indexOf('generate_handler![');
  if (start < 0) {
    errors.push('generate_handler! registry not found in src-tauri/src/lib.rs');
    return [];
  }
  const end = source.indexOf('])', start);
  const block = source.slice(start, end);
  const names = [...block.matchAll(/^\s{12}([a-z_0-9]+),\s*$/gm)].map((m) => m[1]);
  return [...new Set(names)];
}

/** Command list constants in catalog.rs. */
function catalog() {
  const source = read('src-tauri/crates/desktop/rpc-api/src/catalog.rs');
  const lists = {};
  for (const name of ['SUPPORTED', 'PENDING', 'DESKTOP_ONLY', 'CHANNEL']) {
    const match = source.match(
      new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`),
    );
    if (!match) {
      errors.push(`${name} not found in catalog.rs`);
      lists[name] = [];
      continue;
    }
    lists[name] = [...match[1].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
  }
  return lists;
}

/** Command names of dispatch's match arms. */
function dispatchedCommands() {
  const source = read('src-tauri/crates/desktop/rpc-api/src/lib.rs');
  const start = source.indexOf('pub async fn dispatch');
  const block = source.slice(start);
  return new Set([...block.matchAll(/^\s{8}"([a-z_0-9]+)"\s*=>/gm)].map((m) => m[1]));
}

/** Strip comments — a documented `invoke('cmd')` reference is not a real call.
 *  The preceding-character test avoids treating `http://` inside a string as a line comment. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** Frontend source files — tests excluded; when `includeBridges` is true the exit
 *  implementations (lib/rpc, lib/platform) are returned too, for checks that need to tell
 *  which exit may import what. */
function frontendFiles({ includeBridges = false } = {}) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(absolute);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/__tests__|[\\/]test[\\/]|\.test\.|\.spec\./.test(absolute)) continue;
      if (!includeBridges && absolute.includes(path.join('lib', 'rpc'))) continue;
      files.push(absolute);
    }
  };
  walk(path.join(root, 'src'));
  return files;
}

/** Whether the file belongs to an exit implementation directory (lib/rpc = IPC, lib/platform = plugin shim). */
function inBridge(absolute, name) {
  return absolute.includes(path.join('lib', name));
}

/** Static frontend command names — the exit-agnostic `transport.call` and the legacy `invoke` forms. */
function frontendInvocations() {
  const patterns = [
    /\binvoke(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'/g,
    /\btransport\.call(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'/g,
  ];
  const found = new Set();
  for (const absolute of frontendFiles()) {
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) found.add(match[1]);
    }
  }
  return found;
}

/** Exit encapsulation (IPC) — outside src/lib/rpc/ it is forbidden to import
 *  @tauri-apps/api/{core,event} or call invoke()/listen() directly. */
function transportLeaks() {
  const leaks = [];
  for (const absolute of frontendFiles()) {
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    const relative = path.relative(root, absolute);
    if (/from '@tauri-apps\/api\/(core|event)'/.test(source)) {
      leaks.push(`exit leak (should go through src/lib/rpc/): ${relative} imports @tauri-apps/api/(core|event) directly`);
    }
    for (const match of source.matchAll(/(?<![.\w])(invoke|listen)(?:<[^>]*>)?\(/g)) {
      leaks.push(`exit leak (should go through src/lib/rpc/): ${relative} calls ${match[1]}() directly`);
    }
  }
  return leaks;
}

/** Exit encapsulation (plugins) — outside src/lib/platform/ it is forbidden to import any
 *  @tauri-apps/* module (static or dynamic). src/lib/rpc/ is exempt only for its own
 *  api/{core,event}; every plugin call site must be collected into the platform shim,
 *  otherwise the browser side silently fails. */
function pluginLeaks() {
  const leaks = [];
  // Matches `from '@tauri-apps/x'` / `import '@tauri-apps/x'` / `import('@tauri-apps/x')`
  const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)'(@tauri-apps\/[^']+)'/g;
  for (const absolute of frontendFiles({ includeBridges: true })) {
    if (inBridge(absolute, 'platform')) continue;
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    const relative = path.relative(root, absolute);
    for (const match of source.matchAll(importPattern)) {
      const module = match[1];
      if (inBridge(absolute, 'rpc') && /^@tauri-apps\/api\/(core|event)$/.test(module)) continue;
      leaks.push(`exit leak (should go through src/lib/platform/): ${relative} imports ${module} directly`);
    }
  }
  return leaks;
}

const ipc = new Set(ipcCommands());
const lists = catalog();
const dispatched = dispatchedCommands();
const frontend = frontendInvocations();
const leaks = [...transportLeaks(), ...pluginLeaks()];

// A. Lists are mutually exclusive, and the Tauri root package registers only desktop shell commands
const seen = new Map();
for (const [name, list] of Object.entries(lists)) {
  for (const cmd of list) {
    if (seen.has(cmd)) {
      errors.push(`${cmd} appears in both ${seen.get(cmd)} and ${name}`);
    } else {
      seen.set(cmd, name);
    }
  }
}
for (const cmd of ipc) {
  if (!lists.DESKTOP_ONLY.includes(cmd)) errors.push(`Tauri shell registered a non-desktop command: ${cmd}`);
}
for (const cmd of lists.DESKTOP_ONLY) {
  if (!ipc.has(cmd)) errors.push(`DESKTOP_ONLY not registered in the Tauri shell: ${cmd}`);
}

// B. Every SUPPORTED command must have a dispatch arm
for (const cmd of lists.SUPPORTED) {
  if (!dispatched.has(cmd)) {
    errors.push(`SUPPORTED declares ${cmd}, but dispatch has no matching arm`);
  }
}
for (const cmd of dispatched) {
  if (!lists.SUPPORTED.includes(cmd)) {
    errors.push(`dispatch implements ${cmd}, but it is not registered in SUPPORTED`);
  }
}

// C. Every command name the frontend calls must be on the backend or desktop shell public command surface
for (const cmd of frontend) {
  if (!seen.has(cmd)) {
    errors.push(`frontend calls an unregistered public command: ${cmd}`);
  }
}

// D. Used by the frontend but not yet exposed on the Web exit — informational
const notOnWeb = [...frontend].filter(
  (cmd) => lists.PENDING.includes(cmd) || lists.DESKTOP_ONLY.includes(cmd),
);
if (notOnWeb.length) {
  warnings.push(
    `the frontend already uses these commands, but the Web exit does not expose them yet (browser side must degrade): ${notOnWeb.sort().join(', ')}`,
  );
}

// E. Exit encapsulation — the frontend may reach Tauri only through src/lib/rpc/ (IPC) and src/lib/platform/ (plugins)
for (const leak of leaks) {
  errors.push(leak);
}

const summary = [
  `desktop shell IPC ${ipc.size}`,
  `SUPPORTED ${lists.SUPPORTED.length}`,
  `PENDING ${lists.PENDING.length}`,
  `DESKTOP_ONLY ${lists.DESKTOP_ONLY.length}`,
  `CHANNEL ${lists.CHANNEL.length}`,
  `frontend calls ${frontend.size}`,
  `exit leaks ${leaks.length}`,
].join(' / ');

if (warnings.length) {
  console.warn(warnings.map((message) => `⚠ ${message}`).join('\n'));
}
if (errors.length) {
  console.error(`Web exit contract check failed (${errors.length}):\n${errors.map((e) => `- ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ Web exit contract check passed — ${summary}`);
