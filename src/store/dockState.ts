import type { CardKind, DockCard, DockNode, DragTabPayload, DropTarget, SnapEdge } from './dockTree';

export interface DockState {
  root: DockNode;
  cards: Record<string, DockCard>;
  /// 最近交互的卡片 — 新建 Tab 的落点
  focusedCardId: string | null;
  /// 正在拖拽的 Tab (不持久化)
  draggingTab: DragTabPayload | null;
  /// 正在整卡拖拽的卡片 (不持久化)
  draggingCardId: string | null;
  /// 当前悬停的投放目标 (不持久化) — 驱动全局预览
  dropTarget: DropTarget | null;
  /// 指针悬停的合并目标卡片 (不持久化) — 标题栏 Tab 合并高亮
  mergeHoverCardId: string | null;
  setActiveTab: (cardId: string, tabId: string) => void;
  setFocusedCard: (cardId: string) => void;
  setSizes: (splitId: string, sizes: number[]) => void;
  setDraggingTab: (d: DragTabPayload | null) => void;
  setDraggingCard: (cardId: string | null) => void;
  setDropTarget: (t: DropTarget | null) => void;
  setMergeHover: (cardId: string | null) => void;
  /// 把当前拖拽的 Tab 合并进目标卡片 (仅同 kind)
  moveTabToCard: (targetCardId: string) => void;
  /// 在当前拖拽的 Tab / 卡片落到目标卡片的某个方位 (同级条带插入或拆分)
  dropOnCardEdge: (targetCardId: string, edge: SnapEdge) => void;
  /// 当前拖拽的 Tab / 卡片落到页面边缘 (整行/整列条带)
  dropOnRootEdge: (edge: SnapEdge) => void;
  /// 与 appStore 的 Tab 列表对账: 剔除已删除的 Tab, 安置新增 Tab, 裁剪空卡片
  reconcile: (kind: CardKind, existingTabIds: string[]) => void;
  /// 节点属性面板专属停靠 — tab 尚不属于任何卡片时, 在画布卡右侧拆分一张
  /// 较小的新卡承载它; 已有归属 (含用户手动拖动过的安排) 则不动
  dockPropertiesTab: (tabId: string) => void;
}
