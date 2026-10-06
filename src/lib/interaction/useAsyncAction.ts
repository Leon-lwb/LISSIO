import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAsyncActionOptions {
  /**
   * 失败上报。**没有默认值**是有意的: 缺省实现必然是 `console.error`,
   * 而"控制台里有一行"对用户等于什么都没发生 —— 这正是这类代码原本的毛病。
   * 强制调用方显式决定失败时用户看到什么, 就没法靠遗漏把错误吞掉。
   */
  onError: (error: unknown, label: string) => void;
}

export interface AsyncAction {
  /** 是否有动作在飞。用计数而非布尔: 并发时先完成的那个不该把忙碌状态清掉。 */
  busy: boolean;
  /**
   * 跑一个异步动作。**不抛异常** —— 失败走 `onError` 并以 `undefined` 返回,
   * 因此 `void run(...)` 不会产生未处理的 rejection。
   */
  run: <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * 把"忙碌标记 + 失败上报 + 卸载后不再写状态"这三件每次都手写、也每次都写漏的事
 * 收成一个原语。
 *
 * 手写版本反复出现同一个缺陷: `try { await ... } catch (e) { console.error(e) }`,
 * 界面上既不显示失败, 忙碌标记也可能因为并发而提前落回。
 */
export function useAsyncAction({ onError }: UseAsyncActionOptions): AsyncAction {
  const [inflight, setInflight] = useState(0);
  const mounted = useRef(true);
  // onError 每次渲染都可能是新函数, 存进 ref 让 run 保持稳定身份 ——
  // 否则调用点把它放进依赖数组时会反复重建。
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(label: string, action: () => Promise<T>): Promise<T | undefined> => {
    if (mounted.current) setInflight((n) => n + 1);
    try {
      const result = await action();
      return result;
    } catch (error) {
      // 卸载后不再上报: 这时用户已经看不到这个面板了, 弹提示只会莫名其妙。
      if (mounted.current) onErrorRef.current(error, label);
      return undefined;
    } finally {
      if (mounted.current) setInflight((n) => n - 1);
    }
  }, []);

  return { busy: inflight > 0, run };
}
