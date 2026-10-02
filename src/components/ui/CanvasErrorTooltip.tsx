/// 画布节点错误高亮 Tooltip + hook — 节点命中编译错误时红框 + hover 显示错误消息
///
/// 单一权威: 数据来源 `useAppStore.tabErrors[tabId]?.error` (CompileReport)
/// 与 `tabErrorNodes[tabId]` (命中节点 id 列表) 的交集; 节点组件用 useCanvasNodeError
/// hook 窄化订阅。Tooltip 用原生 hover state 实现 (避免引入 radix-ui)。

import { useState, useMemo, type ReactNode } from 'react';
import { useAppStore } from '../../store/appStore';
import type { CompileError } from '../../store/slices/compileError';

/// 节点命中错误时渲染人类可读消息 (后端 GraphCompileError 1:1 镜像)
export function compileErrorMessage(err: CompileError, nodeId: string): string {
  switch (err.kind) {
    case 'value_cycle':
      return `Value cycle: ${err.cycle.join(' → ')}`;
    case 'byte_cycle':
      return `Byte cycle: ${err.cycle.join(' → ')}`;
    case 'domain_mismatch': {
      if (err.source_node === nodeId) {
        return `Domain mismatch on out ${err.source_port} (${err.src_domain})`;
      }
      if (err.target === nodeId) {
        return `Domain mismatch on in ${err.target_port} (${err.tgt_domain})`;
      }
      return `Domain mismatch: ${err.source_port}(${err.src_domain}) → ${err.target_port}(${err.tgt_domain})`;
    }
    case 'node_not_found':
      return err.id === nodeId ? 'Node not found in compiled graph' : `Node "${err.id}" not found`;
    case 'port_not_found':
      return err.node_id === nodeId
        ? `${err.output ? 'Output' : 'Input'} port "${err.port}" is not declared`
        : `Port "${err.port}" is not declared by node "${err.node_id}"`;
    default:
      return 'Compile error';
  }
}

/// 节点命中错误时返回消息文本,否则 null
export function useCanvasNodeError(nodeId: string, tabId: string): string | null {
  const tabStates = useAppStore((s) => s.tabStates);
  const tabErrorNodes = useAppStore((s) => s.tabErrorNodes);
  const tabErrors = useAppStore((s) => s.tabErrors);
  return useMemo(() => {
    if (tabStates[tabId] !== 'error') return null;
    const nodes = tabErrorNodes[tabId];
    if (!nodes?.includes(nodeId)) return null;
    const report = tabErrors[tabId];
    return report ? compileErrorMessage(report.error, nodeId) : null;
  }, [tabStates, tabErrorNodes, tabErrors, tabId, nodeId]);
}

interface CanvasErrorTooltipProps {
  message: string | null;
  children: ReactNode;
}

export function CanvasErrorTooltip({ message, children }: CanvasErrorTooltipProps) {
  const [hover, setHover] = useState(false);
  if (!message) return <>{children}</>;
  return (
    <div
      className="relative h-full"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {hover && (
        <div
          role="tooltip"
          className="absolute z-50 left -translate-x bottom-full mb-1 px-2 py-1 bg-danger-surface text-text-inverse text-xs rounded shadow-lg pointer-events-none max-w-[260px] whitespace-normal leading-tight"
        >
          {message}
        </div>
      )}
    </div>
  );
}
