import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tauriMock } from '../../test/setup';
import { useAiChatStore } from '../aiChatStore';
import { useSettingsStore } from '../settingsStore';
import { useAppStore } from '../appStore';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { notify } from '../../lib/tauri/notifications';

/// 本地 MCP 端口 — 设置里的端口就是后端监听的端口, 冲突要能说明白。

type InvokeArgs = Record<string, unknown> | undefined;
const invokeMock = tauriMock.invoke as unknown as {
  mockImplementation: (impl: (cmd: string, args?: InvokeArgs) => unknown) => void;
  mockReset: () => void;
  mock: { calls: [string, InvokeArgs][] };
};

/// 最近一次该命令的调用参数 (测试里同名命令可能被调用多次)。
function calledWith(cmd: string): InvokeArgs {
  return [...invokeMock.mock.calls].reverse().find(([name]) => name === cmd)?.[1];
}

function called(cmd: string): boolean {
  return invokeMock.mock.calls.some(([name]) => name === cmd);
}

const CONFLICT = {
  port: 8765,
  reason: 'Address already in use (os error 48)',
  occupant: 'node (PID 4242)',
  reserved_hint: false,
  suggested_port: 8766,
};

describe('本地 MCP 端口 (aiChatStore)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.resolve(undefined));
    notify.dismissAll();
    useAppStore.setState({ lang: 'zh' });
    useAiChatStore.setState({ serverRunning: false, serverPort: null, serverConflict: null });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_SETTINGS.ai, mcpServerPort: 8765 },
      },
    });
  });

  afterEach(() => {
    notify.dismissAll();
  });

  it('按设置里的端口启动, 并记录后端回填的实际端口', async () => {
    invokeMock.mockImplementation((cmd) =>
      Promise.resolve(cmd === 'mcp_server_start' ? 9001 : undefined)
    );

    await useAiChatStore.getState().startLocalServer();

    expect(calledWith('mcp_server_start')).toEqual({ port: 8765 });
    expect(useAiChatStore.getState().serverRunning).toBe(true);
    expect(useAiChatStore.getState().serverPort).toBe(9001);
    expect(useAiChatStore.getState().serverConflict).toBeNull();
  });

  it('启动失败时拉回端口冲突, 并只提示一次同一冲突', async () => {
    invokeMock.mockImplementation((cmd) => {
      if (cmd === 'mcp_server_start') return Promise.reject(new Error('busy'));
      if (cmd === 'mcp_server_status') {
        return Promise.resolve({ running: false, port: null, conflict: CONFLICT });
      }
      return Promise.resolve(undefined);
    });

    await useAiChatStore.getState().startLocalServer();

    expect(useAiChatStore.getState().serverRunning).toBe(false);
    expect(useAiChatStore.getState().serverConflict).toEqual(CONFLICT);

    const notifications = notify.getList();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('8765');
    expect(notifications[0].message).toContain('node (PID 4242)');
    expect(notifications[0].message).toContain('8766');
    expect(notifications[0].actions.map((action) => action.label)).toContain('改用 8766');

    // 同一 (端口, 原因) 不再重复弹窗, 但冲突状态仍留在 store 里供横幅展示
    await useAiChatStore.getState().refreshServerStatus();
    expect(notify.getList()).toHaveLength(1);
    expect(useAiChatStore.getState().serverConflict).toEqual(CONFLICT);
  });

  it('提示里的“改用建议端口”直接换端口并启动', async () => {
    // 与上一个用例不同的端口/原因 — 提示去重按 (端口, 原因) 记, 每个会话一次
    const other = { ...CONFLICT, port: 8800, reason: 'PermissionDenied (os error 10013)', suggested_port: 8801 };
    let attempts = 0;
    invokeMock.mockImplementation((cmd) => {
      if (cmd === 'mcp_server_start') {
        attempts += 1;
        // 第一次按设置的端口启动失败, 改端口后的重试成功
        return attempts === 1 ? Promise.reject(new Error('busy')) : Promise.resolve(9002);
      }
      if (cmd === 'mcp_server_status') {
        return Promise.resolve({ running: false, port: null, conflict: other });
      }
      return Promise.resolve(undefined);
    });
    await useAiChatStore.getState().startLocalServer();
    const action = notify.getList()[0].actions.find((item) => item.label === '改用 8801');
    expect(action).toBeDefined();

    action!.run();

    await expect
      .poll(() => useSettingsStore.getState().settings.ai.mcpServerPort)
      .toBe(8801);
    await expect.poll(() => useAiChatStore.getState().serverPort).toBe(9002);
  });

  it('改端口: 监听中立即按新端口重启', async () => {
    useAiChatStore.setState({ serverRunning: true, serverPort: 8765 });
    invokeMock.mockImplementation((cmd) =>
      Promise.resolve(cmd === 'mcp_server_start' ? 8766 : undefined)
    );

    await useAiChatStore.getState().changeServerPort(8766);

    expect(useSettingsStore.getState().settings.ai.mcpServerPort).toBe(8766);
    expect(calledWith('mcp_server_start')).toEqual({ port: 8766 });
    expect(useAiChatStore.getState().serverPort).toBe(8766);
  });

  it('改端口: 未运行时不启动监听', async () => {
    await useAiChatStore.getState().changeServerPort(9000);

    expect(useSettingsStore.getState().settings.ai.mcpServerPort).toBe(9000);
    expect(called('mcp_server_start')).toBe(false);
  });

  it('提示里的“打开 MCP 设置”直达 设置 → AI → MCP', async () => {
    const other = { ...CONFLICT, port: 8900, reason: 'PermissionDenied (os error 13)', suggested_port: null };
    invokeMock.mockImplementation((cmd) => {
      if (cmd === 'mcp_server_start') return Promise.reject(new Error('busy'));
      if (cmd === 'mcp_server_status') {
        return Promise.resolve({ running: false, port: null, conflict: other });
      }
      return Promise.resolve(undefined);
    });
    useSettingsStore.setState({ isOpen: false, activeCategory: 'general', aiSection: 'main' });

    await useAiChatStore.getState().startLocalServer();
    const action = notify.getList()[0].actions.find((item) => item.label === '打开 MCP 设置');
    expect(action).toBeDefined();

    action!.run();

    expect(useSettingsStore.getState()).toMatchObject({
      isOpen: true,
      activeCategory: 'ai',
      aiSection: 'mcp',
    });
  });

  it('端口检查透传结果, 后端不可达时返回 null', async () => {
    invokeMock.mockImplementation((cmd) =>
      Promise.resolve(
        cmd === 'mcp_port_check'
          ? { port: 8765, available: false, occupant: 'node (PID 1)', reserved_hint: false, suggested_port: 8766 }
          : undefined
      )
    );
    await expect(useAiChatStore.getState().probePort(8765)).resolves.toMatchObject({
      available: false,
      suggested_port: 8766,
    });

    invokeMock.mockImplementation(() => Promise.reject(new Error('offline')));
    await expect(useAiChatStore.getState().probePort(8765)).resolves.toBeNull();
  });
});
