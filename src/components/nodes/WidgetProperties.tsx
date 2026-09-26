// ============ 节点属性面板 (widget 通用壳) ============
//
// 属性面板只负责三件通用事: 名称 / 各 kind 专属编辑节 (registry 分发) / 尺寸。
// 各 kind 的编辑器实现位于 widgets/<kind>/XProperties.tsx, 经 WIDGET_REGISTRY
// 的 Properties 字段挂载 — 新增控件的属性编辑随 def 自动接入本面板。

import { memo } from 'react';
import type { Node } from '@xyflow/react';
import { useAppStore } from '../../store/appStore';
import type { WidgetConfig } from '../../types';
import { WIDGET_REGISTRY } from '../widgets/registry';
import { selectWidgets } from '../../store/appStoreHelpers';

export const WidgetProperties = memo(function WidgetProperties({ node }: { node: Node }) {
  const widget = useAppStore((s) => selectWidgets(s).find((item) => item.params.id === node.id));
  const updateWidget = useAppStore((s) => s.updateWidget);
  if (!widget) return null;
  const update = (next: WidgetConfig) => updateWidget(widget.params.id, next);
  // 未知 kind → 受限展示 (保留原始文档; 不猜默认编辑器、不崩溃)
  const def = WIDGET_REGISTRY[widget.kind];
  if (!def) {
    return <p className="text-xs text-text-secondary">{`未知控件 ${widget.kind}: 原始配置已保留, 仅支持查看与删除。`}</p>;
  }
  // def.Properties 是该 kind 的专属编辑节; update 收窄由调用处保证同 kind
  const Properties = def.Properties;
  return (
    <>

      {Properties && <Properties widget={widget as never} update={update} />}
    </>
  );
});
