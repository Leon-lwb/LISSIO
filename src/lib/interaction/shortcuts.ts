import { isTextEntryTarget } from '../utils/a11y';

/// 一个加速键的声明: 主键 + 修饰键要求。
export interface Accelerator {
  /** `event.key`, 小写比较; 单字符大小写不敏感 */
  key: string;
  /** 是否要求 Ctrl (Windows/Linux 主修饰键) */
  ctrl?: boolean;
  /** 是否要求 Meta (macOS 主修饰键, 即 Cmd) */
  meta?: boolean;
  shift?: boolean;
  /** 是否要求 Alt; 默认要求"没按" */
  alt?: boolean;
}

/// 匹配用的按键事件形状 — 只取判定需要的那几个字段, 便于直接构造用例。
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/// Ctrl 与 Meta 视为同一个"主修饰键": 同一份声明要在两个平台都对。
/// 但**不能**写成"二者其一即可" —— 那样 Ctrl+Shift+Z 与 Cmd+Shift+Z 都会命中,
/// 而 `alt`/`shift` 必须精确匹配, 否则 Ctrl+A 会顺带吃掉 Ctrl+Shift+A。
function modifierMatches(event: KeyLike, acc: Accelerator): boolean {
  const wantsPrimary = acc.ctrl === true || acc.meta === true;
  const hasPrimary = event.ctrlKey || event.metaKey;
  if (wantsPrimary !== hasPrimary) return false;
  if ((acc.shift === true) !== event.shiftKey) return false;
  // Alt 没有"主修饰键"语义, 默认要求未按下
  if ((acc.alt === true) !== event.altKey) return false;
  return true;
}

/**
 * 判断事件是否命中某个加速键声明。
 *
 * 纯函数, 不碰 DOM 也不读 store —— 快捷键的"该不该我管"能在用例里直接构造事件验证,
 * 不必起一个真实的 window 监听。
 */
export function matchesAccelerator(event: KeyLike, acc: Accelerator): boolean {
  if (!modifierMatches(event, acc)) return false;
  return event.key.toLowerCase() === acc.key.toLowerCase();
}

export interface ShortcutSpec extends Accelerator {
  /** 稳定标识: 同 id 重复注册时后者覆盖前者, 便于按功能而非按键位排查 */
  id: string;
  /** 命中后执行; 返回 `false` 表示"这次我不管", 事件继续交给别的监听者 */
  run: (event: KeyboardEvent) => boolean | void;
  /**
   * 焦点在文本输入控件里时是否仍然生效。默认**不生效**:
   * 输入框有自己的按键语义 (Ctrl+A 全选文本、Ctrl+Z 撤销输入), 全局快捷键让路。
   */
  whileTyping?: boolean;
}

const registry = new Map<string, ShortcutSpec>();

/**
 * 登记一个全局加速键。
 *
 * 返回注销函数 —— 调用点把它交给 `useEffect` 的清理, 不留悬挂监听。
 */
export function registerShortcut(spec: ShortcutSpec): () => void {
  registry.set(spec.id, spec);
  return () => {
    // 只有仍指向自己时才删: 同 id 被后来者覆盖后, 先注册者的清理不应把新注册的删掉。
    if (registry.get(spec.id) === spec) registry.delete(spec.id);
  };
}

/**
 * 把一次按键派发给已登记的加速键。
 *
 * 命中且 `run` 未返回 `false` 时 `preventDefault()`。返回是否有人处理 ——
 * 调用方据此决定要不要继续 (例如 Windows 菜单栏的兜底分支)。
 */
export function dispatchShortcut(event: KeyboardEvent): boolean {
  for (const spec of registry.values()) {
    if (!matchesAccelerator(event, spec)) continue;
    if (!spec.whileTyping && isTextEntryTarget(event.target)) continue;
    if (spec.run(event) === false) continue;
    event.preventDefault();
    return true;
  }
  return false;
}

/// 测试用: 清空注册表。生产代码不要调用 —— 注册表是全局单例, 清空会让真实快捷键失效。
export function __clearShortcutsForTests(): void {
  registry.clear();
}
