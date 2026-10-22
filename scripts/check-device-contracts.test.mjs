import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildManifest,
  checkManifest,
  CONTRACT_FILES,
  CONTRACT_TAG,
  hashFile,
  MANIFEST_PATH,
  MANIFEST_VERSION,
  SCOPE_ROOTS,
} from './check-device-contracts.mjs';

const scriptPath = fileURLToPath(new URL('./check-device-contracts.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtures = [];

/**
 * A checkout-shaped fixture: every frozen path exists with distinct content, so
 * an `--update` here exercises the real freeze list without touching the
 * repository under test.
 */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'device-contracts-'));
  fixtures.push(root);
  for (const [index, { path }] of CONTRACT_FILES.entries()) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `fixture ${index} for ${path}\n`);
  }
  return root;
}

function runCli(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
}

function outputOf(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

describe('hashFile', () => {
  it('hashes bytes with SHA-256', () => {
    const root = mkdtempSync(join(tmpdir(), 'device-contracts-hash-'));
    fixtures.push(root);
    writeFileSync(join(root, 'hello.txt'), 'hello\n');

    expect(hashFile(root, 'hello.txt')).toBe(
      '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03',
    );
  });

  it('throws a descriptive error for a missing file', () => {
    const root = mkdtempSync(join(tmpdir(), 'device-contracts-hash-'));
    fixtures.push(root);

    expect(() => hashFile(root, 'absent.rs')).toThrow(/absent\.rs/);
  });
});

describe('buildManifest', () => {
  it('covers every frozen path with the v1 tag and version', () => {
    const manifest = buildManifest(fixtureRoot());

    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.tag).toBe(CONTRACT_TAG);
    expect(manifest.files.map((row) => row.path)).toEqual(CONTRACT_FILES.map((file) => file.path));
    expect(manifest.files.map((row) => row.owner)).toEqual(CONTRACT_FILES.map((file) => file.owner));
    for (const row of manifest.files) expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const root = fixtureRoot();

    expect(buildManifest(root)).toEqual(buildManifest(root));
  });
});

describe('checkManifest', () => {
  it('accepts a freshly built manifest', () => {
    const root = fixtureRoot();

    expect(checkManifest(root, buildManifest(root))).toEqual([]);
  });

  it('reports sha256 drift for a changed file', () => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    const target = CONTRACT_FILES[0].path;
    writeFileSync(join(root, target), 'changed after the freeze\n');

    const problems = checkManifest(root, manifest);
    expect(problems.some((problem) => problem.includes(target) && problem.includes('drift'))).toBe(
      true,
    );
  });

  it('reports a listed file that was deleted', () => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    const target = CONTRACT_FILES[1].path;
    rmSync(join(root, target));

    const problems = checkManifest(root, manifest);
    expect(problems.some((problem) => problem.includes(target))).toBe(true);
  });

  it('reports a frozen file missing from the manifest', () => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    const target = CONTRACT_FILES[2].path;
    manifest.files = manifest.files.filter((row) => row.path !== target);

    const problems = checkManifest(root, manifest);
    expect(
      problems.some(
        (problem) => problem.includes(target) && problem.includes('missing from the manifest'),
      ),
    ).toBe(true);
  });

  it('reports a manifest row that is not in the freeze list', () => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    const target = 'server/core/crates/shared/wire/src/extra.rs';
    manifest.files.push({ path: target, sha256: 'a'.repeat(64), owner: 'W0a' });

    const problems = checkManifest(root, manifest);
    expect(
      problems.some((problem) => problem.includes(target) && problem.includes('not in the freeze list')),
    ).toBe(true);
  });

  it('reports an owner that differs from the freeze list', () => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    const target = CONTRACT_FILES[3].path;
    manifest.files.find((row) => row.path === target).owner = 'W1';

    const problems = checkManifest(root, manifest);
    expect(problems.some((problem) => problem.includes(target) && problem.includes('owner'))).toBe(
      true,
    );
  });

  it.each([
    ['63 hex characters', 'a'.repeat(63)],
    ['uppercase hex', 'A'.repeat(64)],
  ])('reports a sha256 with %s', (_, value) => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    const target = CONTRACT_FILES[4].path;
    manifest.files.find((row) => row.path === target).sha256 = value;

    const problems = checkManifest(root, manifest);
    expect(
      problems.some((problem) => problem.includes(target) && problem.includes('hexadecimal')),
    ).toBe(true);
  });

  it('reports a row outside the scope roots', () => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    const target = 'scripts/check-device-contracts.mjs';
    manifest.files[0].path = target;

    const problems = checkManifest(root, manifest);
    expect(
      problems.some((problem) => problem.includes(target) && problem.includes('scope')),
    ).toBe(true);
  });

  it('reports a duplicate row', () => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    manifest.files.push({ ...manifest.files[0] });

    const problems = checkManifest(root, manifest);
    expect(
      problems.some(
        (problem) => problem.includes(CONTRACT_FILES[0].path) && problem.includes('duplicate'),
      ),
    ).toBe(true);
  });

  it('reports a manifest version and tag from another contract version', () => {
    const root = fixtureRoot();
    const manifest = buildManifest(root);
    manifest.version = 2;
    manifest.tag = 'device-contracts-v2';

    const problems = checkManifest(root, manifest);
    expect(problems.some((problem) => problem.includes('version'))).toBe(true);
    expect(problems.some((problem) => problem.includes('tag'))).toBe(true);
  });
});

describe('CLI guards', () => {
  it('refuses --update without --message and writes nothing', () => {
    const root = fixtureRoot();
    const result = runCli('--update', `--root=${root}`);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('contract:');
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(false);
  });

  it('refuses --update with a non-contract subject and writes nothing', () => {
    const root = fixtureRoot();
    const result = runCli('--update', '--message', 'feat: refresh', `--root=${root}`);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('contract:');
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(false);
  });

  it('refuses --check together with --update', () => {
    const result = runCli('--check', '--update');

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('usage:');
  });

  it('refuses an unknown argument', () => {
    const result = runCli('--bogus');

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('usage:');
  });
});

describe('CLI check and update', () => {
  it('writes a manifest that --check then accepts', () => {
    const root = fixtureRoot();

    const update = runCli('--update', '--message', 'contract: freeze fixture', `--root=${root}`);
    expect(update.status).toBe(0);
    expect(update.stdout).toContain('device contracts updated (21 files)');
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(true);

    const check = runCli('--check', `--root=${root}`);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain(
      `check:device-contracts passed (21 frozen files, tag ${CONTRACT_TAG})`,
    );
  });

  it('fails --check and names the file after a post-update edit', () => {
    const root = fixtureRoot();
    expect(runCli('--update', '--message', 'contract: freeze fixture', `--root=${root}`).status).toBe(0);

    const target = CONTRACT_FILES[5].path;
    writeFileSync(join(root, target), 'edited after the update\n');
    const check = runCli('--check', `--root=${root}`);

    expect(check.status).toBe(1);
    expect(outputOf(check)).toContain(target);
  });

  it('pins the committed manifest to the committed files', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, MANIFEST_PATH), 'utf8'));

    expect(checkManifest(repoRoot, manifest)).toEqual([]);
  });
});

describe('freeze list', () => {
  it('keeps every frozen path inside the declared scope roots', () => {
    for (const { path } of CONTRACT_FILES) {
      expect(
        SCOPE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`)),
        `${path} is outside ${SCOPE_ROOTS.join(', ')}`,
      ).toBe(true);
    }
  });
});
