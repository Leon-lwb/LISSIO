//! 亚克力背板材料模型 — 主题色调、反档判定与补偿后的 alpha。
//!
//! 这里是 Windows 背板"系统材料压不住应用主题"这条结论的唯一实现:
//! 前端只消费补偿后的 alpha, 因此边界值必须钉在测试里, 而不是靠真机观感调。

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACRYLIC_BASE_OPACITY,
  MATERIAL_MISMATCH_COMPENSATION,
  acrylicTokenAlpha,
  hostBorrowsSystemMaterial,
  isDarkBackground,
  materialMismatchesTheme,
  parseHexColor,
} from '../acrylicMaterial';

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
  delete (window.navigator as unknown as Record<string, unknown>).userAgent;
  stubSystemDark(false);
});

describe('parseHexColor', () => {
  it('解析 6 位与 3 位十六进制, 大小写无关', () => {
    expect(parseHexColor('#0d1016')).toEqual([13, 16, 22]);
    expect(parseHexColor('#F0F0F0')).toEqual([240, 240, 240]);
    expect(parseHexColor('#abc')).toEqual([170, 187, 204]);
  });

  it('非 hex 输入返回 null — 交给调用方降级, 不猜颜色', () => {
    expect(parseHexColor('var(--color-bg-window)')).toBeNull();
    expect(parseHexColor('rgba(13, 16, 22, 0.5)')).toBeNull();
    expect(parseHexColor('#0d101')).toBeNull();
  });
});

describe('isDarkBackground', () => {
  it('按相对亮度区分内置主题的窗口底色', () => {
    expect(isDarkBackground('#0d1016')).toBe(true);
    expect(isDarkBackground('#111519')).toBe(true);
    expect(isDarkBackground('#f0f0f0')).toBe(false);
  });

  it('取不到颜色时用 fallback — 深色是应用默认主题', () => {
    expect(isDarkBackground('color-mix(in srgb, black, white)')).toBe(true);
    expect(isDarkBackground('color-mix(in srgb, black, white)', false)).toBe(false);
  });
});

describe('materialMismatchesTheme', () => {
  it('只在系统档与应用主题相反时为真', () => {
    stubSystemDark(false);
    expect(materialMismatchesTheme('#0d1016')).toBe(true);
    stubSystemDark(true);
    expect(materialMismatchesTheme('#0d1016')).toBe(false);
    expect(materialMismatchesTheme('#f0f0f0')).toBe(true);
  });
});

describe('hostBorrowsSystemMaterial', () => {
  it('只有 Windows 需要补偿 (macOS 待真机验证后才纳入)', () => {
    setUserAgent(WINDOWS_UA);
    expect(hostBorrowsSystemMaterial()).toBe(true);
    setUserAgent(MACOS_UA);
    expect(hostBorrowsSystemMaterial()).toBe(false);
  });
});

describe('acrylicTokenAlpha', () => {
  it('基线档位原样返回 token 的基准透明度', () => {
    expect(acrylicTokenAlpha(0.5, ACRYLIC_BASE_OPACITY, false)).toBe(0.5);
    expect(acrylicTokenAlpha(0.65, ACRYLIC_BASE_OPACITY, false)).toBe(0.65);
  });

  it('补偿把 alpha 推向不透明, 但不改变层级顺序', () => {
    const window = acrylicTokenAlpha(0.5, ACRYLIC_BASE_OPACITY, true);
    const sidebar = acrylicTokenAlpha(0.65, ACRYLIC_BASE_OPACITY, true);
    // 0.5 + 0.5 * 0.65 = 0.825; 0.65 + 0.35 * 0.65 = 0.8775
    expect(window).toBe(0.825);
    expect(sidebar).toBe(0.8775);
    // 窗口底色仍然比面板头更透 —— 补偿是凸组合, 不是把所有 token 抬到同一个下限
    expect(window).toBeLessThan(sidebar);
    expect(window).toBeLessThan(1);
    expect(MATERIAL_MISMATCH_COMPENSATION).toBeGreaterThan(0);
  });

  it('透明度设置被夹在 0.1-1.0, 且浮点尾数被收敛到 1e-4', () => {
    expect(acrylicTokenAlpha(0.5, 0, false)).toBe(0.0833);
    expect(acrylicTokenAlpha(0.6, 1, true)).toBe(1);
    expect(acrylicTokenAlpha(0.6, 2, true)).toBe(1);
  });
});
