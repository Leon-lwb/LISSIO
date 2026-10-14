import { describe, expect, it } from 'vitest';
import {
  deriveConfigGuideDefaults,
  needsConfigGuide,
  settingsReady,
} from '../configGuide';
import type { ConfigGuideSources } from '../../../settings/configGuideSources';

const FRESH: ConfigGuideSources = { document: 'absent', language: 'default', theme: 'default' };
const UPGRADE: ConfigGuideSources = { document: 'present', language: 'stored', theme: 'stored' };

describe('settingsReady', () => {
  it('requires both a settled load and no read error', () => {
    expect(settingsReady({ loaded: false, loadError: null })).toBe(false);
    expect(settingsReady({ loaded: true, loadError: 'boom' })).toBe(false);
    expect(settingsReady({ loaded: true, loadError: null })).toBe(true);
  });
});

describe('needsConfigGuide', () => {
  const base = {
    settingsLoaded: true,
    sources: FRESH,
    lastSeenVersion: null,
    showConfigGuide: false,
    remoteConfigGuide: false,
  };

  it('appears on a fresh installation only', () => {
    expect(needsConfigGuide(base)).toBe(true);
    // 升级安装带着文档进来 → 默认不受打扰
    expect(needsConfigGuide({ ...base, sources: UPGRADE })).toBe(false);
    // 全新安装但已确认过 (本次会话内) → 不再出现
    expect(needsConfigGuide({ ...base, lastSeenVersion: '0.8.0' })).toBe(false);
  });

  it('is forced by the preview switch and by the remote entry', () => {
    expect(needsConfigGuide({ ...base, sources: UPGRADE, showConfigGuide: true })).toBe(true);
    expect(needsConfigGuide({ ...base, sources: UPGRADE, remoteConfigGuide: true })).toBe(true);
  });

  it('never opens before a successful read', () => {
    expect(
      needsConfigGuide({ ...base, settingsLoaded: false, showConfigGuide: true })
    ).toBe(false);
    expect(
      needsConfigGuide({
        ...base,
        settingsLoaded: settingsReady({ loaded: true, loadError: 'corrupt' }),
        showConfigGuide: true,
      })
    ).toBe(false);
  });
});

describe('deriveConfigGuideDefaults', () => {
  it('preselects English when the user never chose a language', () => {
    expect(
      deriveConfigGuideDefaults({
        sources: FRESH,
        storedLanguage: 'zh',
        storedTheme: 'dark',
        prefersLight: false,
      })
    ).toEqual({
      language: 'en',
      theme: 'dark',
      sources: { document: 'absent', language: 'default', theme: 'default' },
    });
  });

  it('inherits stored values and lets no system preference override them', () => {
    expect(
      deriveConfigGuideDefaults({
        sources: UPGRADE,
        storedLanguage: 'zh',
        storedTheme: 'my-custom',
        prefersLight: true,
      })
    ).toEqual({
      language: 'zh',
      theme: 'my-custom',
      sources: { document: 'present', language: 'stored', theme: 'stored' },
    });
  });

  it('follows the system appearance preference for an unstored theme', () => {
    expect(
      deriveConfigGuideDefaults({
        sources: FRESH,
        storedLanguage: 'zh',
        storedTheme: 'dark',
        prefersLight: true,
      })
    ).toEqual({
      language: 'en',
      theme: 'light',
      sources: { document: 'absent', language: 'default', theme: 'system' },
    });
  });

  it('judges the two fields independently', () => {
    expect(
      deriveConfigGuideDefaults({
        sources: { document: 'present', language: 'default', theme: 'stored' },
        storedLanguage: 'zh',
        storedTheme: 'light',
        prefersLight: false,
      })
    ).toEqual({
      language: 'en',
      theme: 'light',
      sources: { document: 'present', language: 'default', theme: 'stored' },
    });
  });
});
