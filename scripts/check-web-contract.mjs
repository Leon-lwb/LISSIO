#!/usr/bin/env node
// Web exit contract alignment check — prevents "the frontend added a command / the backend
// added an IPC, but the Web exit missed it".
//
// Data sources (all authoritative inventories inside the checkout, no second copy):
//   1. client/src-tauri/src/lib.rs        desktop-only IPC commands registered by the Tauri shell
//   2. server/crates/desktop/rpc-api/src/catalog.rs  SUPPORTED / PENDING / DESKTOP_ONLY / CHANNEL / PAYLOAD_ARGS
//   3. server/crates/desktop/rpc-api/src/lib.rs      dispatch match arms
//   4. client/src/**/*.{ts,tsx}           command names the frontend actually calls (transport.call / invoke)
//   5. server/crates/desktop/rpc-api/src/*.rs        the argument names each dispatch arm reads via required()/optional()
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
//   F. argument-name agreement: for every command with a literal frontend call site, the
//      top-level argument keys the frontend sends (normalized camelCase → snake_case the same way
//      `rpc-api/src/args.rs::normalize_args` does) must be exactly the keys that command's
//      dispatch arm reads through `required(...)`/`optional(...)`. A rename on either side is a
//      silent defect: the backend drops the argument (or falls back to a default) and the Web
//      exit keeps reporting success.
//
// F is the check the docs already claimed: `server/docs/architecture/exits.md` and
// `server/docs/architecture/web-exit.md` state that parameter names are machine-checked and identical
// across exits. Command names alone were never enough — `catalog.rs:181-191` records the
// `requestRevision` → `request_revision` defect that shipped because of exactly that gap.
//
// Argument attribution strategy (deliberately not heuristic):
//   - each command's argument contract is read from the adapter function its `dispatch` arm
//     calls (`"cmd" => module::function(...)`), not guessed from a global scan;
//   - keys come from literal `required(args, cmd, "key")` / `optional(args, cmd, "key")` calls
//     (including the turbofish and `&args` forms) in that function and in the same-file helper
//     functions it calls (e.g. `acquisition.rs::node_identity` → `node_id`);
//   - a command whose adapter function hands `args` to something the parser cannot follow is
//     reported as unattributable and skipped, never assumed to take no arguments;
//   - `catalog.rs::PAYLOAD_ARGS` commands pass the whole object through as a request DTO, so
//     their top-level keys are owned by the ts-rs contract instead — those are skipped by name
//     and counted;
//   - frontend arguments are only compared where the call site passes an object literal; a
//     variable, spread, computed key or non-literal command name is skipped and counted.
//   The coverage block prints compared vs skipped with reasons, and the check FAILS if it
//   compares nothing: a contract that is enforced nowhere must not look green.
//
// Known limits, stated rather than hidden: a command name or argument built from a variable
// (`transport.call(NAME, { [key]: value })`) cannot be checked statically — such a call site is
// reported as skipped, not silently ignored. Only top-level keys are compared; nested DTO fields
// are owned by the generated `src/types/generated/*.ts` contract (`check:contracts`).
//
// M9g — literal forms: a command name may be written with single quotes, double quotes or a
// template literal; all three are accepted, because a check that recognized only the
// single-quoted form would go blind on a purely stylistic change. A *non-literal* command name
// cannot be checked and is reported in the coverage block rather than ignored.
//
// Exemptions: an argument that belongs to the transport rather than to the rpc-api contract is
// listed per command and per key in `TRANSPORT_ONLY_ARGS` below, with the reason; anything not
// registered there is compared.

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

// ── Source scanning helpers shared by the name and argument checks ──────────
const JS_QUOTES = ['"', "'", '`'];
// Rust string literals are double-quoted. `rpc-api` contains no char literals or lifetimes, so
// `'` is deliberately NOT treated as a string delimiter here: treating `&'static str` as one
// would jump past real braces and corrupt the function-body scan.
const RUST_QUOTES = ['"'];

/** Index of the closing quote of the literal starting at `start`, or `text.length`. */
function skipString(text, start, quotes) {
  const quote = text[start];
  if (!quotes.includes(quote)) return start;
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i;
    if (quote !== '`' && text[i] === '\n') return i; // unterminated single-line literal
  }
  return text.length;
}

/** Index of the delimiter closing `text[open]` (one of `()[]` or `{}`), or -1. */
function matchDelimiter(text, open, quotes) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const opener = text[open];
  const closer = pairs[opener];
  if (!closer) return -1;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quotes.includes(ch)) {
      i = skipString(text, i, quotes);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      if (newline < 0) return -1;
      i = newline;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
      continue;
    }
    if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split `text` on commas that are not nested inside brackets or literals. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (JS_QUOTES.includes(ch)) {
      i = skipString(text, i, JS_QUOTES);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** 1-based line number of `index`. */
function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/** The string value of one quoted literal, or null when `text` is not a plain literal. */
function literalValue(text) {
  const trimmed = text.trim();
  const match =
    /^'([^'\\]*)'$/.exec(trimmed) ??
    /^"([^"\\]*)"$/.exec(trimmed) ??
    /^`([^`\\$]*)`$/.exec(trimmed);
  return match ? match[1] : null;
}

/** Strip block comments and whole-line comments while preserving line numbers. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (match, prefix) => prefix);
}

/** All IPC command names registered in generate_handler![...] (order-preserving dedup). */
function ipcCommands() {
  const source = read('client/src-tauri/src/lib.rs');
  const start = source.indexOf('generate_handler![');
  if (start < 0) {
    errors.push('generate_handler! registry not found in client/src-tauri/src/lib.rs');
    return [];
  }
  const end = source.indexOf('])', start);
  const block = source.slice(start, end);
  const names = [...block.matchAll(/^\s{12}([a-z_0-9]+),\s*$/gm)].map((m) => m[1]);
  return [...new Set(names)];
}

/** One `pub const NAME: &[&str] = &[...];` list from catalog.rs, or null when absent. */
function catalogList(source, name) {
  const match = source.match(new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`));
  if (!match) return null;
  return [...match[1].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
}

/** Command lists and the payload pass-through set from catalog.rs. */
function catalog() {
  const source = read('server/crates/desktop/rpc-api/src/catalog.rs');
  const lists = {};
  for (const name of ['SUPPORTED', 'PENDING', 'DESKTOP_ONLY', 'CHANNEL']) {
    const found = catalogList(source, name);
    if (found === null) {
      errors.push(`${name} not found in catalog.rs`);
      lists[name] = [];
      continue;
    }
    lists[name] = found;
  }
  const payloadArgs = catalogList(source, 'PAYLOAD_ARGS');
  if (payloadArgs === null) {
    // Without this list a payload pass-through command would be compared key by key against a
    // request DTO that is deliberately not a named-argument contract, so the check would either
    // fail permanently or need a silent guess. Requiring the list keeps the exemption reviewable.
    errors.push(
      'PAYLOAD_ARGS not found in catalog.rs — the payload pass-through exception list is required ' +
        'for the argument-name check',
    );
  }
  return { lists, payloadArgs: payloadArgs ?? [] };
}

/** Command names of dispatch's match arms. */
function dispatchedCommands() {
  const source = read('server/crates/desktop/rpc-api/src/lib.rs');
  const start = source.indexOf('pub async fn dispatch');
  const block = source.slice(start);
  return new Set([...block.matchAll(/^\s{8}"([a-z_0-9]+)"\s*=>/gm)].map((m) => m[1]));
}

/**
 * Command → adapter function, from the same `dispatch` match arms.
 *
 * Two arm shapes exist and both are read: a single line
 * (`"send_raw" => transport::send_raw(host, cmd, &args).await,`) and a braced arm whose call
 * continues on the next line (`"close_acquisition_endpoint" => { acquisition::…(…) }`). The
 * leading `Ok(` of arms such as `"list_device_tree_nodes" => Ok(acquisition::…)` is optional.
 * Arms that return something else (`other => Err(…)`) have an identifier rather than a quoted
 * command name and are not matched.
 */
function dispatchTargets() {
  const source = stripComments(read('server/crates/desktop/rpc-api/src/lib.rs'));
  const targets = new Map();
  for (const match of source.matchAll(
    /"([a-z_0-9]+)"\s*=>\s*(?:Ok\()?\s*\{?\s*([a-z_0-9]+)::([a-z_0-9]+)/g,
  )) {
    targets.set(match[1], { module: match[2], fn: match[3] });
  }
  return targets;
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
  walk(path.join(root, 'client', 'src'));
  return files;
}

/**
 * Top-level keys of an object literal (`{ a, b: 1, ...c, [d]: 2 }`).
 *
 * Returns `keys` plus `unknown` — a reason the key set is incomplete (spread, computed key,
 * method shorthand, anything the small parser does not understand). A caller must not compare a
 * partial key set, so `unknown` makes the call site uncountable rather than half-checked.
 */
function objectLiteralKeys(text) {
  const keys = [];
  const inner = text.trim().slice(1, -1);
  for (const part of splitTopLevel(inner)) {
    const segment = part.trim();
    if (!segment) continue;
    if (segment.startsWith('...')) return { keys, unknown: 'spread argument (…obj)' };
    if (segment.startsWith('[')) return { keys, unknown: 'computed argument key ([expr])' };
    const named = /^(?:([A-Za-z_$][\w$]*)|'([^']*)'|"([^"]*)")\s*:/.exec(segment);
    if (named) {
      keys.push(named[1] ?? named[2] ?? named[3]);
      continue;
    }
    const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(segment);
    if (shorthand) {
      keys.push(shorthand[1]);
      continue;
    }
    return { keys, unknown: 'unparsed argument member' };
  }
  return { keys, unknown: null };
}

/**
 * Frontend command call sites: `transport.call('cmd', { … })` / `invoke('cmd', { … })`.
 *
 * Every call site is reported, including the ones that cannot be compared: a non-literal
 * command name, a non-literal argument object (a variable or a whole request DTO) and an object
 * literal with a spread/computed member. Those are counted as skipped in the coverage block,
 * which is what keeps "0 mismatches" from meaning "0 comparisons".
 */
function frontendCallSites() {
  const sites = [];
  for (const absolute of frontendFiles()) {
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    // `transport` and its `.call` may sit on different lines (a method chain wrapped by the
    // formatter, e.g. `void transport\n  .call('ack_data', { … })`); whitespace between them is
    // therefore allowed, otherwise that whole call site would be invisible to both the name and
    // the argument check. `transport` is the only Transport binding used outside src/lib/rpc/.
    for (const match of source.matchAll(
      /\b(?:transport\s*\.\s*call|invoke)(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(/g,
    )) {
      const callOpen = match.index + match[0].length - 1;
      const callClose = matchDelimiter(source, callOpen, JS_QUOTES);
      if (callClose < 0) continue;
      const args = splitTopLevel(source.slice(callOpen + 1, callClose));
      const site = {
        file: relative,
        line: lineOf(source, callOpen),
        command: null,
        keys: null,
        skipped: null,
      };
      const command = literalValue(args[0] ?? '');
      if (!command || !/^[a-z_0-9]+$/.test(command)) {
        site.skipped = 'command name is not a literal (dynamic name)';
        sites.push(site);
        continue;
      }
      site.command = command;
      const payload = (args[1] ?? '').trim();
      if (!payload) {
        site.keys = [];
        sites.push(site);
        continue;
      }
      const closes =
        payload.startsWith('{') && payload.endsWith('}')
          ? matchDelimiter(payload, 0, JS_QUOTES)
          : -1;
      if (closes !== payload.length - 1) {
        site.skipped = 'arguments are not an object literal (variable/DTO pass-through)';
        sites.push(site);
        continue;
      }
      const { keys, unknown } = objectLiteralKeys(payload);
      if (unknown) {
        site.skipped = unknown;
        sites.push(site);
        continue;
      }
      site.keys = keys;
      sites.push(site);
    }
  }
  return sites;
}

/**
 * Arguments that belong to the transport, not to the rpc-api argument contract.
 *
 * `ai_chat_send` carries an event channel. The desktop exit passes a Tauri `Channel`; the Web
 * (WebSocket) exit reads it from the *raw* frame before dispatch
 * (`backend-server/src/session.rs` → `RpcContext::chat_events`) and the frontend therefore
 * includes `onEvent` in the args object. `rpc-api::dispatch` never reads it from `args`, so
 * comparing it against `required`/`optional` keys would report a permanent false mismatch.
 *
 * The exemption is per command **and** per key on purpose: a real rename next to it (e.g.
 * `sessionId` → `sessionID`, which normalize_args would turn into `session_i_d`) is still
 * caught. The value is the frontend spelling; it is normalized like every other key.
 */
const TRANSPORT_ONLY_ARGS = new Map([['ai_chat_send', new Set(['onEvent'])]]);

/**
 * camelCase → snake_case, mirroring `rpc-api/src/args.rs::to_snake_case` exactly: every ASCII
 * uppercase letter becomes `_` + lowercase, everything else is left alone. The backend normalizes
 * the top-level argument keys with this rule before reading them, so the check must use the same
 * rule or it would compare two different names.
 */
function toSnakeCase(key) {
  if (!/[A-Z]/.test(key)) return key;
  let out = '';
  for (const ch of key) out += /[A-Z]/.test(ch) ? `_${ch.toLowerCase()}` : ch;
  return out;
}

const ipc = new Set(ipcCommands());
const { lists, payloadArgs } = catalog();
const dispatched = dispatchedCommands();
const callSites = frontendCallSites();
const frontend = new Set(callSites.map((site) => site.command).filter(Boolean));

/** Whether the file belongs to an exit implementation directory (lib/rpc = IPC, lib/platform = plugin shim). */
function inBridge(absolute, name) {
  return absolute.includes(path.join('lib', name));
}

/** Exit encapsulation (IPC) — outside src/lib/rpc/ it is forbidden to import
 *  @tauri-apps/api/{core,event} or call invoke()/listen() directly. */
function transportLeaks() {
  const found = [];
  for (const absolute of frontendFiles()) {
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    const relative = path.relative(root, absolute);
    if (/from '@tauri-apps\/api\/(core|event)'/.test(source)) {
      found.push(`exit leak (should go through src/lib/rpc/): ${relative} imports @tauri-apps/api/(core|event) directly`);
    }
    for (const match of source.matchAll(/(?<![.\w])(invoke|listen)(?:<[^>]*>)?\(/g)) {
      found.push(`exit leak (should go through src/lib/rpc/): ${relative} calls ${match[1]}() directly`);
    }
  }
  return found;
}

/** Exit encapsulation (plugins) — outside src/lib/platform/ it is forbidden to import any
 *  @tauri-apps/* module (static or dynamic). src/lib/rpc/ is exempt only for its own
 *  api/{core,event}; every plugin call site must be collected into the platform shim,
 *  otherwise the browser side silently fails. */
function pluginLeaks() {
  const found = [];
  // Matches `from '@tauri-apps/x'` / `import '@tauri-apps/x'` / `import('@tauri-apps/x')`
  const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)'(@tauri-apps\/[^']+)'/g;
  for (const absolute of frontendFiles({ includeBridges: true })) {
    if (inBridge(absolute, 'platform')) continue;
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    const relative = path.relative(root, absolute);
    for (const match of source.matchAll(importPattern)) {
      const module = match[1];
      if (inBridge(absolute, 'rpc') && /^@tauri-apps\/api\/(core|event)$/.test(module)) continue;
      found.push(`exit leak (should go through src/lib/platform/): ${relative} imports ${module} directly`);
    }
  }
  return found;
}

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
//    (literal names only — a non-literal name cannot be resolved statically and is counted in F's coverage)
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

// ── F. Argument-name contract ───────────────────────────────────────────────
//
// Rust side: read each dispatch arm's adapter function and attribute the keys it reads with
// `required()`/`optional()`. Same-file helpers are followed one capability deep (the adapters
// delegate identity extraction to helpers such as `acquisition.rs::node_identity`), but an
// independent dispatch entry point is never merged in: it serves a different command and may
// legitimately read a different key set.
const RPC_API_SRC = 'server/crates/desktop/rpc-api/src';
const KEY_CALL =
  /\b(required|optional)\s*(?:::\s*<(?:[^<>]|<[^<>]*>)*>\s*)?\(\s*&?\s*args\s*,\s*&?\s*cmd\s*,\s*"([a-z_0-9]+)"\s*\)/g;

/** Per-function argument facts for one adapter module. */
function parseAdapterModule(relative) {
  const source = stripComments(read(relative));
  const functions = new Map();
  for (const match of source.matchAll(/(?:^|\n)[ \t]*(?:pub\s+)?(?:async\s+)?fn\s+([a-z_0-9]+)\s*[<(]/g)) {
    const name = match[1];
    const paren = source.indexOf('(', match.index + match[0].length - 1);
    if (paren < 0) continue;
    const parenEnd = matchDelimiter(source, paren, RUST_QUOTES);
    if (parenEnd < 0) continue;
    const bodyOpen = source.indexOf('{', parenEnd);
    if (bodyOpen < 0) continue;
    const bodyClose = matchDelimiter(source, bodyOpen, RUST_QUOTES);
    if (bodyClose < 0) continue;
    const signature = source.slice(paren, parenEnd + 1);
    const body = source.slice(bodyOpen, bodyClose + 1);
    const keys = new Map();
    let keyCount = 0;
    for (const keyMatch of body.matchAll(KEY_CALL)) {
      keyCount += 1;
      if (keys.has(keyMatch[2])) continue;
      keys.set(keyMatch[2], {
        kind: keyMatch[1],
        where: `${relative}:${lineOf(source, bodyOpen + keyMatch.index)}`,
      });
    }
    const calls = new Set();
    for (const callMatch of body.matchAll(/\b([a-z_0-9]+)\s*(?:::\s*<[^(]*>)?\s*\(/g)) {
      calls.add(callMatch[1]);
    }
    functions.set(name, { keys, calls, keyCount, takesArgs: /\bargs\s*:/.test(signature) });
  }
  return { functions, sourceKeyCount: [...source.matchAll(KEY_CALL)].length };
}

/**
 * module name → Map<function name, facts> for every adapter source file, plus the number of
 * `required`/`optional` key reads found inside parsed function bodies and in the sources.
 *
 * The two key-read totals are compared by the caller: if a function body fails to parse (an
 * unbalanced brace, a new syntax form), its keys disappear from the attribution while the source
 * still contains them, and the argument contract would silently shrink. Equal counts is the
 * cheap, exact proof that nothing was dropped.
 */
function adapterModules() {
  const modules = new Map();
  let keysInFunctions = 0;
  let keysInSources = 0;
  for (const entry of fs.readdirSync(path.join(root, RPC_API_SRC))) {
    if (!entry.endsWith('.rs') || entry.endsWith('_tests.rs')) continue;
    const module = entry.slice(0, -'.rs'.length);
    const { functions, sourceKeyCount } = parseAdapterModule(`${RPC_API_SRC}/${entry}`);
    modules.set(module, functions);
    keysInSources += sourceKeyCount;
    for (const facts of functions.values()) keysInFunctions += facts.keyCount;
  }
  return { modules, keysInFunctions, keysInSources };
}

const DISPATCH_TARGETS = dispatchTargets();
const { modules: ADAPTER_MODULES, keysInFunctions, keysInSources } = adapterModules();
/** `module::function` of every dispatch entry point — never merged into another command. */
const TARGET_IDS = new Set(
  [...DISPATCH_TARGETS.values()].map((target) => `${target.module}::${target.fn}`),
);

/** Keys one adapter function reads, following same-file helpers; `reason` when unattributable. */
function attributeArguments(module, fnName, depth = 0, visited = new Set()) {
  const functions = ADAPTER_MODULES.get(module);
  const facts = functions?.get(fnName);
  if (!facts) {
    return { keys: new Map(), reason: `no fn ${module}::${fnName} in ${RPC_API_SRC}` };
  }
  const id = `${module}::${fnName}`;
  if (visited.has(id) || depth > 4) return { keys: new Map() };
  visited.add(id);

  const keys = new Map(facts.keys);
  for (const callee of facts.calls) {
    if (callee === fnName) continue;
    const calleeFacts = functions.get(callee);
    if (!calleeFacts || calleeFacts.keys.size === 0) continue;
    if (TARGET_IDS.has(`${module}::${callee}`)) continue;
    const nested = attributeArguments(module, callee, depth + 1, visited);
    for (const [key, detail] of nested.keys) if (!keys.has(key)) keys.set(key, detail);
  }

  if (keys.size === 0 && facts.takesArgs) {
    const helpers = [...facts.calls].filter(
      (callee) => callee !== fnName && functions.has(callee) && !TARGET_IDS.has(`${module}::${callee}`),
    );
    return {
      keys,
      reason: helpers.length
        ? `body receives args and hands them to ${helpers.join(', ')}, which reads no required()/optional() key`
        : 'body receives args but reads no key through required()/optional()',
    };
  }
  return { keys };
}

const payloadArgsSet = new Set(payloadArgs);
const rustArgumentNames = new Map();
const rustSkipped = { payload: [], unattributable: [] };
for (const [command, target] of DISPATCH_TARGETS) {
  if (payloadArgsSet.has(command)) {
    rustSkipped.payload.push(command);
    continue;
  }
  const { keys, reason } = attributeArguments(target.module, target.fn);
  if (reason) {
    rustSkipped.unattributable.push(`${command} (${target.module}::${target.fn}): ${reason}`);
    continue;
  }
  rustArgumentNames.set(command, keys);
}

// The surface scan (check B) and the argument attribution scan read the same file in two
// different ways; if they disagree, one of them is blind and the argument check would silently
// lose commands. Fail closed instead.
for (const command of dispatched) {
  if (!DISPATCH_TARGETS.has(command)) {
    errors.push(
      `dispatch arm "${command}" was matched by the command-name scan but not by the argument scan — ` +
        'argument attribution cannot be trusted',
    );
  }
}
for (const command of DISPATCH_TARGETS.keys()) {
  if (!dispatched.has(command)) {
    errors.push(`dispatch arm "${command}" was matched by the argument scan but not by the surface scan`);
  }
}

// Attribution must be complete, not merely non-empty. Two exact invariants prove it:
//   1. every `required`/`optional` key read found in the sources was found inside a parsed
//      function body (a body that failed to parse would silently drop its keys);
//   2. every function that reads keys is reachable from some dispatch arm (keys read by an
//      unreachable helper enforce nothing, and no command would compare them).
const REACHABLE_ADAPTER_FUNCTIONS = (() => {
  const reachable = new Set();
  const walk = (module, fnName) => {
    const id = `${module}::${fnName}`;
    if (reachable.has(id)) return;
    reachable.add(id);
    const facts = ADAPTER_MODULES.get(module)?.get(fnName);
    if (!facts) return;
    for (const callee of facts.calls) {
      if (ADAPTER_MODULES.get(module)?.has(callee)) walk(module, callee);
    }
  };
  for (const target of DISPATCH_TARGETS.values()) walk(target.module, target.fn);
  return reachable;
})();
for (const [module, functions] of ADAPTER_MODULES) {
  for (const [fnName, facts] of functions) {
    if (facts.keyCount === 0) continue;
    if (REACHABLE_ADAPTER_FUNCTIONS.has(`${module}::${fnName}`)) continue;
    errors.push(
      `argument keys read in ${module}::${fnName} are not reachable from any dispatch arm — ` +
        'those required()/optional() reads enforce nothing and no command compares them',
    );
  }
}
if (keysInFunctions !== keysInSources) {
  errors.push(
    `adapter scan found ${keysInFunctions} required()/optional() key reads inside function bodies but ` +
      `${keysInSources} in the sources — a body was not parsed, so some argument names are unenforced`,
  );
}

const sitesByCommand = new Map();
const skippedSites = { dynamicCommand: 0, notRpcApi: 0 };
const notRpcApiCommands = new Set();
for (const site of callSites) {
  if (!site.command) {
    skippedSites.dynamicCommand += 1;
    continue;
  }
  if (!dispatched.has(site.command)) {
    // Desktop-only shell commands and the channel commands are not implemented by the rpc-api
    // `dispatch`; their argument shape is owned elsewhere (Tauri command signature / WS frame).
    skippedSites.notRpcApi += 1;
    notRpcApiCommands.add(site.command);
    continue;
  }
  if (!sitesByCommand.has(site.command)) sitesByCommand.set(site.command, []);
  sitesByCommand.get(site.command).push(site);
}

let comparedCommands = 0;
let comparedSites = 0;
let comparedRequiredKeys = 0;
let comparedOptionalKeys = 0;
const comparedSkips = { noFrontendCallSite: [], noComparableCallSite: 0 };

for (const [command, rustKeys] of rustArgumentNames) {
  const sites = sitesByCommand.get(command) ?? [];
  if (sites.length === 0) {
    comparedSkips.noFrontendCallSite.push(command);
    continue;
  }
  const comparable = sites.filter((site) => site.keys !== null);
  if (comparable.length === 0) {
    comparedSkips.noComparableCallSite += sites.length;
    continue;
  }
  comparedCommands += 1;
  const exemption = new Set([...(TRANSPORT_ONLY_ARGS.get(command) ?? [])].map(toSnakeCase));
  const required = new Map([...rustKeys].filter(([, detail]) => detail.kind === 'required'));
  const optional = new Map([...rustKeys].filter(([, detail]) => detail.kind === 'optional'));
  const accepted = new Set([...required.keys(), ...optional.keys()]);
  comparedRequiredKeys += required.size;
  comparedOptionalKeys += optional.size;

  for (const site of comparable) {
    comparedSites += 1;
    const sent = new Set(site.keys.map(toSnakeCase));
    for (const key of exemption) sent.delete(key);
    const where = `${site.file}:${site.line}`;
    for (const [key, detail] of required) {
      if (!sent.has(key)) {
        errors.push(
          `command "${command}": ${where} does not send the required argument "${key}" ` +
            `(rpc-api reads it at ${detail.where}); a missing or renamed argument is dropped by the backend`,
        );
      }
    }
    for (const raw of site.keys) {
      const key = toSnakeCase(raw);
      if (exemption.has(key) || accepted.has(key)) continue;
      errors.push(
        `command "${command}": ${where} sends the argument "${raw}"` +
          (raw === key ? '' : ` (normalized "${key}")`) +
          `, which rpc-api never reads for this command (it reads: ` +
          `${[...accepted].sort().join(', ') || 'no arguments'}) — a renamed argument is silently ignored`,
      );
    }
  }
}

// ⚠ The guard that keeps this check honest: comparing nothing is a failure, not a pass. A scan
// set that collapses (moved adapters, renamed call helper, a layout change) would otherwise leave
// the whole argument contract unenforced while the gate reports success.
if (DISPATCH_TARGETS.size === 0) {
  errors.push(
    `no dispatch arms were found in ${RPC_API_SRC}/lib.rs — the argument-name contract was not checked`,
  );
}
if (frontendFiles().length === 0) {
  errors.push('no frontend source files were found under src/ — the argument-name contract was not checked');
}
if (comparedCommands === 0 || comparedSites === 0) {
  errors.push(
    `compared ${comparedCommands} command(s) / ${comparedSites} call site(s): the argument-name contract ` +
      'is enforced nowhere, so this gate must not pass. Check that the adapter scan and the frontend ' +
      'call-site scan still find their inputs',
  );
}
if (payloadArgsSet.size === 0) {
  warnings.push(
    'catalog.rs declares no PAYLOAD_ARGS: every command is compared as named arguments; verify that no ' +
      'command passes a request DTO through verbatim',
  );
}

// Coverage is printed on every run (pass or fail): a silent check and a green check are
// indistinguishable otherwise.
const withKeys = [...rustArgumentNames.values()].filter((keys) => keys.size > 0).length;
const withoutKeys = rustArgumentNames.size - withKeys;
const literalSites = callSites.filter((site) => site.command && site.keys !== null).length;
const dynamicArgumentSites = callSites.filter((site) => site.command && site.keys === null).length;

if (warnings.length) {
  console.warn(warnings.map((message) => `⚠ ${message}`).join('\n'));
}

console.log(
  [
    `argument names — rpc-api: ${DISPATCH_TARGETS.size} dispatched, ${rustArgumentNames.size} attributed ` +
      `(${withKeys} with keys, ${withoutKeys} no-argument), ${rustSkipped.payload.length} payload ` +
      `pass-through, ${rustSkipped.unattributable.length} unattributable; ` +
      `${keysInSources} required()/optional() key reads, ${keysInFunctions} inside parsed bodies, ` +
      `${REACHABLE_ADAPTER_FUNCTIONS.size} reachable adapter functions`,
    `argument names — frontend: ${callSites.length} call sites (${literalSites} with a literal argument ` +
      `object, ${dynamicArgumentSites} dynamic arguments, ${skippedSites.dynamicCommand} dynamic command name)`,
    `argument names — compared: ${comparedCommands} commands / ${comparedSites} call sites ` +
      `(${comparedRequiredKeys} required + ${comparedOptionalKeys} optional argument reads); skipped: ` +
      `${skippedSites.notRpcApi + dynamicArgumentSites} call sites (${skippedSites.notRpcApi} not on the ` +
      `rpc-api dispatch surface, ${dynamicArgumentSites} dynamic arguments), ` +
      `${comparedSkips.noFrontendCallSite.length} commands with no literal frontend call site, ` +
      `${comparedSkips.noComparableCallSite} call sites only dynamic`,
  ].join('\n'),
);
if (rustSkipped.payload.length) {
  console.log(
    `argument names — payload pass-through (catalog.rs PAYLOAD_ARGS): ${rustSkipped.payload.sort().join(', ')}`,
  );
}
for (const reason of rustSkipped.unattributable) {
  console.log(`argument names — unattributable (skipped, never assumed argument-free): ${reason}`);
}
if (comparedSkips.noFrontendCallSite.length) {
  console.log(
    `argument names — no literal frontend call site (skipped): ${comparedSkips.noFrontendCallSite.sort().join(', ')}`,
  );
}
if (notRpcApiCommands.size) {
  console.log(
    `argument names — not on the rpc-api dispatch surface (skipped, argument shape owned by the Tauri ` +
      `command signature / WS frame): ${[...notRpcApiCommands].sort().join(', ')}`,
  );
}

if (errors.length) {
  console.error(`Web exit contract check failed (${errors.length}):\n${errors.map((e) => `- ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(
  `✓ Web exit contract check passed — ${[
    `desktop shell IPC ${ipc.size}`,
    `SUPPORTED ${lists.SUPPORTED.length}`,
    `PENDING ${lists.PENDING.length}`,
    `DESKTOP_ONLY ${lists.DESKTOP_ONLY.length}`,
    `CHANNEL ${lists.CHANNEL.length}`,
    `frontend calls ${frontend.size}`,
    `exit leaks ${leaks.length}`,
  ].join(' / ')}; argument names compared for ${comparedCommands} commands / ${comparedSites} call sites`,
);
