import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useAppStore } from '../../store/appStore';
import { useDockStore } from '../../store/dockStore';
import { widgetMinSize } from '../../lib/utils/widgetSize';
import { useDescribeEntry, describeDomainToUi } from '../../lib/models/describeStore';
import type { NodePortDomain } from '../../types/generated/NodePortDomain';
import type { WidgetPort } from './WidgetPortsView';
import type { WidgetConfig } from '../../types';
import { getWidgetCategory, WIDGET_CATEGORY_COLORS } from '../../types';
import { widgetToTab } from '../../lib/utils/widgetTab';
import { WIDGET_REGISTRY, widgetComponent } from '../widgets/registry';
import { NodeFrame } from './NodeFrame';
import { UnsupportedNode } from './UnsupportedNode';

/// 端口表 → 画布端口视图 (id/label/domain 由节点描述提供, 无本地业务 switch)
function toUiPorts(ports: { handle: string; label: string; domain: NodePortDomain }[]): WidgetPort[] {
  return ports.map((port) => ({
    id: port.handle,
    label: port.label || port.handle,
    domain: describeDomainToUi(port.domain),
  }));
}

export const WidgetNode = memo(function WidgetNode({ id, data, selected }: NodeProps) {
  const widget = data.widget as WidgetConfig | undefined;
  const remove = useAppStore((s) => s.removeWidget);
  const update = useAppStore((s) => s.updateWidget);
  const description = useDescribeEntry(id).description;
  const onOpen = useCallback(() => {
    if (!widget) return;
    const tab = widgetToTab(widget);
    if (!tab) return;
    const state = useAppStore.getState();
    if (!state.dataTabs.some((item) => item.id === tab.id)) { state.addDataTab(tab); return; }
    const dock = useDockStore.getState();
    const card = Object.values(dock.cards).find((item) => item.kind === 'data' && item.tabIds.includes(tab.id));
    if (card) dock.setActiveTab(card.id, tab.id);
    else state.setActiveDataTab(tab.id);
  }, [widget]);
  if (!widget) return <div className="p-2 text-red text-xs">Missing widget</div>;
  // 未知 kind → Unsupported 展示 (保留原始文档, 不降级不替换)
  if (!WIDGET_REGISTRY[widget.kind]) {
    return <UnsupportedNode id={id} data={data} selected={selected} />;
  }
  // 端口唯一权威 = describe_node_documents; pending/absent 时无端口可渲染
  // (不本地回退) — 描述到达后端口与边恢复显示
  const ports = {
    inputs: toUiPorts(description?.inputs ?? []),
    outputs: toUiPorts(description?.outputs ?? []),
  };
  const limits = widgetMinSize(widget.kind);
  const Content = widgetComponent(widget.kind);
  return <NodeFrame id={id} tabId={data.tabId as string} label={widget.params.label || widget.kind} selected={selected}
    color={WIDGET_CATEGORY_COLORS[getWidgetCategory(widget.kind)]} inputs={ports.inputs} outputs={ports.outputs}
    minWidth={limits.minW} minHeight={limits.minH} onRemove={() => remove(id)}
    onRename={(label) => update(id, { ...widget, params: { ...widget.params, label } } as WidgetConfig)}
    onOpen={widgetToTab(widget) ? onOpen : undefined}
>
    <Content widget={widget} />
  </NodeFrame>;
});
