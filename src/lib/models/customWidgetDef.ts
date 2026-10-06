//! 自定义控件的求值内核 — 纯函数, 不含 React。
//!
//! 原先是 `components/widgets/custom/CustomWidget.tsx` 里的一个局部函数, 但
//! `lib/utils/nodeDef.ts`(端口声明提取) 也要用它 —— 那是实现层, 不该为了一个纯函数
//! 去引用视图目录。这里连同它的类型与守卫一起搬出来, 成为唯一权威。

export interface CustomWidgetDef {
  name?: string;
  description?: string;
  inputs?: { id: string; label: string }[];
  outputs?: { id: string; label: string }[];
  settings?: {
    id: string;
    label: string;
    type: 'number' | 'text' | 'color' | 'boolean';
    default: string | number | boolean;
  }[];
  onMount?: (ctx: CustomWidgetRuntime) => void;
  onUnmount?: (ctx: CustomWidgetRuntime) => void;
  render?: (ctx: CustomWidgetRuntime) => void;
}

export interface CustomWidgetRuntime {
  el: HTMLElement;
  inputs: Record<string, number>;
  settings: Record<string, string | number | boolean>;
  state: Record<string, unknown>;
  send: (portId: string, value: number) => void;
  log: (...args: unknown[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCustomWidgetDef(value: unknown): value is CustomWidgetDef {
  return isRecord(value) && typeof value.render === 'function';
}

/// 求值用户代码并返回 widget 定义对象 (供外部使用, 如读取 ports/settings schema)
///
/// 失败时返回 `{ def: null, error }` 而不是抛异常: 用户代码是数据, 语法错误与
/// 形状不符都是正常输入, 由调用方决定怎么呈现。
export function evalCustomWidgetDef(code: string): {
  def: CustomWidgetDef | null;
  error: string | null;
} {
  try {
    // User-authored widgets intentionally execute JavaScript in the isolated desktop webview.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`'use strict'; return (${code});`) as () => unknown;
    const def = fn();
    if (!isRecord(def)) {
      return { def: null, error: '代码必须返回一个对象' };
    }
    if (!isCustomWidgetDef(def)) {
      return { def: null, error: '代码必须定义 render(ctx) 函数' };
    }
    return { def, error: null };
  } catch (e) {
    return { def: null, error: e instanceof Error ? e.message : String(e) };
  }
}
