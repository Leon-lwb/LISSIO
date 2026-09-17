//! Web 实现 — 保存文件名 / 文件句柄往返 / 下载触发。
//!
//! 直接构造 `webPlatform` (而非改 `__TAURI_INTERNALS__` 全局), 这样判定的
//! 桌面分支不受影响, Web 分支也能独立驱动。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeDownloadName, webPlatform } from '../web';

/// jsdom 不实现对象 URL — 就地补上, 测试结束恢复。
const urlApi = URL as unknown as {
  createObjectURL: (value: Blob) => string;
  revokeObjectURL: (url: string) => void;
};
const originalCreateObjectURL = urlApi.createObjectURL;
const originalRevokeObjectURL = urlApi.revokeObjectURL;

function createFileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('openFile 未挂载隐藏的 file input');
  return input;
}

describe('webPlatform.saveFile', () => {
  it('取 defaultPath 的 basename 作为文件名', async () => {
    await expect(webPlatform.saveFile({ defaultPath: '/tmp/exports/backup.json' }))
      .resolves.toBe('backup.json');
  });

  it('Windows 反斜杠路径同样只取 basename', async () => {
    await expect(webPlatform.saveFile({ defaultPath: 'C:\\Users\\me\\notes.md' }))
      .resolves.toBe('notes.md');
  });

  it('缺省 / 空名回退 download.txt', async () => {
    await expect(webPlatform.saveFile({})).resolves.toBe('download.txt');
    await expect(webPlatform.saveFile({ defaultPath: '   ' })).resolves.toBe('download.txt');
  });

  it('sanitizeDownloadName 是纯函数', () => {
    expect(sanitizeDownloadName('a/b/c.csv')).toBe('c.csv');
    expect(sanitizeDownloadName('a/b/')).toBe('download.txt');
    expect(sanitizeDownloadName(undefined)).toBe('download.txt');
  });
});

describe('webPlatform.openFile', () => {
  it('单选返回不透明句柄, 可读回文本与字节', async () => {
    const pending = webPlatform.openFile({ multiple: false });
    const input = createFileInput();
    const file = new File(['hello 世界'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    const handle = await pending;
    expect(typeof handle).toBe('string');
    if (typeof handle !== 'string') throw new Error('expected single handle');
    expect(handle).toMatch(/^browser-file:\d+$/);

    await expect(webPlatform.readTextFile(handle)).resolves.toBe('hello 世界');
    const bytes = await webPlatform.readBinaryFile(handle);
    await expect(new Blob([bytes]).text()).resolves.toBe('hello 世界');
  });

  it('多选返回句柄数组, 各自可读', async () => {
    const pending = webPlatform.openFile({ multiple: true });
    const input = createFileInput();
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));

    const handles = await pending;
    expect(Array.isArray(handles)).toBe(true);
    if (!Array.isArray(handles)) throw new Error('expected handles');
    await expect(webPlatform.readTextFile(handles[0])).resolves.toBe('a');
    await expect(webPlatform.readTextFile(handles[1])).resolves.toBe('b');
  });

  it('用户取消返回 null', async () => {
    const pending = webPlatform.openFile({ multiple: false });
    createFileInput().dispatchEvent(new Event('cancel'));
    await expect(pending).resolves.toBeNull();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it('未知句柄抛出可读错误', async () => {
    await expect(webPlatform.readTextFile('browser-file:999999'))
      .rejects.toThrow(/未知的浏览器文件句柄/);
    await expect(webPlatform.readBinaryFile('browser-file:999999'))
      .rejects.toThrow(/未知的浏览器文件句柄/);
  });
});

describe('webPlatform.writeTextFile (浏览器下载)', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-download');
  const revokeObjectURL = vi.fn((_url: string) => undefined);

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    urlApi.createObjectURL = createObjectURL;
    urlApi.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    urlApi.createObjectURL = originalCreateObjectURL;
    urlApi.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('创建 Blob + 临时 <a download> 点击下载, 下一拍 revoke', async () => {
    // 点击时锚点仍在 DOM — 借此捕获下载文件名 (函数随后会移除它)
    let downloadName: string | null = null;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      downloadName = document.querySelector('a[download]')?.getAttribute('download') ?? null;
    });

    await webPlatform.writeTextFile('/exports/record.csv', 'a,b\n1,2\n');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await expect(createObjectURL.mock.calls[0][0].text()).resolves.toBe('a,b\n1,2\n');
    expect(createObjectURL.mock.calls[0][0].type).toBe('text/plain;charset=utf-8');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe('record.csv');
    // 锚点不能留在 DOM 里
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    // 对象 URL 留到下一拍才释放 (同步 revoke 会取消下载)
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-download');
  });
});

describe('webPlatform.exitApp', () => {
  it('浏览器无退出能力 — 告警并 resolve', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(webPlatform.exitApp()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
