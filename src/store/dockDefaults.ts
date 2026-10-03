import type { DockCard, DockNode } from './dockTree';

export const defaultCards: Record<string, DockCard> = {
  'control-main': { id: 'control-main', kind: 'control', tabIds: [], activeTabId: null },
  // data-main 预置两个 fixed tab — reconcile 会裁剪空数据卡 (有同 kind 兄弟时,
  // 空卡会让布局塌陷); 安置无家可归 tab 时跳过属性专属卡 (isPropertiesCard),
  // properties-main 只承载属性面板
  'data-main': {
    id: 'data-main',
    kind: 'data',
    tabIds: ['compile-errors-fixed', 'compile-results-fixed'],
    activeTabId: 'compile-results-fixed',
  },
  // 节点属性面板专属卡 — 承载固定的 node-properties-fixed tab (较小, 常驻右上)
  'properties-main': {
    id: 'properties-main',
    kind: 'data',
    tabIds: ['node-properties-fixed'],
    activeTabId: 'node-properties-fixed',
  },
};

/// 默认布局: 上方左侧画布 | 右侧属性面板 (较小), 下方数据面板
export const defaultRoot: DockNode = {
  id: 'split-root',
  type: 'split',
  dir: 'col',
  children: [
    {
      id: 'split-top',
      type: 'split',
      dir: 'row',
      children: [
        { id: 'node-control', type: 'card', cardId: 'control-main' },
        { id: 'node-props', type: 'card', cardId: 'properties-main' },
      ],
      sizes: [72, 28],
    },
    { id: 'node-data', type: 'card', cardId: 'data-main' },
  ],
  sizes: [55, 45],
};

/// 属性卡净化 — 供 persist v3 迁移与备份导入复用, 保证属性 tab 独占画布右侧小卡:
/// - prop 为卡内首位且同卡混有其他 tab (旧版 reconcile 把新 tab 塞进属性卡的污染)
///   → 其他 tab 逐出到另一张 data 卡 (无则新建底部卡), prop 独占原卡
/// - prop 混在其他数据卡内 (非首位, 用户手动合并) → prop 拆出为画布右侧专属
///   小卡 (insertRightOfCard), 原卡不动; 无画布卡时兜底 col split [70, 30]
