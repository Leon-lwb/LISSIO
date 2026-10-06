//! 浮层退避顺序 —— 一层一层关, 不是一起关。
//!
//! Escape 曾经由每个浮层各自在 `window` 上装一个监听器处理。单层时看不出问题,
//! 嵌套时全错: 设置面板里开着主题编辑器, 两者都在监听, 于是按一次 Escape 两个
//! 都关掉 —— 用户只要求退一层, 却退到了空处, 还得重新打开设置。
//!
//! 所以"谁该响应 Escape"必须有个全局次序, 而不是每层各自判断。这里按**嵌套深度**
//! 维护一个栈, 只有最内层收到关闭请求。
//!
//! 深度而不是挂载顺序: 内层浮层是用户点开外层之后才创建的, 那时外层早已入栈,
//! 挂载顺序恰好也正确 —— 但这是巧合, 不是约束。同一帧里从关闭态直接渲染成
//! "外层已开且内层也开" (恢复会话、URL 直达) 时, React 的 effect 自内向外执行,
//! 挂载顺序会反过来。深度是结构事实, 不会因为渲染时机而变。
//!
//! 判定与 React 无关, 便于直接测; 绑定见 `useDismissOnEscape`。

interface DismissEntry {
  /** 只在退避时才用, 用来判断"请求方是否还在栈里"。 */
  readonly id: symbol;
  /** 嵌套深度, 越大越靠内。 */
  readonly depth: number;
  readonly onDismiss: () => void;
}

const stack: DismissEntry[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  // 只交给最内层。它若选择不关 (如"下载中禁止关闭"), 事件到此为止, 不该继续
  // 往下穿透到它背后的浮层 —— 那会让用户觉得按 Escape 反而退得更远。
  stack[stack.length - 1]?.onDismiss();
}

/**
 * 入栈一个关闭请求方, 返回出栈用的函数。
 *
 * `window` 上的监听器按需装卸: 没有浮层时一个都不留, 否则整个应用会永远挂着
 * 一个每次按键都要过一遍的回调。
 */
export function pushDismissHandler(onDismiss: () => void, depth = 0): () => void {
  const entry: DismissEntry = { id: Symbol('dismiss'), depth, onDismiss };
  // 插到"最后一个不比本层深"的位置之后。
  let index = stack.length;
  while (index > 0 && stack[index - 1].depth > depth) index -= 1;
  stack.splice(index, 0, entry);
  if (!listening) {
    window.addEventListener('keydown', onKeyDown);
    listening = true;
  }
  return () => {
    const at = stack.findIndex((item) => item.id === entry.id);
    if (at === -1) return;
    stack.splice(at, 1);
    if (stack.length === 0 && listening) {
      window.removeEventListener('keydown', onKeyDown);
      listening = false;
    }
  };
}

/** 当前栈深 —— 仅供测试与诊断, 不参与任何渲染决策。 */
export function dismissStackDepth(): number {
  return stack.length;
}
