import { useAppStore } from '../store/appStore';
import { CustomWidgetEditor } from './CustomWidgetEditor';
import type { WidgetConfig } from '../types';
import { selectWidgets } from '../store/appStoreHelpers';

/// CustomWidgetEditor 容器组件
/// 单独订阅 customEditorState / widgets, 避免 App 因 widget 列表变化而重渲染
export function CustomWidgetEditorContainer() {
  const customEditorState = useAppStore((s) => s.customEditorState);
  const widgets = useAppStore((s) => selectWidgets(s));
  const updateWidget = useAppStore((s) => s.updateWidget);
  const closeCustomEditor = useAppStore((s) => s.closeCustomEditor);

  const editingCustomWidget =
    customEditorState.open && customEditorState.widgetId
      ? (widgets.find(
          (w) => w.params.id === customEditorState.widgetId && w.kind === 'Custom'
        ) as Extract<WidgetConfig, { kind: 'Custom' }> | undefined)
      : undefined;

  if (!editingCustomWidget) return null;

  return (
    <CustomWidgetEditor
      widget={editingCustomWidget}
      isOpen={customEditorState.open}
      onClose={closeCustomEditor}
      onSave={(next) => updateWidget(next.params.id, next)}
    />
  );
}

/// 懒加载入口 — 见 `components/lazy/lazyComponents.ts` (全仓唯一 React.lazy 清单)。
export default CustomWidgetEditorContainer;
