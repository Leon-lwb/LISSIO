import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../test/setup';
import { useAiChatStore } from '../aiChatStore';
import { useSettingsStore } from '../settingsStore';
import { DEFAULT_SETTINGS } from '../../settings/defaults';

/// 多会话 store — 历史所有权在后端, 前端只做乐观视图 + 终态对账

// invoke 桩被声明为 () => Promise<undefined>, 按值/带参实现需透传 cast
// (与 updateStore.test / syncTabGraph.test 同款写法)
function mockInvokeReturn(value: unknown): void {
  (tauriMock.invoke as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(value);
}
function mockInvokeReject(error: unknown): void {
  (tauriMock.invoke as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(error);
}
function mockInvokeImpl(impl: (cmd: string) => unknown): void {
  tauriMock.invoke.mockImplementation(
    (cmd: string) => Promise.resolve().then(() => impl(cmd)),
  );
}

function lastInvokeCall(cmd: string): Record<string, unknown> {
  const calls = tauriMock.invoke.mock.calls as unknown as [string, Record<string, unknown>][];
  const call = calls.find(([c]) => c === cmd);
  if (!call) throw new Error(`未找到 ${cmd} 调用`);
  return call[1];
}

const RESET = {
  sessions: [],
  activeSessionId: null,
  viewItems: [],
  streaming: false,
  streamingSessionId: null,
  streamingText: '',
  reasoningText: '',
  timeline: [],
  toolRuns: [],
  taskId: null,
};

describe('aiChatStore 多会话 (后端持有)', () => {
  beforeEach(() => {
    tauriMock.invoke.mockReset();
    mockInvokeReturn(undefined);
    useAiChatStore.setState(RESET);
    // 发送前检查需要可用配置 (默认值为空 → 会被拦截)
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_SETTINGS.ai, adapter: 'orcarouter', apiKey: 'sk-test', model: 'openai/gpt-4o-mini' },
      },
    });
  });

  it('refreshSessions 拉取摘要并水合当前会话条目', async () => {
    mockInvokeImpl((cmd: string) => {
      if (cmd === 'chat_list_sessions') {
        return [{ id: 's1', title: '调试', created_at: 1, updated_at: 2, item_count: 1 }];
      }
      if (cmd === 'chat_get_session') {
        return {
          id: 's1',
          title: '调试',
          created_at: 1,
          updated_at: 2,
          items: [{ role: 'user', text: '你好' }],
        };
      }
      return undefined;
    });

    await useAiChatStore.getState().refreshSessions();

    const s = useAiChatStore.getState();
    expect(s.activeSessionId).toBe('s1');
    expect(s.sessions).toHaveLength(1);
    expect(s.viewItems).toEqual([{ role: 'user', text: '你好' }]);
  });

  it('send 把 sessionId/text 传给后端并乐观追加用户条目', async () => {
    useAiChatStore.setState({ ...RESET, activeSessionId: 's1' });
    mockInvokeReturn('task-1');

    await useAiChatStore.getState().send('你好');

    const s = useAiChatStore.getState();
    expect(s.viewItems).toEqual([{ role: 'user', text: '你好' }]);
    expect(s.streaming).toBe(true);
    expect(s.streamingSessionId).toBe('s1');
    const args = lastInvokeCall('ai_chat_send');
    expect(args.sessionId).toBe('s1');
    expect(args.text).toBe('你好');
    expect(args.regenerate).toBe(false);
    expect(args.useBuiltinTools).toBe(true);
    expect(args.useWebTools).toBe(true);
    expect(args.useMcpTools).toBe(true);
    expect(args).not.toHaveProperty('system');
  });

  it('send 由插件总开关约束内置插件与 Fetch 网页', async () => {
    useAiChatStore.setState({ ...RESET, activeSessionId: 's1' });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ai: {
          ...DEFAULT_SETTINGS.ai,
          adapter: 'orcarouter',
          apiKey: 'sk-test',
          model: 'openai/gpt-4o-mini',
          builtinToolsEnabled: true,
          webToolsEnabled: true,
          pluginsEnabled: false,
        },
      },
    });
    mockInvokeReturn('task-web-off');

    await useAiChatStore.getState().send('查资料');

    const args = lastInvokeCall('ai_chat_send');
    expect(args.useBuiltinTools).toBe(false);
    expect(args.useWebTools).toBe(false);
  });

  it('done 事件后从后端拉取权威视图 (含工具卡片)', async () => {
    useAiChatStore.setState({ ...RESET, activeSessionId: 's1' });
    mockInvokeImpl((cmd: string) => {
      if (cmd === 'ai_chat_send') return 'task-1';
      if (cmd === 'chat_get_session') {
        return {
          id: 's1',
          title: 'x',
          created_at: 1,
          updated_at: 2,
          items: [
            { role: 'user', text: '你好' },
            {
              role: 'assistant',
              text: '答案是 42',
              tools: [{ id: 'c1', name: 'probe', arguments: {}, content: '42', is_error: false, done: true }],
            },
          ],
        };
      }
      return undefined;
    });

    await useAiChatStore.getState().send('你好');
    const args = lastInvokeCall('ai_chat_send') as {
      onEvent: { onmessage: ((e: unknown) => void) | null };
    };
    args.onEvent.onmessage?.({ type: 'done', rounds: 1 });
    await vi.waitFor(() => expect(useAiChatStore.getState().streaming).toBe(false));

    const s = useAiChatStore.getState();
    expect(s.viewItems).toHaveLength(2);
    expect(s.viewItems[1].text).toBe('答案是 42');
    expect(s.viewItems[1].tools?.[0].done).toBe(true);
  });

  it('命令级失败 (配置错误): 流式态复位 + 结构化错误条目', async () => {
    useAiChatStore.setState({ ...RESET, activeSessionId: 's1' });
    mockInvokeReject({
      kind: 'AiMissingApiKey',
      message: 'provider [orcarouter] 缺少 API key',
      data: { adapter: 'orcarouter' },
    });

    await useAiChatStore.getState().send('你好');

    const s = useAiChatStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.viewItems).toHaveLength(2);
    expect(s.viewItems[1]).toMatchObject({
      role: 'assistant',
      error: true,
      error_kind: 'AiMissingApiKey',
      error_data: { adapter: 'orcarouter' },
    });
  });

  it('保存的 API key 不读回前端，空字段仍交由后端 SecretStore 校验', async () => {
    useAiChatStore.setState({ ...RESET, activeSessionId: 's1' });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_SETTINGS.ai, adapter: 'orcarouter', apiKey: '', model: 'openai/gpt-4o-mini' },
      },
    });

    await useAiChatStore.getState().send('你好');

    const s = useAiChatStore.getState();
    expect(s.streaming).toBe(true);
    expect(s.viewItems).toHaveLength(1);
    expect(
      (tauriMock.invoke.mock.calls as unknown as [string][]).some(([cmd]) => cmd === 'ai_chat_send')
    ).toBe(true);
  });

  it('regenerate 乐观截断最后一条用户之后的条目, 后端走 regenerate 通道', async () => {
    useAiChatStore.setState({
      ...RESET,
      activeSessionId: 's1',
      viewItems: [
        { role: 'user', text: '问' },
        { role: 'assistant', text: '错答', error: true },
      ],
    });
    mockInvokeReturn('task-2');

    await useAiChatStore.getState().regenerate();

    expect(useAiChatStore.getState().viewItems).toEqual([{ role: 'user', text: '问' }]);
    const args = lastInvokeCall('ai_chat_send');
    expect(args.regenerate).toBe(true);
    expect(args.text).toBeNull();
  });

  it('deleteSession 删除当前会话后自动切换到剩余会话', async () => {
    useAiChatStore.setState({
      ...RESET,
      activeSessionId: 's1',
      sessions: [
        { id: 's1', title: 'a', created_at: 1, updated_at: 1, item_count: 0 },
        { id: 's2', title: 'b', created_at: 2, updated_at: 2, item_count: 0 },
      ],
    });

    await useAiChatStore.getState().deleteSession('s1');

    expect(useAiChatStore.getState().activeSessionId).toBe('s2');
    expect(tauriMock.invoke).toHaveBeenCalledWith('chat_delete_session', { sessionId: 's1' });
  });

  it('refreshSessions 在无当前会话时回退到最近活动的会话 (后端按存储顺序返回)', async () => {
    mockInvokeImpl((cmd: string) => {
      if (cmd === 'chat_list_sessions') {
        // 存储顺序 = 创建顺序, 不是时间序
        return [
          { id: 'old', title: '最早', created_at: 1, updated_at: 10, item_count: 1 },
          { id: 'new', title: '最近', created_at: 3, updated_at: 90, item_count: 5 },
          { id: 'mid', title: '中间', created_at: 2, updated_at: 50, item_count: 2 },
        ];
      }
      if (cmd === 'chat_get_session') {
        return { id: 'new', title: '最近', created_at: 3, updated_at: 90, items: [{ role: 'user', text: '最近的对话' }] };
      }
      return undefined;
    });

    await useAiChatStore.getState().refreshSessions();

    expect(useAiChatStore.getState().activeSessionId).toBe('new');
    expect(useAiChatStore.getState().viewItems).toEqual([{ role: 'user', text: '最近的对话' }]);
  });

  it('流式 delta 在一个窗口内合批, 不逐个 token 写 store 且保持事件顺序', async () => {
    useAiChatStore.setState({ ...RESET, activeSessionId: 's1' });
    mockInvokeReturn('task-1');
    await useAiChatStore.getState().send('你好');
    const { onEvent } = lastInvokeCall('ai_chat_send') as {
      onEvent: { onmessage: (e: unknown) => void };
    };

    onEvent.onmessage({ type: 'delta', text: '第一段' });
    onEvent.onmessage({ type: 'reasoning_delta', text: '想一下' });
    onEvent.onmessage({ type: 'delta', text: '第二段' });

    // 窗口未到: 事件仍留在缓冲里 (证明不是每个 token 一次全量重渲染)
    expect(useAiChatStore.getState().streamingText).toBe('');
    await vi.waitFor(() => {
      expect(useAiChatStore.getState().streamingText).toBe('第一段第二段');
    });
    const s = useAiChatStore.getState();
    expect(s.reasoningText).toBe('想一下');
    expect(s.timeline).toEqual([
      { kind: 'text', text: '第一段' },
      { kind: 'reasoning', text: '想一下' },
      { kind: 'text', text: '第二段' },
    ]);
  });

  it('终态事件先冲刷缓冲再收束 — 最后一段流式文本不丢', async () => {
    useAiChatStore.setState({ ...RESET, activeSessionId: 's1' });
    mockInvokeImpl((cmd: string) => {
      if (cmd === 'ai_chat_send') return 'task-1';
      if (cmd === 'chat_get_session') throw new Error('后端不可达');
      return undefined;
    });
    await useAiChatStore.getState().send('你好');
    const { onEvent } = lastInvokeCall('ai_chat_send') as {
      onEvent: { onmessage: (e: unknown) => void };
    };

    onEvent.onmessage({ type: 'delta', text: '半截回答' });
    onEvent.onmessage({ type: 'done', rounds: 1 });
    await vi.waitFor(() => expect(useAiChatStore.getState().streaming).toBe(false));

    const items = useAiChatStore.getState().viewItems;
    expect(items[items.length - 1]).toMatchObject({
      role: 'assistant',
      text: '半截回答',
    });
  });
});
