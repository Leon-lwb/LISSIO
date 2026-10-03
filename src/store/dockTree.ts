import { NODE_PROPERTIES_TAB_ID } from '../types';
export type SnapEdge = 'top' | 'bottom' | 'left' | 'right';

/// 分栏方向: row = 左右, col = 上下
export type DockDirection = 'row' | 'col';
/// 卡片种类 — 决定可承载的 Tab 类型 (控件画布 / 数据视图)
/// 仅「合并进同一 Tab 条」限制同 kind; 边缘拆分/页面级停靠允许跨 kind
export type CardKind = 'control' | 'data';

export interface DockCard {
  id: string;
  kind: CardKind;
  tabIds: string[];
  activeTabId: string | null;
}

/// 布局树: N 叉 split (sizes 与 children 一一对应, 百分比) + 卡片叶子
export type DockNode =
  | { id: string; type: 'card'; cardId: string }
  | { id: string; type: 'split'; dir: DockDirection; children: DockNode[]; sizes: number[] };

export interface DragTabPayload {
  kind: CardKind;
  tabId: string;
  fromCardId: string;
}

/// 当前悬停的投放目标 — cardId 为 null 表示页面级边缘热区
export interface DropTarget {
  cardId: string | null;
  edge: SnapEdge;
}

/// edge 对应的分栏轴向
export function edgeDir(edge: SnapEdge): DockDirection {
  return edge === 'left' || edge === 'right' ? 'row' : 'col';
}

/// 新节点是否排在 target 之前 (上/左)
export function isNewFirst(edge: SnapEdge): boolean {
  return edge === 'left' || edge === 'top';
}

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/// 从树中摘除指定卡片节点, 折叠空 split / 单子 split; 返回新树 (null = 树已空)
/// 导出供 DockLayout 计算"摘除后的预览几何"
export function removeCardNode(node: DockNode, cardId: string): DockNode | null {
  if (node.type === 'card') return node.cardId === cardId ? null : node;
  const keptChildren: DockNode[] = [];
  const keptSizes: number[] = [];
  let changed = false;
  node.children.forEach((child, i) => {
    const next = removeCardNode(child, cardId);
    if (next !== child) changed = true;
    if (next === null) return;
    keptChildren.push(next);
    keptSizes.push(node.sizes[i] ?? 100 / node.children.length);
  });
  if (!changed) return node;
  if (keptChildren.length === 0) return null;
  if (keptChildren.length === 1) return keptChildren[0];
  return { ...node, children: keptChildren, sizes: keptSizes };
}

/// 在 target 卡片的 edge 方位插入 newNode
/// - target 的父 split 轴向与 edge 匹配 → 作为同级条带插入 (偷取 target 一半份额)
/// - 否则 → 把 target 包装成一个新的垂直轴向 split (对半分)
export function insertAtEdge(node: DockNode, targetCardId: string, edge: SnapEdge, newNode: DockNode): DockNode {
  if (node.type === 'card') {
    if (node.cardId !== targetCardId) return node;
    const first = isNewFirst(edge);
    return {
      id: nextId('split'),
      type: 'split',
      dir: edgeDir(edge),
      children: first ? [newNode, node] : [node, newNode],
      sizes: [50, 50],
    };
  }
  // target 是本 split 的直接子节点且轴向匹配 → 同级插入
  const idx = node.children.findIndex((c) => c.type === 'card' && c.cardId === targetCardId);
  if (idx >= 0 && node.dir === edgeDir(edge)) {
    const children = node.children.slice();
    const sizes = node.sizes.slice();
    const targetSize = sizes[idx] ?? 100 / children.length;
    const newSize = targetSize / 2;
    sizes[idx] = targetSize - newSize;
    const at = isNewFirst(edge) ? idx : idx + 1;
    children.splice(at, 0, newNode);
    sizes.splice(at, 0, newSize);
    return { ...node, children, sizes };
  }
  let changed = false;
  const children = node.children.map((c) => {
    const next = insertAtEdge(c, targetCardId, edge, newNode);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/// 页面级边缘插入: 根 split 轴向匹配 → 追加为整行/整列条带 (占 25%); 否则包装根节点
export function insertAtRootEdge(root: DockNode, edge: SnapEdge, newNode: DockNode): DockNode {
  const dir = edgeDir(edge);
  const first = isNewFirst(edge);
  const share = 25;
  if (root.type === 'split' && root.dir === dir) {
    const scale = (100 - share) / 100;
    const sizes = root.sizes.map((s) => s * scale);
    return {
      ...root,
      children: first ? [newNode, ...root.children] : [...root.children, newNode],
      sizes: first ? [share, ...sizes] : [...sizes, share],
    };
  }
  return {
    id: nextId('split'),
    type: 'split',
    dir,
    children: first ? [newNode, root] : [root, newNode],
    sizes: first ? [share, 100 - share] : [100 - share, share],
  };
}

export function updateSplitSizes(node: DockNode, splitId: string, sizes: number[]): DockNode {
  if (node.type === 'card') return node;
  if (node.id === splitId) return { ...node, sizes };
  let changed = false;
  const children = node.children.map((c) => {
    const next = updateSplitSizes(c, splitId, sizes);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

export function insertRightOfCard(node: DockNode, targetCardId: string, newLeaf: DockNode): DockNode {
  if (node.type === 'card') return node;
  const idx = node.children.findIndex((c) => c.type === 'card' && c.cardId === targetCardId);
  if (idx >= 0 && node.dir === 'row') {
    const targetSize = node.sizes[idx] ?? 100 / node.children.length;
    const newSize = Math.min(30, targetSize / 2);
    const children = node.children.slice();
    children.splice(idx + 1, 0, newLeaf);
    const sizes = node.sizes.slice();
    sizes[idx] = targetSize - newSize;
    sizes.splice(idx + 1, 0, newSize);
    return { ...node, children, sizes };
  }
  const children = node.children.map((c) => insertRightOfCard(c, targetCardId, newLeaf));
  if (children.every((c, i) => c === node.children[i])) return node;
  return { ...node, children };
}

/// 属性专属卡判定 — 首个 tab 即属性面板的 data 卡 (含被追加混入其他 tab 的:
/// 旧版 reconcile 追加污染时 prop 仍在首位)。reconcile 安置新 tab 时跳过此类卡;
/// prop 被手动合入普通数据卡时位于末位, 不受影响。
export function isPropertiesCard(c: DockCard): boolean {
  return c.kind === 'data' && c.tabIds.length > 0 && c.tabIds[0] === NODE_PROPERTIES_TAB_ID;
}
