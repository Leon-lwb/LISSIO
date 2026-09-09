import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Settings2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useDockStore } from '../../store/dockStore';
import { widgetMinSize } from '../../lib/utils/widgetSize';
import { getWidgetPorts, deriveRawDataPorts } from './WidgetPorts';
import type { WidgetConfig } from '../../types';
import { getWidgetCategory, WIDGET_CATEGORY_COLORS } from '../../types';
import { widgetToTab } from '../../lib/utils/widgetTab';
import { WIDGET_REGISTRY, widgetComponent } from '../widgets/registry';
import { NodeFrame } from './NodeFrame';

export const WidgetNode = memo(function WidgetNode({ id, data, selected }: NodeProps) {
  const widget = data.widget as WidgetConfig | undefined;
  const remove = useAppStore((s) => s.removeWidget);
  const update = useAppStore((s) => s.updateWidget);
  const edit = useAppStore((s) => s.openCustomEditor);
  const edges = useAppStore((s) => s.rfEdges);
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
  const ports = widget.kind === 'RawData' ? deriveRawDataPorts(edges, id) : getWidgetPorts(widget);
  const limits = widgetMinSize(widget.kind);
  const Content = widgetComponent(widget.kind);
  return <NodeFrame id={id} tabId={data.tabId as string} label={widget.params.label || widget.kind} selected={selected}
    color={WIDGET_CATEGORY_COLORS[getWidgetCategory(widget.kind)]} inputs={ports.inputs} outputs={ports.outputs}
    minWidth={limits.minW} minHeight={limits.minH} onRemove={() => remove(id)}
    onRename={(label) => update(id, { ...widget, params: { ...widget.params, label } } as WidgetConfig)}
    onOpen={widgetToTab(widget) ? onOpen : undefined}
    actions={WIDGET_REGISTRY[widget.kind]?.customEditor ? <button className="nodrag" title="Edit" onClick={(event) => { event.stopPropagation(); edit(id); }}><Settings2 size={10} /></button> : undefined}>
    <Content widget={widget} />
  </NodeFrame>;
});
