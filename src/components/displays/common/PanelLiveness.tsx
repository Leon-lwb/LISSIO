//! 面板侧显示时效绑定 + 非实时角标与面板描边。
//!
//! 面板通过 [`usePanelFollowing`] 上报"是否跟随最新", 通过 [`usePanelGoLive`]
//! 注册"跳回最新"处理器; 两者都从 `PanelLivenessProvider` 取得当前面板 key。
//! 角标 [`LiveStatusBadge`] 与面板描边 [`FrozenPanelOutline`] 由数据面板宿主统一
//! 渲染, 面板自身不渲染时效 UI。

import { createContext, memo, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

import { useAppStore } from '../../../store/appStore';
import {
  clearPanelFollowing,
  derivePanelLive,
  onGoLive,
  reportPanelFollowing,
  useDisplayLivenessStore,
} from '../../../store/displayLiveness';
import { translate } from '../../../i18n';

const PanelKeyContext = createContext<string | null>(null);

/// 面板时效上下文 — 数据面板宿主在内容区包一层, 子视图据此上报/跳最新。
export const PanelLivenessProvider = memo(function PanelLivenessProvider({
  panelKey,
  children,
}: {
  panelKey: string;
  children: ReactNode;
}) {
  return <PanelKeyContext.Provider value={panelKey}>{children}</PanelKeyContext.Provider>;
});

/// 当前面板的稳定 key (数据面板宿主下发); 不在宿主内 (无 Provider) 时为 null。
/// 面板用它做跨面板共享状态的实例标识 (如滚动暂停引用计数)。
export function usePanelKey(): string | null {
  return useContext(PanelKeyContext);
}

/// 上报"是否跟随最新" — 返回的上报函数可在滚动/拖拽事件里直接调用,
/// 不必先落到面板自身的 React state (角标由 store 驱动重渲染)。
export function usePanelFollowing(): (following: boolean) => void {
  const panelKey = useContext(PanelKeyContext);
  useEffect(() => {
    if (!panelKey) return;
    // 面板挂载即视为跟随最新, 真实状态由面板随后的上报覆盖
    reportPanelFollowing(panelKey, true);
    return () => clearPanelFollowing(panelKey);
  }, [panelKey]);
  return useCallback(
    (following: boolean) => {
      if (panelKey) reportPanelFollowing(panelKey, following);
    },
    [panelKey]
  );
}

/// 注册"跳回最新"处理器 — 从暂停恢复时由派生层统一广播。
///
/// `handler` 必须是稳定引用 (面板内 `useCallback`), 否则每次渲染都会重挂。
export function usePanelGoLive(handler: () => void): void {
  const panelKey = useContext(PanelKeyContext);
  useEffect(() => {
    if (!panelKey) return;
    return onGoLive(panelKey, handler);
  }, [panelKey, handler]);
}

/// 面板当前是否非及时 (角标渲染依据)
export function usePanelFrozen(panelKey: string): boolean {
  const runState = useDisplayLivenessStore((s) => s.runState);
  const following = useDisplayLivenessStore((s) => s.following[panelKey] ?? true);
  return !derivePanelLive(runState, following);
}

/// 非实时面板描边 — 内容区四周的警示色边框, 让"这块数据不是实时的"一眼可见。
///
/// 覆盖层必须独立于面板内容: 面板多为不透明底, 写在容器上的 inset 阴影会被
/// 子视图盖住。覆盖层只做视觉提示, `pointer-events-none` 不拦截数据区交互;
/// 不铺底色 — 面板自身的数据配色 (波形/终端/表格) 不被改动。
export const FrozenPanelOutline = memo(function FrozenPanelOutline({ panelKey }: { panelKey: string }) {
  const frozen = usePanelFrozen(panelKey);
  if (!frozen) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[5] shadow-[inset_0_0_0_1.5px_var(--color-warning)]"
      data-testid="display-frozen-outline"
    />
  );
});

/// 非实时角标 — 非及时显示时的轻量提示, 不遮挡数据也不拦截指针。
export const LiveStatusBadge = memo(function LiveStatusBadge({ panelKey }: { panelKey: string }) {
  const lang = useAppStore((s) => s.lang);
  const frozen = usePanelFrozen(panelKey);
  if (!frozen) return null;
  return (
    <span
      className="absolute right-2 top-2 z-10 pointer-events-none inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/15 px-1.5 py-0.5 text-[10px] leading-none font-medium text-warning"
      data-testid="display-frozen-badge"
      title={translate('displayFrozenHint', lang)}
    >
      <TriangleAlert size={10} className="shrink-0" />
      {translate('displayFrozen', lang)}
    </span>
  );
});
