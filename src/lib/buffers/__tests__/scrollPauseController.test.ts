import { describe, expect, it } from 'vitest';
import { createScrollPauseController, type ScrollPauseDeps } from '../scrollPauseController';
import type { RunAction, RunState } from '../../../types';

/// 可变运行态 + 记录动作 — 模拟 store 镜像与 workspaceRun
function harness(initial: RunState = 'running') {
  let state: RunState = initial;
  const actions: RunAction[] = [];
  const deps: ScrollPauseDeps = {
    getRunState: () => state,
    run: (action) => {
      actions.push(action);
      // 与后端一致: pause 落到 paused, start 落到 running
      state = action === 'pause' ? 'paused' : 'running';
    },
  };
  const controller = createScrollPauseController(deps);
  return {
    controller,
    actions,
    get state() {
      return state;
    },
    setState(next: RunState) {
      state = next;
      controller.notifyRunState(next);
    },
  };
}

describe('scrollPauseController - 列表上滚暂停工作区', () => {
  it('首张卡片上滚时暂停工作区, 计数归零时恢复', () => {
    const h = harness('running');

    h.controller.begin('raw');
    expect(h.actions).toEqual(['pause']);
    expect(h.controller.ownsPause()).toBe(true);

    h.controller.end('raw');
    expect(h.actions).toEqual(['pause', 'start']);
    expect(h.controller.ownsPause()).toBe(false);
  });

  it('多张卡片共享一次暂停: 计数归零才恢复, 重复 begin 不重复计数', () => {
    const h = harness('running');

    h.controller.begin('raw');
    h.controller.begin('raw'); // 同一卡片重复上报 (滚动事件高频)
    expect(h.actions).toEqual(['pause']);
    expect(h.controller.holders()).toEqual(['raw']);

    h.controller.begin('can');
    h.controller.end('raw');
    // 仍有卡片脱离最新 → 不恢复
    expect(h.actions).toEqual(['pause']);

    h.controller.end('can');
    expect(h.actions).toEqual(['pause', 'start']);
  });

  it('未上报的 key 释放不产生副作用', () => {
    const h = harness('running');
    h.controller.end('never-begun');
    expect(h.actions).toEqual([]);
  });

  it('工作区非运行态上滚: 不动状态也不认领归属 (绝不自动 start)', () => {
    const stopped = harness('stopped');
    stopped.controller.begin('raw');
    expect(stopped.actions).toEqual([]);
    expect(stopped.controller.ownsPause()).toBe(false);
    stopped.controller.end('raw');
    expect(stopped.actions).toEqual([]);

    const paused = harness('paused');
    paused.controller.begin('raw');
    expect(paused.actions).toEqual([]);
    expect(paused.controller.ownsPause()).toBe(false);
    paused.controller.end('raw');
    expect(paused.actions).toEqual([]);
  });

  it('用户手动覆盖 (start/stop) 后放弃归属, 回到底部不再自动恢复', () => {
    const h = harness('running');
    h.controller.begin('raw');
    expect(h.controller.ownsPause()).toBe(true);

    // 用户手动 start 覆盖滚动暂停
    h.setState('running');
    expect(h.controller.ownsPause()).toBe(false);

    h.controller.end('raw');
    expect(h.actions).toEqual(['pause']);
  });

  it('暂停期间用户停止工作区 → 回到底部不启动', () => {
    const h = harness('running');
    h.controller.begin('raw');
    h.setState('stopped');

    h.controller.end('raw');
    expect(h.actions).toEqual(['pause']);
  });

  it('停止期间上滚留下的陈旧计数不阻塞运行后的新上滚', () => {
    const h = harness('stopped');

    // 停止时上滚: 只登记计数, 不认领归属
    h.controller.begin('raw');
    expect(h.actions).toEqual([]);
    expect(h.controller.holders()).toEqual(['raw']);

    // 工作区开始运行后, 另一张卡片上滚仍应触发暂停
    h.setState('running');
    h.controller.begin('can');
    expect(h.actions).toEqual(['pause']);
    expect(h.controller.ownsPause()).toBe(true);

    // 计数归零 (两张卡片都回到底部) 才恢复
    h.controller.end('raw');
    expect(h.actions).toEqual(['pause']);
    h.controller.end('can');
    expect(h.actions).toEqual(['pause', 'start']);
  });

  it('上报同值运行态不改变归属', () => {
    const h = harness('running');
    h.controller.begin('raw');
    h.controller.notifyRunState('paused'); // 与当前一致: 本次暂停仍在
    expect(h.controller.ownsPause()).toBe(true);
    h.controller.end('raw');
    expect(h.actions).toEqual(['pause', 'start']);
  });
});
