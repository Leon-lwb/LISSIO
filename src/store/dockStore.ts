import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { NODE_PROPERTIES_TAB_ID } from '../types';
import { defaultCards, defaultRoot } from './dockDefaults';
import {
  extractDraggedNode,
  mirrorActiveTab,
} from './dockReconcile';
import type { DockState } from './dockState';
import type { DockCard, DockNode } from './dockTree';
import {
  insertAtEdge,
  insertAtRootEdge,
  insertRightOfCard,
  isPropertiesCard,
  nextId,
  removeCardNode,
  updateSplitSizes,
} from './dockTree';

export * from './dockTree';
export { ensurePropertiesExclusiveCard } from './dockReconcile';
export type { DockState } from './dockState';

export const useDockStore = create<DockState>()(
  persist(
    (set, get) => ({
      root: defaultRoot,
      cards: defaultCards,
      focusedCardId: null,
      draggingTab: null,
      draggingCardId: null,
      dropTarget: null,
      mergeHoverCardId: null,

      setActiveTab: (cardId, tabId) =>
        set((state) => {
          const card = state.cards[cardId];
          if (!card?.tabIds.includes(tabId)) return state;
          mirrorActiveTab(card.kind, tabId);
          return {
            cards: { ...state.cards, [cardId]: { ...card, activeTabId: tabId } },
            focusedCardId: cardId,
          };
        }),

      setFocusedCard: (cardId) =>
        set((state) => {
          const card = state.cards[cardId];
          if (!card || state.focusedCardId === cardId) return state;
          mirrorActiveTab(card.kind, card.activeTabId);
          return { focusedCardId: cardId };
        }),

      setSizes: (splitId, sizes) =>
        set((state) => ({ root: updateSplitSizes(state.root, splitId, sizes) })),

      setDraggingTab: (draggingTab) => set({ draggingTab }),
      setDraggingCard: (draggingCardId) => set({ draggingCardId }),

      setDropTarget: (dropTarget) =>
        set((state) => {
          const cur = state.dropTarget;
          if (cur === dropTarget) return state;
          if (cur && cur.cardId === dropTarget?.cardId && cur.edge === dropTarget.edge) {
            return state;
          }
          return { dropTarget };
        }),

      setMergeHover: (mergeHoverCardId) =>
        set((state) => (state.mergeHoverCardId === mergeHoverCardId ? state : { mergeHoverCardId })),

      moveTabToCard: (targetCardId) =>
        set((state) => {
          const d = state.draggingTab;
          if (!d) return state;
          const origin = state.cards[d.fromCardId];
          const target = state.cards[targetCardId];
          if (!origin || !target || origin.id === target.id || origin.kind !== target.kind) {
            return { draggingTab: null };
          }
          const originTabs = origin.tabIds.filter((id) => id !== d.tabId);
          const cards: Record<string, DockCard> = {
            ...state.cards,
            [origin.id]: {
              ...origin,
              tabIds: originTabs,
              activeTabId: origin.activeTabId === d.tabId ? (originTabs[0] ?? null) : origin.activeTabId,
            },
            [target.id]: { ...target, tabIds: [...target.tabIds, d.tabId], activeTabId: d.tabId },
          };
          let root = state.root;
          if (originTabs.length === 0) {
            const nextRoot = removeCardNode(root, origin.id);
            if (nextRoot) {
              root = nextRoot;
              delete cards[origin.id];
            }
          }
          mirrorActiveTab(target.kind, d.tabId);
          return { root, cards, draggingTab: null, focusedCardId: target.id };
        }),

      dropOnCardEdge: (targetCardId, edge) =>
        set((state) => {
          // 单 Tab 卡片拖到自身边缘无意义
          const d = state.draggingTab;
          if (d?.fromCardId === targetCardId) {
            const origin = state.cards[d.fromCardId];
            if (!origin || origin.tabIds.length <= 1) return { draggingTab: null, dropTarget: null };
          }
          const extracted = extractDraggedNode(state);
          if (!extracted?.root) return { draggingTab: null, draggingCardId: null, dropTarget: null };
          const root = insertAtEdge(extracted.root, targetCardId, edge, extracted.node);
          return {
            root,
            cards: extracted.cards,
            draggingTab: null,
            draggingCardId: null,
            dropTarget: null,
            focusedCardId: extracted.focusedCardId,
          };
        }),

      dropOnRootEdge: (edge) =>
        set((state) => {
          const extracted = extractDraggedNode(state);
          if (!extracted) return { draggingTab: null, draggingCardId: null, dropTarget: null };
          // 树被摘空 (唯一卡片/Tab 被拖出) → 新节点即整棵树
          const root = extracted.root
            ? insertAtRootEdge(extracted.root, edge, extracted.node)
            : extracted.node;
          return {
            root,
            cards: extracted.cards,
            draggingTab: null,
            draggingCardId: null,
            dropTarget: null,
            focusedCardId: extracted.focusedCardId,
          };
        }),

      reconcile: (kind, existingTabIds) =>
        set((state) => {
          const existing = new Set(existingTabIds);
          const cards = { ...state.cards };
          let root = state.root;
          let changed = false;

          // 1. 剔除已删除的 Tab
          for (const card of Object.values(cards)) {
            if (card.kind !== kind) continue;
            const kept = card.tabIds.filter((id) => existing.has(id));
            if (kept.length !== card.tabIds.length) {
              changed = true;
              cards[card.id] = {
                ...card,
                tabIds: kept,
                activeTabId: card.activeTabId && kept.includes(card.activeTabId) ? card.activeTabId : (kept[0] ?? null),
              };
            }
          }

          // 2. 空卡片裁剪 (该 kind 还有其他卡片时)
          for (const card of Object.values(cards)) {
            if (card.kind !== kind || card.tabIds.length > 0) continue;
            const hasSibling = Object.values(cards).some((c) => c.kind === kind && c.id !== card.id);
            if (!hasSibling) continue;
            const nextRoot = removeCardNode(root, card.id);
            if (nextRoot) {
              root = nextRoot;
              delete cards[card.id];
              changed = true;
            }
          }

          // 3. 安置新增 Tab
          const housed = new Set(
            Object.values(cards)
              .filter((c) => c.kind === kind)
              .flatMap((c) => c.tabIds)
          );
          let missing = existingTabIds.filter((id) => !housed.has(id));

          // 3a. 属性面板专属归宿 — 无归属时在画布卡右侧拆专属小卡 (与 dockPropertiesTab
          // 同款), 不落入其他数据卡; 无画布卡拆分失败时留给 3b 兜底
          if (kind === 'data' && missing.includes(NODE_PROPERTIES_TAB_ID)) {
            const controlCard = Object.values(cards).find((c) => c.kind === 'control');
            if (controlCard) {
              const cardId = nextId('card');
              const leaf: DockNode = { id: nextId('node'), type: 'card', cardId };
              const nextRoot = insertRightOfCard(root, controlCard.id, leaf);
              if (nextRoot !== root) {
                root = nextRoot;
                cards[cardId] = {
                  id: cardId,
                  kind: 'data',
                  tabIds: [NODE_PROPERTIES_TAB_ID],
                  activeTabId: NODE_PROPERTIES_TAB_ID,
                };
                changed = true;
                missing = missing.filter((id) => id !== NODE_PROPERTIES_TAB_ID);
              }
            }
          }

          // 3b. 其余新增 Tab → 焦点卡片 / 该 kind 首张卡片 / 新建卡片
          //     属性专属卡不作安置目标 (焦点与兜底皆跳过)
          if (missing.length > 0) {
            changed = true;
            let target =
              Object.values(cards).find(
                (c) => c.kind === kind && c.id === state.focusedCardId && !isPropertiesCard(c)
              ) ?? Object.values(cards).find((c) => c.kind === kind && !isPropertiesCard(c));
            if (!target) {
              const id = nextId('card');
              target = { id, kind, tabIds: [], activeTabId: null };
              cards[id] = target;
              const node: DockNode = { id: nextId('node'), type: 'card', cardId: id };
              root = { id: nextId('split'), type: 'split', dir: 'col', children: [root, node], sizes: [70, 30] };
            }
            const cur = cards[target.id];
            cards[target.id] = {
              ...cur,
              tabIds: [...cur.tabIds, ...missing],
              activeTabId: missing[missing.length - 1],
            };
          }

          // 4. 再裁剪一次空卡 — 3a 拆出新卡后, 遗留的空属性卡已出现同 kind 兄弟
          if (changed) {
            for (const card of Object.values(cards)) {
              if (card.kind !== kind || card.tabIds.length > 0) continue;
              const hasSibling = Object.values(cards).some((c) => c.kind === kind && c.id !== card.id);
              if (!hasSibling) continue;
              const nextRoot = removeCardNode(root, card.id);
              if (nextRoot) {
                root = nextRoot;
                delete cards[card.id];
              }
            }
          }

          if (!changed) return state;
          return { root, cards };
        }),

      dockPropertiesTab: (tabId) => {
        const state = get();
        if (Object.values(state.cards).some((c) => c.kind === 'data' && c.tabIds.includes(tabId))) {
          return;
        }
        const controlCard = Object.values(state.cards).find((c) => c.kind === 'control');
        if (!controlCard) return; // 无画布卡 (异常态) → 交给 reconcile 兜底安置
        const cardId = nextId('card');
        const leaf: DockNode = { id: nextId('node'), type: 'card', cardId };
        const root = insertRightOfCard(state.root, controlCard.id, leaf);
        if (root === state.root) return;
        set({
          root,
          cards: {
            ...state.cards,
            [cardId]: { id: cardId, kind: 'data', tabIds: [tabId], activeTabId: tabId },
          },
          focusedCardId: cardId,
        });
        mirrorActiveTab('data', tabId);
      },
    }),
    {
      name: 'vofa-dock',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ root: s.root, cards: s.cards, focusedCardId: s.focusedCardId }),
    }
  )
);
