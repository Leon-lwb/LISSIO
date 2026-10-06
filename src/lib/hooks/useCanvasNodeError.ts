//! 画布节点的编译错误查询 — 节点 id → 错误消息文本。
//!
//! 订阅面窄化到三个 slice: 该 tab 的编译状态、命中错误的节点列表、以及编译报告。
//! 只有三者同时命中该节点时才产出消息。
//!
//! 住在交互层而不是 `components/ui/`: 它读 store (基础件不得直读 store), 而它服务
//! 的浮标组件是纯展示件 —— 把读状态与画浮标拆开, 浮标才能在测试里单独渲染。

import { useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { compileErrorMessage } from '../models/compileErrorMessage';

/// 节点命中错误时返回消息文本, 否则 null
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
