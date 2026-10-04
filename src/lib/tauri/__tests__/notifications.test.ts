import { afterEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../notifications';

describe('notification duration', () => {
  afterEach(() => {
    notify.dismissAll();
    vi.useRealTimers();
  });

  it('auto-dismisses warn/info notifications after the default 8s', () => {
    vi.useFakeTimers();
    const id = notify.warn('title', 'message');

    vi.advanceTimersByTime(7_999);
    expect(notify.getList().some((n) => n.id === id)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(notify.getList().some((n) => n.id === id)).toBe(false);
  });

  it('keeps durationMs=0 notifications until the user dismisses them', () => {
    vi.useFakeTimers();
    const id = notify.warn('title', 'message', { durationMs: 0 });

    vi.advanceTimersByTime(60_000);
    expect(notify.getList().some((n) => n.id === id)).toBe(true);
    expect(notify.getList().find((n) => n.id === id)?.durationMs).toBe(0);

    notify.dismiss(id);
    expect(notify.getList().some((n) => n.id === id)).toBe(false);
  });
});
