//! applyAppearance 的亚克力出口契约。
//!
//! 覆盖的是三件真机上很难复现的事:
//!   1. 背景 token 的半透明化数值 (含系统材料反档时的补偿);
//!   2. 调色板原生边框档位与材料 tint 是否跟着应用主题走 (set_window_acrylic 参数);
//!   3. 关闭亚克力时把内联的半透明值还原成主题原色, 不留上一次的 rgba 残留。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../test/setup';
import { applyAppearance } from '../applyTheme';
import { DEFAULT_SETTINGS } from '../defaults';
import type { AppSettings } from '../defaults';

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lissio/0.9.0';
const MACOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Lissio/0.9.0';

type Appearance = AppSettings['appearance'];

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

function appearance(overrides: Partial<Appearance> = {}): Appearance {
  return { ...DEFAULT_SETTINGS.appearance, ...overrides };
}

/// 最近一次 set_window_acrylic 的参数 — 命令在每次应用外观时都会发。
function lastAcrylicArgs(): Record<string, unknown> | undefined {
  const calls = tauriMock.invoke.mock.calls.filter(([cmd]) => cmd === 'set_window_acrylic');
  return calls.length === 0 ? undefined : calls[calls.length - 1][1];
}

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

beforeEach(() => {
  tauriMock.invoke.mockClear();
});

afterEach(() => {
  delete (window.navigator as unknown as Record<string, unknown>).userAgent;
  stubSystemDark(false);
  applyAppearance(DEFAULT_SETTINGS.appearance);
});

describe('亚克力背景 token', () => {
  it('默认档位 (acrylicOpacity = 0.6) 与 token 基准透明度一致', () => {
    setUserAgent(MACOS_UA);
    applyAppearance(appearance());
    expect(cssVar('--color-bg-window')).toBe('rgba(13, 16, 22, 0.5)');
    expect(cssVar('--color-bg-sidebar')).toBe('rgba(27, 31, 38, 0.65)');
    expect(cssVar('--color-bg-editor')).toBe('rgba(20, 23, 31, 0.55)');
  });

  it('Windows 上系统材料与应用主题反档时抬高覆盖率', () => {
    setUserAgent(WINDOWS_UA);
    stubSystemDark(false);
    applyAppearance(appearance());
    expect(cssVar('--color-bg-window')).toBe('rgba(13, 16, 22, 0.825)');
    expect(cssVar('--color-bg-sidebar')).toBe('rgba(27, 31, 38, 0.8775)');
  });

  it('反档只在需要补偿的宿主上生效 — macOS 保持原观感', () => {
    setUserAgent(MACOS_UA);
    stubSystemDark(false);
    applyAppearance(appearance());
    expect(cssVar('--color-bg-window')).toBe('rgba(13, 16, 22, 0.5)');
  });

  it('Windows 上系统档与应用主题一致时不补偿', () => {
    setUserAgent(WINDOWS_UA);
    stubSystemDark(true);
    applyAppearance(appearance());
    expect(cssVar('--color-bg-window')).toBe('rgba(13, 16, 22, 0.5)');
  });

  it('关闭亚克力时还原主题原色, 清掉历史 rgba', () => {
    setUserAgent(WINDOWS_UA);
    stubSystemDark(false);
    applyAppearance(appearance());
    expect(cssVar('--color-bg-window')).toBe('rgba(13, 16, 22, 0.825)');

    applyAppearance(appearance({ acrylicBackground: false }));
    expect(cssVar('--color-bg-window')).toBe('#0d1016');
    expect(document.documentElement.dataset.acrylic).toBeUndefined();
  });
});

describe('原生窗口主题与材料 tint', () => {
  it('把应用主题档位与窗口底色交给原生侧', () => {
    applyAppearance(appearance());
    expect(lastAcrylicArgs()).toEqual({
      enabled: true,
      dark: true,
      tint: [13, 16, 22],
    });
  });

  it('关闭亚克力也同步档位 — 原生边框不该停在系统档上', () => {
    applyAppearance(appearance({ theme: 'light', acrylicBackground: false }));
    expect(lastAcrylicArgs()).toEqual({
      enabled: false,
      dark: false,
      tint: [240, 240, 240],
    });
  });
});
