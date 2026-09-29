//! 内置字体的署名与许可声明 — 单一权威来源
//!
//! 每个随包字体的许可原文在 `src/assets/fonts/*-LICENSE.txt`, `@font-face` 声明在
//! `src/styles/theme.css`。本模块把这些声明汇总成 UI 可消费的唯一出口 (About 弹窗),
//! 新增内置字体时先在此登记, 再同步 theme.css 与许可文件。

export interface FontAttribution {
  /// 随包 @font-face 的 family 名 — 必须与 theme.css 中的声明一致
  family: string;
  /// 许可简称
  license: string;
  /// 版权方 / 上游补丁来源
  copyright: string;
}

/// 全部随应用分发的字体族; 顺序与 theme.css 中 @font-face 的登场顺序一致
export const FONT_ATTRIBUTIONS: readonly FontAttribution[] = [
  {
    family: 'FiraCode Nerd Font Mono',
    license: 'SIL OFL 1.1',
    copyright: '© The Fira Code Project Authors; Nerd Fonts patch MIT',
  },
  {
    family: 'GoMono Nerd Font Mono',
    license: 'BSD-3-Clause',
    copyright: '© 2016 Bigelow & Holmes Inc.; Nerd Fonts patch MIT',
  },
  {
    family: 'MiSans',
    license: 'MiSans Font License',
    copyright: '© 2020-2025 Beijing Xiaomi Mobile Software Co., Ltd.',
  },
  {
    family: 'Maple Mono CN',
    license: 'SIL OFL 1.1',
    copyright: '© 2022 The Maple Mono Project Authors',
  },
  {
    family: 'JetBrains Mono',
    license: 'SIL OFL 1.1',
    copyright: '© JetBrains',
  },
];
