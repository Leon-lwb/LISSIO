import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG_GUIDE_SOURCES,
  readConfigGuideSources,
} from '../configGuideSources';

describe('readConfigGuideSources', () => {
  it('treats a missing document as a fresh installation', () => {
    expect(readConfigGuideSources(null)).toEqual(DEFAULT_CONFIG_GUIDE_SOURCES);
    expect(readConfigGuideSources(undefined)).toEqual(DEFAULT_CONFIG_GUIDE_SOURCES);
    expect(readConfigGuideSources([1, 2])).toEqual(DEFAULT_CONFIG_GUIDE_SOURCES);
    expect(readConfigGuideSources('app')).toEqual(DEFAULT_CONFIG_GUIDE_SOURCES);
  });

  it('marks a document as present even before it carries a value', () => {
    // 后端对缺失文件返回 {} → app 缺失 → null; 存在 app 对象则是升级安装。
    expect(readConfigGuideSources({})).toEqual({
      document: 'present',
      language: 'default',
      theme: 'default',
    });
    expect(readConfigGuideSources({ general: { debug: true } }).document).toBe('present');
  });

  it('recognizes current-format fields as stored', () => {
    expect(
      readConfigGuideSources({ general: { language: 'en' }, appearance: { theme: 'monet' } })
    ).toEqual({ document: 'present', language: 'stored', theme: 'stored' });
  });

  it('judges each field independently', () => {
    expect(readConfigGuideSources({ general: { language: 'zh' } })).toEqual({
      document: 'present',
      language: 'stored',
      theme: 'default',
    });
    expect(readConfigGuideSources({ appearance: { theme: 'light' } })).toEqual({
      document: 'present',
      language: 'default',
      theme: 'stored',
    });
  });

  it('rejects unsupported languages and mistyped values', () => {
    expect(readConfigGuideSources({ general: { language: 'ja' } }).language).toBe('default');
    expect(readConfigGuideSources({ general: { language: 42 } }).language).toBe('default');
    expect(readConfigGuideSources({ appearance: { theme: '' } }).theme).toBe('default');
    expect(readConfigGuideSources({ appearance: { theme: null } }).theme).toBe('default');
  });

  it('ignores non-object sections', () => {
    expect(readConfigGuideSources({ general: 'zh', appearance: [] })).toEqual({
      document: 'present',
      language: 'default',
      theme: 'default',
    });
  });
});
