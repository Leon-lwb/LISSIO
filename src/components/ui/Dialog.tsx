//! 弹窗基元 —— 遮罩与卡片, 一份生命周期, 一处键盘与焦点行为。
//!
//! 这两件事以前散在每个弹窗里: 自己写 `fixed inset-0` 遮罩、自己写 `role="dialog"`、
//! 自己挂 Escape、自己在遮罩上放 `onKeyDown={activateOnKeyboard}`。于是同一个应用里
//! 并存两套写法, 行为也各不相同 —— 有的能按 Escape 关, 有的不能; 有的关得掉, 有的
//! 关完把焦点丢在 `<body>` 上。
//!
//! 现在收敛到这一对组件, 由它们负责:
//!   - **退场**: 关闭不是"立刻消失", 而是先播完离场弹簧 (见 `usePresence`);
//!   - **保活**: 遮罩与卡片各自动画, 谁都没权利卸载对方 —— 卸载权交回给外层作用域
//!     (见 `lib/motion/retention.tsx`), 两者都静下来之后整棵子树才移除;
//!   - **关闭意图**: Escape 走全局退避栈 (见 `lib/interaction/dismissStack.ts`),
//!     点遮罩空白处同理, 两者都只需要 `open` 与 `onDismiss`;
//!   - **焦点**: 关在卡片内, 关闭后还给打开它的元素。
//!
//! **为什么遮罩上的 `role="button"` 被拿掉了**: 键盘激活遮罩关闭, 听上去是增强,
//! 实际是个缺陷 —— `onKeyDown` 走 React 事件冒泡, 卡片里任何输入框按回车都会冒到
//! 遮罩上, 于是在搜索框里按回车会**整个关掉设置面板**。遮罩不是按钮, 关闭走 Escape
//! 与点击空白处两条明确意图即可。

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePresence } from '../../lib/motion/usePresence';
import { RetentionScope } from '../../lib/motion/RetentionScope';
import { useRetention } from '../../lib/motion/retention';
import { useDismissOnEscape } from '../../lib/interaction/useDismissOnEscape';
import { useFocusTrap } from '../../lib/interaction/useFocusTrap';
import { useGlassSurface } from '../../lib/glass/useGlassSurface';
import { useGlassAppearance } from '../../lib/hooks/useGlassAppearance';

/**
 * 外层弹窗的开启状态与嵌套深度。
 *
 * 两者都要往下传: 状态用来让内层弹窗跟着外层一起关 (设置面板关闭时, 里面的主题
 * 编辑器不该留在屏幕上), 深度用来决定 Escape 先关哪一层。
 */
const DialogContext = createContext<{ open: boolean; depth: number } | null>(null);

interface DialogOverlayProps extends HTMLAttributes<HTMLDivElement> {
  /** 目标状态。变假后不会立刻卸载 —— 遮罩与卡片都播完离场才移除。 */
  open: boolean;
  zClassName?: string;
  /** 关闭意图 (Escape / 点击遮罩空白处)。不给则只能靠卡片内的按钮关闭。 */
  onDismiss?: () => void;
}

export function DialogOverlay({
  open,
  zClassName = 'z-modal',
  onDismiss,
  className = '',
  children,
  ...props
}: DialogOverlayProps) {
  // 外层若已经关闭, 本层即使自己的状态还是开着的也应当跟着退场。
  const parent = useContext(DialogContext);
  const effectiveOpen = parent ? open && parent.open : open;
  const depth = (parent?.depth ?? 0) + 1;

  // 本层自己的作用域: 遮罩和它里面的卡片各自动画, 只要还有一个在动就得留着。
  // 没有它就得靠外层宿主猜时长, 而两段动画谁后结束并不固定。
  return (
    <RetentionScope open={effectiveOpen}>
      <DialogOverlayBody
        open={effectiveOpen}
        depth={depth}
        zClassName={zClassName}
        onDismiss={onDismiss}
        className={className}
        {...props}
      >
        {children}
      </DialogOverlayBody>
    </RetentionScope>
  );
}

function DialogOverlayBody({
  open,
  depth,
  zClassName,
  onDismiss,
  className,
  children,
  ...props
}: Omit<DialogOverlayProps, 'open'> & { open: boolean; depth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // 单独一个组件而不是内联在 DialogOverlay 里: `useRetention` 要读的正是上一层
  // 提供的那个作用域, 写在提供者自己身上读不到。
  const busy = usePresence(ref, { visible: open, variant: 'overlay' });
  useRetention(busy);
  useDismissOnEscape(open, onDismiss, depth);

  // 静下来就整层移除: 关闭态不该留下任何 DOM。保活期间 `busy` 为真, 所以这个
  // 提前返回既不切动画, 也让"关着的浮层"重新变成零成本 —— 它不拦截指针, 不参与
  // 命中测试, 也不在无障碍树里。
  if (!busy) return null;

  return (
    <DialogContext.Provider value={{ open, depth }}>
      <div
        ref={ref}
        // `inert` 一个属性解决关闭态的三件事: 不再拦截指针、不再进入 Tab 序列、
        // 从辅助技术的树里消失。保活期间这层遮罩仍然覆盖整屏, 少了它就会挡住
        // 整个应用的点击。
        inert={!open}
        className={`dialog-overlay ${zClassName} ${className}`}
        // 用 `pointerdown` 而不是 `click`: `click` 的 target 是按下与抬起两个目标的
        // 共同祖先, 于是"在卡片里按住鼠标拖到遮罩上松手"也会满足 `target ===
        // currentTarget` —— 一次文本选择就把弹窗关掉。按下点才是真实的关闭意图。
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onDismiss?.();
        }}
        {...props}
      >
        {children}
      </div>
    </DialogContext.Provider>
  );
}

interface DialogSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
  /**
   * 卡片内标题元素的 id。
   *
   * 优先于 `label`: 标题文字本来就是卡片自己渲染的, 再让调用方抄一份同样的字符串
   * 传给 `label`, 两者迟早会不一致 (改写标题时只改一处), 而屏幕阅读器读到的是那份
   * 过期的副本。`aria-labelledby` 直接指向真实的标题节点, 不存在副本。
   */
  titleId?: string;
  /**
   * 期望的初始焦点落点 (如设置面板的搜索框)。
   *
   * 有它就不必再靠 `setTimeout(() => ref.current?.focus(), 50)` 绕开进场动画:
   * 聚焦用 `preventScroll`, 与弹簧不会互相打断, 也不需要猜一个"动画差不多完了"
   * 的延时 —— 那种延时在慢机器上会点错元素, 在快机器上纯粹是白等。
   */
  initialFocus?: RefObject<HTMLElement | null>;
}

export function DialogSurface({
  className = '',
  children,
  label,
  titleId,
  initialFocus,
  ...props
}: DialogSurfaceProps) {
  const dialog = useContext(DialogContext);
  const open = dialog?.open ?? true;
  const ref = useRef<HTMLDivElement>(null);
  const busy = usePresence(ref, { visible: open, variant: 'surface' });
  useRetention(busy);
  useFocusTrap(ref, open, { initialFocus });
  const glass = useGlassSurface({ role: 'floating', appearance: useGlassAppearance() });

  // 两个 ref 必须都拿到同一个元素: usePresence 负责进场/离场动画,
  // useGlassSurface 负责档位与透镜装配。effect 而非 callback ref, 是因为
  // usePresence 内部也用 effect 读 ref.current —— callback ref 写值
  // 不触发重渲染, 两个 effect 谁先跑就成了挂载顺序问题。
  // 必须排在下面的提前返回之前: hook 调用顺序不能随 `busy` 变化。
  useEffect(() => {
    glass.ref(ref.current);
  });

  // 同遮罩: 保活只是一段时间, 不是永久驻留。卡片内部的活体内容 (自定义控件的
  // sandboxed iframe、代码编辑器、媒体元素) 必须随着离场结束一起消失, 否则一个
  // 关闭的弹窗会在后台继续跑用户脚本。
  if (!busy) return null;

  return (
    <div
      ref={ref}
      className={`dialog-surface motion-float ${className}`}
      data-glass-tier={glass.tier}
      role="dialog"
      aria-modal="true"
      // 两者互斥: 同时给时 `aria-labelledby` 胜出, 因为它指向真实节点而不是副本。
      {...(titleId ? { 'aria-labelledby': titleId } : { 'aria-label': label })}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`dialog-header dialog-chrome ${className}`}>{children}</div>;
}

export function DialogBody({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`dialog-body ${className}`}>{children}</div>;
}

export function DialogFooter({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`dialog-footer dialog-chrome ${className}`}>{children}</div>;
}
