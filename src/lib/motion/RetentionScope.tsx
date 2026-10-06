//! 保活作用域的组件部分 —— 见 `retention.ts` 的说明。

import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RetentionContext, type Retention } from './retention';

/**
 * 一棵可以"晚一点再卸载"的子树。
 *
 * `open` 为假时不渲染 `children`, 但只要有后代持票, 就继续渲染 —— 这正是退场
 * 动画需要的那段时间。反过来, `children` 里的组件因此不必自己在关闭态下渲染,
 * 关闭后第一次渲染的代价为零。
 */
export function RetentionScope({ open, children }: { open: boolean; children: ReactNode }) {
  const parent = useContext(RetentionContext);
  const [tickets, setTickets] = useState<ReadonlySet<symbol>>(() => new Set());
  const alive = open || tickets.size > 0;

  // 本层还在忙时向父层登记: 父层若按自己的动画卸载, 这一层的离场就没机会播完。
  useEffect(() => {
    if (!parent || !alive) return;
    const ticket = parent.hold();
    return () => parent.release(ticket);
  }, [parent, alive]);

  const value = useMemo<Retention>(
    () => ({
      hold: () => {
        const ticket = Symbol('retention');
        setTickets((current) => new Set(current).add(ticket));
        return ticket;
      },
      release: (ticket) => {
        setTickets((current) => {
          if (!current.has(ticket)) return current;
          const next = new Set(current);
          next.delete(ticket);
          return next;
        });
      },
    }),
    []
  );

  return (
    <RetentionContext.Provider value={value}>
      {alive ? children : null}
    </RetentionContext.Provider>
  );
}
