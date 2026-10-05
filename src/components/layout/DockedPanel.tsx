import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Panel, type ImperativePanelHandle } from 'react-resizable-panels';
import { MotionPresence, dockPanelGeometry, type DockEdge } from '../../lib/motion';

export interface DockedPanelProps {
  /** Stable id: the layout store is keyed by it, so sizes survive a dock change. */
  id: string;
  /** Sort key inside the panel group. */
  order: number;
  /** Window edge this panel is docked to — its entrance anchor. */
  edge: DockEdge;
  /** Whether the drawer is open. Closing retracts it toward `edge`. */
  visible: boolean;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  /** Classes for the card surface inside the panel. */
  className?: string;
  /**
   * 布局提交到新尺寸后调用一次。
   *
   * 通知必须紧跟在提交动作本身, 不能等它生效: 面板组的 FLIP 要在**新**矩形已经落到
   * DOM 上的那次提交里才拿得到正确的落定槽位, 而那正是这次 setState 触发的下一次提交。
   */
  onSizeCommit?: () => void;
  children: ReactNode;
}

/**
 * 停靠在窗口某一边上的抽屉。
 *
 * ## 宽度为什么不由 CSS 过渡驱动
 *
 * 早先这里是 `transition: flex-grow` —— 全样式表唯一的布局过渡。它有两个问题, 且都
 * 不出现在任何性能基线里:
 *
 *   - 每帧一次整个面板组的 flex 重排, 面板内容整棵子树跟着重新排版;
 *   - 动画探针**看不见**它。探针打的是主线程原型 (`setAttribute` / `getBoundingClientRect`),
 *     而 CSS 过渡触发的布局发生在浏览器 C++ 里, 不经过任何 JS。所以这类开销只能靠
 *     `pnpm check:motion` 静态拦住, 性能基线对此无能为力。
 *
 * 现在宽度只提交一次, 连续性交给面板组的 FLIP (`lib/motion/flipReorder`), 那条路径只写
 * `transform`, 每帧零布局。
 *
 * ## 开与关的时序为什么不对称
 *
 * - **开**: 立即提交最终尺寸。卡片的第一帧是 `opacity: 0`(`MotionPresence` 的 `fromTo`
 *   在 layout 阶段同步设初值), 于是"宽度瞬间到位"这一步被淡入完全遮住, 用户看到的是
 *   兄弟面板滑开 + 卡片淡入。
 * - **关**: 必须串行。`react-resizable-panels` 给 Panel 强制 `overflow: hidden`, 一旦
 *   先收布局, 卡片当场被裁没, 退场将完全不可见 —— 面板会"啪"地消失而不是收起来。
 *   所以先播退场, 在 `onExitComplete` 里再收布局。
 *
 *   退场本身是朝所属 dock 边的一次**收拢**: 以那条边为原点缩到 0.9 并向外让出 10px
 *   (`dockPanelGeometry` 的 `exitTo` / `exitScale`), 与进场互为镜像。少了这一段, 面板
 *   就是原地淡出 —— 这段时间画面上没有任何位移, 而宽度随后要一步收掉, 于是观感是
 *   "先糊掉、再猛滑一下"。
 *
 * `MotionPresence` 的 `onExitComplete` 同时也是解除保活挂载的那个信号, 收布局与拆挂载
 * 因此落在同一个时刻, 不会出现"内容没了但位置还占着"的中间态。
 */
export function DockedPanel({
  id,
  order,
  edge,
  visible,
  defaultSize,
  minSize,
  maxSize,
  className = '',
  onSizeCommit,
  children,
}: DockedPanelProps) {
  const panelRef = useRef<ImperativePanelHandle>(null);
  const geometry = dockPanelGeometry(edge);
  const [settled, setSettled] = useState(false);
  /**
   * 当前已经提交到 DOM 的展开态; `null` = 尚未提交过。
   *
   * 它同时承担两件事: 让 `commitSize` 幂等 (同一个目标尺寸不重复提交), 以及让布局提交
   * 那条路径知道"上一次是撑开的, 所以这次关闭要等退场"。
   */
  const committedOpen = useRef<boolean | null>(null);

  // 面板组在自己的 layout effect 里解析布局, 而那个 effect 排在本组件之后。于是挂载
  // 那一遍提交里面板已注册却还没有尺寸, 这时驱动它会触发断言。空等一次提交让面板组先
  // 排好; 面板此刻已经在树里, 因此看不到空档。
  useLayoutEffect(() => {
    setSettled(true);
  }, []);

  const commitSize = useCallback(
    (open: boolean) => {
      const panel = panelRef.current;
      if (!panel || committedOpen.current === open) return;
      committedOpen.current = open;
      if (open) panel.expand();
      else panel.collapse();
      onSizeCommit?.();
    },
    [onSizeCommit]
  );

  // 与翻转 `visible` 的那次提交同拍, 所以宽度落定早于浏览器绘制, 也就早于淡入。
  useLayoutEffect(() => {
    if (!settled) return;
    if (visible) {
      commitSize(true);
      return;
    }
    // 上一次是撑开的: 关闭交给退场回调, 理由见文件头。
    if (committedOpen.current !== true) commitSize(false);
  }, [visible, settled, commitSize]);

  const handleExitComplete = useCallback(() => {
    commitSize(false);
  }, [commitSize]);

  return (
    <Panel
      ref={panelRef}
      id={id}
      order={order}
      defaultSize={defaultSize}
      minSize={minSize}
      maxSize={maxSize}
      collapsible
      collapsedSize={0}
      data-flip-key={id}
      data-dock-edge={edge}
    >
      <MotionPresence
        visible={visible}
        variant="panel"
        className={`h-full w-full ${className}`}
        origin={geometry.origin}
        travel={geometry.enterFrom}
        scale={geometry.enterScale}
        exitTravel={geometry.exitTo}
        exitScale={geometry.exitScale}
        onExitComplete={handleExitComplete}
      >
        {children}
      </MotionPresence>
    </Panel>
  );
}
