//! 文字色档位 token 的 TS 出口 — 全仓唯一的"颜色 + 透明度"拼装点
//!
//! 组件里不允许散写 `text-text-secondary` 叠 `opacity-NN` / 调色板 `text-red-NNN`
//! 裸实现: 颜色与透明度统一收敛到 `src/styles/theme.css` 的语义 token
//! (`--color-text-*` / `--alpha-*`), 本模块只负责把语义档位翻译成 token 类名。
//!
//! - JSX 里静态类名直接写 `text-text-secondary-faint` 等 token 类 (与本函数等价);
//!   本函数服务于"class 由数据/分支决定"的场景 (状态映射表、helper 返回值)。
//! - 禁用态视觉统一走 `disabled:opacity-disabled` (theme.css `--opacity-*` 档位
//!   桥接的 tailwind 工具类, 变体可用), 不再逐处写 `disabled:opacity-NN`;
//!   非表单 (div/菜单项) 的失活态用静态类 `opacity-disabled`。
//! - 显隐动画 (`opacity-0 group-hover:opacity-100` / `hover:opacity-100`) 不属于
//!   颜色语义, 保持原样, check:tokens 对 `opacity-0` / `opacity-100` 放行。

/// 文字色档位 — 值即 theme.css 里的 `--color-text-*` token 后缀
export type TextTone =
  /** 主文字 */
  | 'primary'
  /** 次级文字 (默认弱化档, 60%) */
  | 'secondary'
  /** 次级文字 - 提示 (75%) */
  | 'secondaryHint'
  /** 次级文字 - 极弱 (15%) */
  | 'secondaryFaint'
  /** 次级文字 - 禁用 (45%) */
  | 'secondaryDisabled'
  /** 极弱文字 (muted 的 15%) */
  | 'faint'
  /** 禁用文字 */
  | 'disabled'
  /** 反色文字 (实心强调底之上) */
  | 'inverse'
  /** 危险/错误 */
  | 'danger'
  /** 成功/正常 */
  | 'success'
  /** 警告 */
  | 'warning'
  /** 信息 */
  | 'info'
  /** 强调 */
  | 'accent'
  /** 中性 (替代裸 text-zinc-NNN) */
  | 'neutral'
  /** 特殊标记 (双角色徽标等, 替代裸 text-purple-NNN) */
  | 'special';

/// 状态徽标档位 — 文字 + 底 + 边框成套 (theme.css `@utility state-*` 的语义键)
export type BadgeTone = Extract<
  TextTone,
  'danger' | 'success' | 'warning' | 'info' | 'accent' | 'neutral' | 'special'
>;

const TEXT_TONE_CLASS: Record<TextTone, string> = {
  primary: 'text-text-primary',
  secondary: 'text-text-secondary',
  secondaryHint: 'text-text-secondary-hint',
  secondaryFaint: 'text-text-secondary-faint',
  secondaryDisabled: 'text-text-secondary-disabled',
  faint: 'text-text-muted-faint',
  disabled: 'text-text-disabled',
  inverse: 'text-text-inverse',
  danger: 'text-text-danger',
  success: 'text-text-success',
  warning: 'text-text-warning',
  info: 'text-text-info',
  accent: 'text-text-accent',
  neutral: 'text-text-neutral',
  special: 'text-text-special',
};

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  danger: 'state-danger',
  success: 'state-success',
  warning: 'state-warning',
  info: 'state-info',
  accent: 'state-accent',
  neutral: 'state-neutral',
  special: 'state-special',
};

/// 档位对应的 tailwind 修饰变体前缀 (hover:/focus:/group-hover: …)。
/// 只接受白名单内的变体 — 拼接结果必须仍是可被 tailwind 扫描到的完整类名。
export type ToneVariant = '' | 'hover:' | 'focus:' | 'group-hover:' | 'active:';

/// 取文字色档位类名 (可带状态变体前缀)
export function textToneClass(tone: TextTone, variant: ToneVariant = ''): string {
  return `${variant}${TEXT_TONE_CLASS[tone]}`;
}

/// 取语义徽标组合类名 (`@utility state-*` — 文字+底+边框一套, 支持变体前缀)
export function badgeToneClass(tone: BadgeTone, variant: ToneVariant = ''): string {
  return `${variant}${BADGE_TONE_CLASS[tone]}`;
}

/// 允许的透明度档位值 (与 theme.css 的 `--alpha-*` 一一对应)。
/// 供 `color-mix()` / `opacity` 引用前校验 — 防止组件绕过档位写死数字。
export const TEXT_TONE_ALPHA: Readonly<Record<string, number>> = {
  faint: 0.15,
  subtle: 0.4,
  disabled: 0.45,
  muted: 0.6,
  secondary: 0.75,
};

/// alpha 档位名 -> 百分比字符串 (供 color-mix / opacity 使用)
export function alphaVar(name: keyof typeof TEXT_TONE_ALPHA): string {
  return `var(--alpha-${name})`;
}
