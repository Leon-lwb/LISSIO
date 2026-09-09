import type { ReactNode } from 'react';
import type { PaletteCategoryId, WidgetCategory } from '../../../types';
import type { DeviceCardModel } from '../../../lib/acquisition/deviceCardModel';
import type { WidgetConfig, MathOp, StrOp, FilterPresetKind } from '../../../types';

/// 面板项统一模型 — 各分类项归一成同构条目, 渲染走同一套行样式
export interface PaletteEntry {
  key: string;
  kind?: WidgetConfig['kind'];
  icon: ReactNode;
  label: string;
  /// 操作变体 — Math 用 MathOp, Str 用 StrOp (按 kind 区分)
  op?: MathOp | StrOp;
  preset?: FilterPresetKind;
  /// 结构节点条目: 设备 / 协议 / 点位选择
  nodeType?: 'protocol' | 'acquisition' | 'point-selector';
  attribute?: 'test-data';
  acquisition?: DeviceCardModel;
  onAdd?: () => void;
  title: string;
}

export interface PaletteSection {
  id: PaletteCategoryId;
  header: string;
  /// 行图标块所用分类色
  category: WidgetCategory;
  entries: PaletteEntry[];
}

/// 行高 (px) — 与 PaletteRow 的行高样式同源
export const ROW_SIZE = 34;

/// 搜索过滤 — 分类名、显示文本和控件标识大小写不敏感匹配;
/// 空查询返回原 sections; 命中分组的 entries 被裁剪, 全空分组整体剔除。
export function filterSections(
  sections: readonly PaletteSection[],
  query: string,
): PaletteSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sections];
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter(
        (e) => [section.header, e.label, e.title, e.key, e.kind, e.op, e.preset]
          .some((value) => value?.toLowerCase().includes(q)),
      ),
    }))
    .filter((section) => section.entries.length > 0);
}
