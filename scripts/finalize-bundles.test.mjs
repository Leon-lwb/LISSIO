import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverInstallers, finalizeBundles, finalizeInstallers, hashFile, readIntegrity, setMediumIntegrity } from './finalize-bundles.mjs';

let scratch;
let source;
let labels;
const medium = 'S-1-16-8192';
const low = 'S-1-16-4096';
const inspect = (paths) => ({ processSid: medium, paths: paths.map((path) => ({ path, sid: labels.get(path) ?? medium })) });
const repair = (path) => labels.set(path, medium);

beforeEach(() => {
  mkdirSync('output', { recursive: true });
  scratch = mkdtempSync(resolve('output', 'bundle-finalization-test-'));
  source = join(scratch, 'Lissio_0.8.0_x64-setup.exe');
  writeFileSync(source, Buffer.from([0, 255, 128, 13, 10, 0]));
  labels = new Map([[source, low]]);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (!scratch.startsWith(resolve('output') + sep)) throw new Error('Unexpected test scratch path');
  rmSync(scratch, { recursive: true, force: true });
});

describe('in-place Windows bundle finalization', () => {
  it('repairs Low integrity without copying or changing installer bytes', async () => {
    const before = readFileSync(source);
    const result = await finalizeInstallers([source], inspect, repair);
    expect(result).toEqual([{ path: source, sha256: await hashFile(source), sid: medium }]);
    expect(readFileSync(source)).toEqual(before);
    expect(readdirSync(scratch)).toEqual(['Lissio_0.8.0_x64-setup.exe']);
  });

  it('leaves a ready installer alone across repeated builds', async () => {
    const setMedium = vi.fn(repair);
    await finalizeInstallers([source], inspect, setMedium);
    await finalizeInstallers([source], inspect, setMedium);
    expect(setMedium).toHaveBeenCalledTimes(1);
  });

  it.each([medium, 'S-1-16-12288'])('preserves an existing %s label', async (sid) => {
    labels.set(source, sid);
    const setMedium = vi.fn();
    const result = await finalizeInstallers([source], inspect, setMedium);
    expect(result[0].sid).toBe(sid);
    expect(setMedium).not.toHaveBeenCalled();
  });

  it('rejects Low processes before changing a file label', async () => {
    const setMedium = vi.fn();
    await expect(finalizeInstallers([source], () => ({ processSid: low }), setMedium)).rejects.toThrow(low);
    expect(setMedium).not.toHaveBeenCalled();
  });

  it('reports permission errors and unsuccessful label changes', async () => {
    await expect(finalizeInstallers([source], inspect, () => { throw new Error('Access denied'); })).rejects.toThrow('Access denied');
    await expect(finalizeInstallers([source], inspect, () => {})).rejects.toThrow('Installer still has');
  });

  it('detects unexpected byte changes during repair', async () => {
    await expect(finalizeInstallers([source], inspect, (path) => {
      repair(path);
      writeFileSync(path, 'changed bytes');
    })).rejects.toThrow('Installer bytes changed');
  });

  it('rejects missing installers and directories', async () => {
    await expect(finalizeInstallers([], inspect, repair)).rejects.toThrow('No current-version');
    await expect(finalizeInstallers([scratch], inspect, repair)).rejects.toThrow('regular file');
  });

  it('finds only the current-version NSIS and MSI in their original folders', () => {
    for (const [kind, names] of [['nsis', ['Lissio_0.8.0_x64-setup.exe', 'Lissio_0.8.0_x64-setup.exe.sig', 'Lissio_0.7.2_x64-setup.exe']],
      ['msi', ['Lissio_0.8.0_x64_en-US.msi', 'Other_0.8.0_x64_en-US.msi']]]) {
      mkdirSync(join(scratch, kind));
      for (const name of names) writeFileSync(join(scratch, kind, name), 'bundle');
    }
    expect(discoverInstallers(scratch, 'Lissio', '0.8.0')).toEqual([
      join(scratch, 'nsis', 'Lissio_0.8.0_x64-setup.exe'), join(scratch, 'msi', 'Lissio_0.8.0_x64_en-US.msi'),
    ]);
  });

  it.each(['linux', 'darwin'])('skips Windows finalization on %s', async (platform) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await finalizeBundles(platform)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    expect(readdirSync(scratch)).toEqual(['Lissio_0.8.0_x64-setup.exe']);
  });

  it.skipIf(process.platform !== 'win32')('repairs a real file with a Unicode name and reads numeric SIDs', async () => {
    const path = join(scratch, '中文 with spaces.exe');
    writeFileSync(path, 'test');
    const before = await hashFile(path);
    const processInfo = readIntegrity([]);
    const info = readIntegrity([path]);
    expect(processInfo).toEqual({ processSid: info.processSid, paths: [] });
    setMediumIntegrity(path);
    expect(readIntegrity([path]).paths).toEqual([{ path, sid: medium }]);
    expect(await hashFile(path)).toBe(before);
  });
});
