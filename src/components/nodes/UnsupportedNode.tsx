import { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { translate } from '../../i18n';
import { NodeFrame } from './NodeFrame';

interface UnsupportedNodeProps {
  id: string;
  data: Record<string, unknown>;
  selected?: boolean;
}

/**
 * 未知控件/渲染器兜底展示 — 未知 widgetKind (旧版本工作区或后端新增而前端
 * 未实现视觉组件时) 保留原始节点文档, 支持删除; 不降级成其他控件,
 * 不执行、不替换、不丢弃 (计划 WP7 边界 8)。
 */
export const UnsupportedNode = memo(function UnsupportedNode({ id, data, selected }: UnsupportedNodeProps) {
  const lang = useAppStore((s) => s.lang);
  const removeWidget = useAppStore((s) => s.removeWidget);
  const widgetKind = typeof data.widgetKind === 'string'
    ? data.widgetKind
    : (data.widget as { kind?: string } | undefined)?.kind;
  return <NodeFrame id={id} tabId={data.tabId as string} label={(data.label as string) ?? widgetKind ?? id} selected={selected}
    color="#6b7280" inputs={[]} outputs={[]}
    minWidth={160} minHeight={60}
    onRename={() => undefined}
    onRemove={() => removeWidget(id)}>
    <div className="flex items-center gap-2 px-2 py-1 text-xs text-text-secondary">
      <AlertTriangle size={14} className="flex-shrink-0 text-yellow" />
      <span>{translate('unsupportedWidget', lang)} {widgetKind ? <code className="font-mono">{widgetKind}</code> : null}</span>
    </div>
  </NodeFrame>;
});
