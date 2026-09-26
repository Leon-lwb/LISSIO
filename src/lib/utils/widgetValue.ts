//! 输入控件的取值语义 — 当前配置对应的单一数值输出。
//!
//! 这是控件交互语义 (画布/订阅层读取), 不是业务默认值工厂: 默认值由
//! 后端模型目录 (prepare_node_documents) 产出。

import type { WidgetConfig } from '../../types';

/** 当前配置对应的单一数值输出；非输入控件返回 null。 */
export function widgetInputValue(widget: WidgetConfig): number | null {
  switch (widget.kind) {
    case 'Knob':
    case 'Slider':
      return widget.params.value;
    case 'Button':
      return widget.params.releaseValue;
    case 'Radio':
      return widget.params.options.find((option) => option.id === widget.params.selectedId)?.value ?? 0;
    case 'Checkbox': {
      const selected = new Set(widget.params.selectedIds);
      if (selected.size === 0) return widget.params.emptyValue ?? 0;
      return widget.params.options.reduce(
        (sum, option) => sum + (selected.has(option.id) ? option.value : 0),
        0,
      );
    }
    default:
      return null;
  }
}
