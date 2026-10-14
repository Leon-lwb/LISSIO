//! 宿主探测 — Windows UA 与系统亮暗档。
//!
//! 两个判断都不该有第二份实现: Windows 自定义菜单栏与亚克力背板补偿共用这里。
//! jsdom 的 navigator.userAgent 就不是 Windows, matchMedia 由 setup.ts 桩成浅档,
//! 因此每个用例显式覆盖自己关心的那一维。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostPrefersDark, isWindowsHost } from '../host';

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lissio/0.9.0';
const MACOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Lissio/0.9.0';

function setUserAgent(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
}

function stubSystemDark(dark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  // userAgent 原本定义在 Navigator.prototype 上 — 删掉实例覆盖即可还原
  delete (window.navigator as unknown as Record<string, unknown>).userAgent;
  stubSystemDark(false);
});

describe('isWindowsHost', () => {
  it('识别 Windows UA', () => {
    setUserAgent(WINDOWS_UA);
    expect(isWindowsHost()).toBe(true);
  });

  it('不把 macOS / Linux 当成 Windows', () => {
    setUserAgent(MACOS_UA);
    expect(isWindowsHost()).toBe(false);
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) Lissio/0.9.0');
    expect(isWindowsHost()).toBe(false);
  });
});

describe('hostPrefersDark', () => {
  it('跟随宿主的 prefers-color-scheme', () => {
    stubSystemDark(true);
    expect(hostPrefersDark()).toBe(true);
    stubSystemDark(false);
    expect(hostPrefersDark()).toBe(false);
  });

  it('没有 matchMedia 时按暗档回落', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(hostPrefersDark()).toBe(true);
    expect(hostPrefersDark(false)).toBe(false);
  });
});
