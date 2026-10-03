import { useAppStore } from './appStore';
import { NODE_PROPERTIES_TAB_ID } from '../types';
import type { DockState } from './dockState';

/// Mirror the most recently activated tab into the global app store.
export function mirrorActiveTab(kind: CardKind, tabId: string | null): void {
  if (!tabId) return;
  const state = useAppStore.getState();
  if (kind === 'control') state.setActiveControlTab(tabId);
  else state.setActiveDataTab(tabId);
}

import type { CardKind, DockCard, DockNode } from './dockTree';
import { insertRightOfCard, isPropertiesCard, nextId, removeCardNode } from './dockTree';

export function ensurePropertiesExclusiveCard(
  root: DockNode,
  cards: Record<string, DockCard>
): { root: DockNode; cards: Record<string, DockCard> } {
  const host = Object.values(cards).find(
    (c) => c.kind === 'data' && c.tabIds.includes(NODE_PROPERTIES_TAB_ID)
  );
  if (!host) return { root, cards };

  if (host.tabIds[0] === NODE_PROPERTIES_TAB_ID) {
    if (host.tabIds.length === 1) return { root, cards };
    // 逐出混入的 tab → 另一张非属性 data 卡 / 新建底部卡
    const strays = host.tabIds.slice(1);
    const nextCards: Record<string, DockCard> = {
      ...cards,
      [host.id]: { ...host, tabIds: [NODE_PROPERTIES_TAB_ID], activeTabId: NODE_PROPERTIES_TAB_ID },
    };
    let target = Object.values(nextCards).find(
      (c) => c.kind === 'data' && c.id !== host.id && !isPropertiesCard(c)
    );
    if (!target) {
      const id = nextId('card');
      target = { id, kind: 'data', tabIds: [], activeTabId: null };
      nextCards[id] = target;
      const node: DockNode = { id: nextId('node'), type: 'card', cardId: id };
      root = { id: nextId('split'), type: 'split', dir: 'col', children: [root, node], sizes: [70, 30] };
    }
    nextCards[target.id] = {
      ...target,
      tabIds: [...target.tabIds, ...strays],
      activeTabId: strays[strays.length - 1],
    };
    return { root, cards: nextCards };
  }

  // prop 混在数据卡非首位 → 拆出为画布右侧专属小卡, 原卡保留其余 tab
  const kept = host.tabIds.filter((id) => id !== NODE_PROPERTIES_TAB_ID);
  const nextCards: Record<string, DockCard> = {
    ...cards,
    [host.id]: {
      ...host,
      tabIds: kept,
      activeTabId: host.activeTabId === NODE_PROPERTIES_TAB_ID ? (kept[0] ?? null) : host.activeTabId,
    },
  };
  const controlCard = Object.values(nextCards).find((c) => c.kind === 'control');
  const cardId = nextId('card');
  const leaf: DockNode = { id: nextId('node'), type: 'card', cardId };
  let nextRoot = controlCard ? insertRightOfCard(root, controlCard.id, leaf) : root;
  if (nextRoot === root) {
    nextRoot = { id: nextId('split'), type: 'split', dir: 'col', children: [root, leaf], sizes: [70, 30] };
  }
  nextCards[cardId] = {
    id: cardId,
    kind: 'data',
    tabIds: [NODE_PROPERTIES_TAB_ID],
    activeTabId: NODE_PROPERTIES_TAB_ID,
  };
  return { root: nextRoot, cards: nextCards };
}

/// 从拖拽状态构建结果: 摘出 Tab 生成新卡片 / 摘除整卡, 返回新的 root+cards+待插入节点
export function extractDraggedNode(state: Pick<DockState, 'root' | 'cards' | 'draggingTab' | 'draggingCardId'>): {
  root: DockNode | null;
  cards: Record<string, DockCard>;
  node: DockNode;
  focusedCardId: string;
} | null {
  const { root, cards, draggingTab: d, draggingCardId } = state;
  if (d) {
    const origin = cards[d.fromCardId];
    if (!origin?.tabIds.includes(d.tabId)) return null;
    const originTabs = origin.tabIds.filter((id) => id !== d.tabId);
    const newCardId = nextId('card');
    const nextCards: Record<string, DockCard> = {
      ...cards,
      [origin.id]: {
        ...origin,
        tabIds: originTabs,
        activeTabId: origin.activeTabId === d.tabId ? (originTabs[0] ?? null) : origin.activeTabId,
      },
      [newCardId]: { id: newCardId, kind: d.kind, tabIds: [d.tabId], activeTabId: d.tabId },
    };
    let nextRoot: DockNode | null = root;
    if (originTabs.length === 0) {
      nextRoot = removeCardNode(root, origin.id);
      delete nextCards[origin.id];
    }
    mirrorActiveTab(d.kind, d.tabId);
    return {
      root: nextRoot,
      cards: nextCards,
      node: { id: nextId('node'), type: 'card', cardId: newCardId },
      focusedCardId: newCardId,
    };
  }
  if (draggingCardId) {
    if (!cards[draggingCardId]) return null;
    return {
      root: removeCardNode(root, draggingCardId),
      cards,
      node: { id: nextId('node'), type: 'card', cardId: draggingCardId },
      focusedCardId: draggingCardId,
    };
  }
  return null;
}
