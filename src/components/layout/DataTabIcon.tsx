// ============ 数据 Tab 图标 ============
//
// 图标来源 = 数据面板注册表 (`components/panels/registry/panelDefs`), 含 12 个数据
// 面板与 5 个应用外壳; 本模块不再维护自己的 switch, 也不与侧边栏图标表分家。
//
// tab 类型经 DockCardFrame 传入时已被擦除为 string, 未知类型不渲染图标 (注册表
// 查询本身对未知输入返回 null)。

import { panelIconForTabType } from '../panels/registry/panelDefs';
import type { DataTabType } from '../../types';

/// 数据 Tab 图标 (按类型)
export function DataTabIcon({ type, size = 12 }: { type: string; size?: number }) {
  const Icon = panelIconForTabType(type as DataTabType);
  return Icon ? <Icon size={size} /> : null;
}
