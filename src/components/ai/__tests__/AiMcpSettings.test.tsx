import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';
import { AiMcpSettings } from '../AiMcpSettings';
import { tauriMock } from '../../../test/setup';
import { useAiChatStore } from '../../../store/aiChatStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useAppStore } from '../../../store/appStore';
import { DEFAULT_SETTINGS } from '../../../settings/defaults';
import { notify } from '../../../lib/tauri/notifications';
import type { McpPortConflict } from '../../../types';

/// 设置 → AI → MCP: 端口可用性检查与冲突处置横幅。

type InvokeArgs = Record<string, unknown> | undefined;
const invokeMock = tauriMock.invoke as unknown as {
  mockImplementation: (impl: (cmd: string, args?: InvokeArgs) => unknown) => void;
  mockReset: () => void;
  mock: { calls: [string, InvokeArgs][] };
};

const CONFLICT: McpPortConflict = {
  port: 8765,
  reason: 'Address already in use (os error 48)',
  occupant: 'node (PID 4242)',
  reserved_hint: false,
  suggested_port: 8766,
};

function mockApi(
  status: { running: boolean; port: number | null; conflict: McpPortConflict | null },
  check: unknown
): void {
  invokeMock.mockImplementation((cmd) => {
    if (cmd === 'mcp_list_tools' || cmd === 'mcp_list_servers') return Promise.resolve([]);
    if (cmd === 'mcp_server_status') return Promise.resolve(status);
    if (cmd === 'mcp_port_check') return Promise.resolve(check);
    return Promise.resolve(undefined);
  });
}

function renderSettings(port = 8765) {
  return renderWithI18n(<AiMcpSettings port={port} onPortChange={() => undefined} />);
}

describe('AiMcpSettings 端口检查与冲突提示', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    notify.dismissAll();
    useAppStore.setState({ lang: 'zh' });
    useAiChatStore.setState({
      servers: [],
      tools: [],
      serverRunning: false,
      serverPort: null,
      serverConflict: null,
    });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, mcpServerPort: 8765 } },
    });
  });

  afterEach(() => {
    cleanup();
    notify.dismissAll();
  });

  it('端口被占用时给出常驻横幅: 占用者 / 原因 / 建议端口 / 处置按钮', async () => {
    mockApi({ running: false, port: null, conflict: CONFLICT }, {
      port: 8765,
      available: false,
      occupant: 'node (PID 4242)',
      reserved_hint: false,
      suggested_port: 8766,
    });

    renderSettings();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('本地 MCP 端口 8765 被占用');
    expect(alert).toHaveTextContent('占用进程: node (PID 4242)');
    expect(alert).toHaveTextContent('Address already in use (os error 48)');
    expect(alert).toHaveTextContent('建议改用 8766。');
    expect(screen.getByRole('button', { name: '改用 8766' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭 MCP' })).toBeInTheDocument();
  });

  it('端口为空闲时在字段旁显示可用', async () => {
    mockApi({ running: false, port: null, conflict: null }, {
      port: 8765,
      available: true,
      occupant: null,
      reserved_hint: false,
      suggested_port: null,
    });

    renderSettings();

    await waitFor(() => expect(screen.getByText('端口 8765 可用')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('端口被别的进程占用时在字段旁点名占用者', async () => {
    mockApi({ running: false, port: null, conflict: null }, {
      port: 8765,
      available: false,
      occupant: 'nginx (PID 7)',
      reserved_hint: false,
      suggested_port: 8766,
    });

    renderSettings();

    await waitFor(() =>
      expect(screen.getByText('端口 8765 被占用 (nginx (PID 7))')).toBeInTheDocument()
    );
  });

  it('服务已在监听该端口时不再探测 (占用者就是自己)', async () => {
    mockApi({ running: true, port: 8765, conflict: null }, null);
    useAiChatStore.setState({ serverRunning: true, serverPort: 8765 });

    renderSettings();

    await waitFor(() => expect(screen.getByText('127.0.0.1:8765/mcp')).toBeInTheDocument());
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === 'mcp_port_check')).toBe(false);
  });

  it('没有任何冲突时端口字段仍可编辑', async () => {
    mockApi({ running: false, port: null, conflict: null }, {
      port: 8765,
      available: true,
      occupant: null,
      reserved_hint: false,
      suggested_port: null,
    });

    renderSettings();

    await waitFor(() => expect(screen.getByText('端口 8765 可用')).toBeInTheDocument());
    expect(screen.getByRole('spinbutton')).toHaveValue(8765);
  });
});
